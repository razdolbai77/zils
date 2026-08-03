import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { AsmDocument } from "./document";
import { SymbolCollector } from "./symbols";
import type { SymbolKind } from "./symbols";
import { CpuDialect } from "./metadata";
import { Token, TokenType } from "./lexer";

export type WorkspaceSymbol = {
  name: string;
  kind: SymbolKind;
  line: number;
  filePath: string;
  docComment?: string;
};

export type IndexedWorkspace = {
  documents: ReadonlyMap<string, AsmDocument>;
  dependencies: ReadonlyMap<string, readonly string[]>;
  loadOrder: readonly string[];
  symbols: ReadonlyMap<string, WorkspaceSymbol>;
  failedIncludes: readonly FailedInclude[];
  // Maps a case-insensitive path key to the canonical (first-seen) spelling,
  // so lookups succeed regardless of case while display URIs keep their
  // original casing.
  pathIndex: ReadonlyMap<string, string>;
};

export type FailedInclude = {
  includerPath: string;
  line: number;
  startCharacter: number;
  length: number;
  resolvedPath: string;
};

const includeDirectives = new Set(["include", ".include", "maclib"]);

// Windows file systems are case-insensitive, so an include spelled
// "Lib.ASM" must hit the open buffer for lib.asm. Key every workspace
// map with this normalized form; other platforms keep paths verbatim.
export function pathKey(filePath: string): string {
  if (filePath.startsWith("untitled:")) {
    return filePath;
  }
  return process.platform === "win32" ? filePath.toLowerCase() : filePath;
}

export function normalizeUri(uri: string): string {
  try {
    if (uri.startsWith("file://")) {
      const p = fileURLToPath(uri);
      // Ensure stable casing on Windows by lowercasing the drive letter if present
      const normalizedPath = path.normalize(p);
      return pathToFileURL(normalizedPath).toString();
    }
  } catch {
    // Fall back to original
  }
  return uri;
}

export async function indexWorkspace(
  entryPath: string,
  overrides?: ReadonlyMap<string, AsmDocument>,
  dialect: CpuDialect = CpuDialect.EZ80,
  isAsmsx: boolean = false,
  diskCache?: Map<string, AsmDocument>
): Promise<IndexedWorkspace> {
  const documents = new Map<string, AsmDocument>();
  const dependencies = new Map<string, readonly string[]>();
  const loadOrder: string[] = [];
  const symbols = new Map<string, WorkspaceSymbol>();
  const failedIncludes: FailedInclude[] = [];
  const pathIndex = new Map<string, string>();

  // Re-key overrides case-insensitively, remembering each buffer's original
  // spelling so the canonical document key preserves its casing.
  const keyedOverrides = new Map<string, AsmDocument>();
  const overrideSpelling = new Map<string, string>();
  if (overrides) {
    for (const [overridePath, overrideDocument] of overrides.entries()) {
      const overrideKey = pathKey(overridePath);
      if (!keyedOverrides.has(overrideKey)) {
        keyedOverrides.set(overrideKey, overrideDocument);
        overrideSpelling.set(overrideKey, overridePath);
      }
    }
  }

  const resolvedEntry = entryPath.startsWith("untitled:")
    ? entryPath
    : path.resolve(entryPath);
  await visitFile(
    resolvedEntry,
    documents,
    pathIndex,
    dependencies,
    failedIncludes,
    loadOrder,
    keyedOverrides,
    overrideSpelling,
    dialect,
    isAsmsx,
    diskCache
  );

  for (const canonicalPath of loadOrder) {
    const document = documents.get(canonicalPath);
    if (document === undefined) {
      continue;
    }

    const collector = new SymbolCollector(document);
    for (const symbol of collector.getSymbols()) {
      symbols.set(symbol.name, {
        name: symbol.name,
        kind: symbol.kind,
        line: symbol.line,
        filePath: canonicalPath,
        docComment: symbol.docComment
      });
    }
  }

  return {
    documents,
    dependencies,
    loadOrder,
    symbols,
    failedIncludes,
    pathIndex
  };
}

async function visitFile(
  filePath: string,
  documents: Map<string, AsmDocument>,
  pathIndex: Map<string, string>,
  dependencies: Map<string, readonly string[]>,
  failedIncludes: FailedInclude[],
  loadOrder: string[],
  overrides: ReadonlyMap<string, AsmDocument> | undefined,
  overrideSpelling: ReadonlyMap<string, string>,
  dialect: CpuDialect = CpuDialect.EZ80,
  isAsmsx: boolean = false,
  diskCache?: Map<string, AsmDocument>
): Promise<void> {
  const key = pathKey(filePath);
  if (pathIndex.has(key)) {
    return;
  }

  let document: AsmDocument;
  let canonicalPath = filePath;
  const override = overrides?.get(key);
  if (override !== undefined) {
    document = override;
    canonicalPath = overrideSpelling.get(key) ?? filePath;
  } else {
    if (filePath.startsWith("untitled:")) {
      return;
    }
    const cachedDocument = diskCache?.get(key);
    if (cachedDocument !== undefined) {
      document = cachedDocument;
    } else {
      try {
        document = new AsmDocument(await fs.promises.readFile(filePath, "utf8"), dialect, isAsmsx);
        diskCache?.set(key, document);
      } catch {
        return;
      }
    }
  }

  pathIndex.set(key, canonicalPath);
  documents.set(canonicalPath, document);
  loadOrder.push(canonicalPath);

  const includeRefs = document.lines.flatMap((line, lineIndex) => {
    if (!line.isDirective || !line.mnemonic || !includeDirectives.has(line.mnemonic.toLowerCase())) {
      return [];
    }

    if (!line.operands || line.operands.length === 0 || line.operands[0].length === 0) {
      return [];
    }

    const includePath = readIncludePath(line.operands[0]);
    if (includePath === null) {
      return [];
    }

    const tokens = line.operands[0];
    const first = tokens[0];
    const last = tokens[tokens.length - 1];
    return [{
      resolvedPath: path.resolve(path.dirname(canonicalPath), includePath),
      line: lineIndex,
      startCharacter: first.start - (line.start ?? 0),
      length: last.start + last.length - first.start
    }];
  });

  const dependencyPaths: string[] = [];
  for (const ref of includeRefs) {
    await visitFile(ref.resolvedPath, documents, pathIndex, dependencies, failedIncludes, loadOrder, overrides, overrideSpelling, dialect, isAsmsx, diskCache);
    const depCanonical = pathIndex.get(pathKey(ref.resolvedPath));
    if (depCanonical !== undefined) {
      dependencyPaths.push(depCanonical);
    } else {
      failedIncludes.push({ includerPath: canonicalPath, ...ref });
    }
  }
  dependencies.set(canonicalPath, dependencyPaths);
}

function readIncludePath(operand: Token[]): string | null {
  if (operand.length === 0) return null;
  if (operand[0].type === TokenType.String) {
      return operand[0].rawValue ?? operand[0].value;
  }

  const reconstructedPath = operand.map((token) => token.value).join("");
  return reconstructedPath.length > 0 ? reconstructedPath : null;
}
