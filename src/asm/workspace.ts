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

export type DiskDocumentCacheEntry = {
  document: AsmDocument;
  mtimeMs: number;
};

// Disk-read include documents, keyed by pathKey. Entries carry the file's
// mtime so a hit can be verified against the file system: a stale entry
// (file changed without a watched-file event) is re-read instead of served.
export type DiskDocumentCache = Map<string, DiskDocumentCacheEntry>;

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

export function uriToPath(uri: string): string {
  if (!uri.startsWith("file://")) {
    return uri;
  }
  try {
    return fileURLToPath(uri);
  } catch {
    return uri;
  }
}

export function normalizeUri(uri: string): string {
  if (!uri.startsWith("file://")) {
    return uri;
  }
  try {
    const normalizedPath = path.normalize(fileURLToPath(uri));
    // Stable casing on Windows: lowercase the drive letter so
    // file:///c:/x and file:///C:/x normalize to the same URI.
    return pathToFileURL(normalizedPath).toString().replace(/^file:\/\/\/[A-Z](?=%3A|:)/, (drive) => drive.toLowerCase());
  } catch {
    return uri;
  }
}

export function pathToUri(filePath: string): string {
  if (filePath.startsWith("untitled:")) {
    return filePath;
  }
  return normalizeUri(pathToFileURL(filePath).toString());
}

export async function indexWorkspace(
  entryPath: string,
  overrides?: ReadonlyMap<string, AsmDocument>,
  dialect: CpuDialect = CpuDialect.EZ80,
  isAsmsx: boolean = false,
  diskCache?: DiskDocumentCache
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
  diskCache?: DiskDocumentCache
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
    const cached = diskCache?.get(key);
    if (cached !== undefined) {
      try {
        const stats = await fs.promises.stat(filePath);
        if (stats.mtimeMs <= cached.mtimeMs) {
          document = cached.document;
        } else {
          document = new AsmDocument(await fs.promises.readFile(filePath, "utf8"), dialect, isAsmsx);
          diskCache?.set(key, { document, mtimeMs: stats.mtimeMs });
        }
      } catch {
        diskCache?.delete(key);
        return;
      }
    } else {
      try {
        document = new AsmDocument(await fs.promises.readFile(filePath, "utf8"), dialect, isAsmsx);
        try {
          const stats = await fs.promises.stat(filePath);
          diskCache?.set(key, { document, mtimeMs: stats.mtimeMs });
        } catch {
          // Cannot stat (mocked or special fs): serve from disk every time.
        }
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
