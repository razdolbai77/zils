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
};

export type FailedInclude = {
  includerPath: string;
  line: number;
  startCharacter: number;
  length: number;
  resolvedPath: string;
};

const includeDirectives = new Set(["include", ".include", "maclib"]);

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

  const resolvedEntry = entryPath.startsWith("untitled:")
    ? entryPath
    : path.resolve(entryPath);
  await visitFile(resolvedEntry, documents, dependencies, failedIncludes, loadOrder, overrides, dialect, isAsmsx, diskCache);

  for (const filePath of loadOrder) {
    const document = documents.get(filePath);
    if (document === undefined) {
      continue;
    }

    const collector = new SymbolCollector(document);
    for (const symbol of collector.getSymbols()) {
      symbols.set(symbol.name, {
        name: symbol.name,
        kind: symbol.kind,
        line: symbol.line,
        filePath,
        docComment: symbol.docComment
      });
    }
  }

  return {
    documents,
    dependencies,
    loadOrder,
    symbols,
    failedIncludes
  };
}

async function visitFile(
  filePath: string,
  documents: Map<string, AsmDocument>,
  dependencies: Map<string, readonly string[]>,
  failedIncludes: FailedInclude[],
  loadOrder: string[],
  overrides?: ReadonlyMap<string, AsmDocument>,
  dialect: CpuDialect = CpuDialect.EZ80,
  isAsmsx: boolean = false,
  diskCache?: Map<string, AsmDocument>
): Promise<void> {
  if (documents.has(filePath)) {
    return;
  }
  let document: AsmDocument;
  const override = overrides?.get(filePath);
  if (override !== undefined) {
    document = override;
  } else {
    if (filePath.startsWith("untitled:")) {
      return;
    }
    const cachedDocument = diskCache?.get(filePath);
    if (cachedDocument !== undefined) {
      document = cachedDocument;
    } else {
      try {
        document = new AsmDocument(await fs.promises.readFile(filePath, "utf8"), dialect, isAsmsx);
        diskCache?.set(filePath, document);
      } catch {
        return;
      }
    }
  }

  documents.set(filePath, document);
  loadOrder.push(filePath);

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
      resolvedPath: path.resolve(path.dirname(filePath), includePath),
      line: lineIndex,
      startCharacter: first.start - (line.start ?? 0),
      length: last.start + last.length - first.start
    }];
  });

  dependencies.set(filePath, includeRefs.map((ref) => ref.resolvedPath));

  for (const ref of includeRefs) {
    const alreadyIndexed = documents.has(ref.resolvedPath);
    await visitFile(ref.resolvedPath, documents, dependencies, failedIncludes, loadOrder, overrides, dialect, isAsmsx, diskCache);
    if (!alreadyIndexed && !documents.has(ref.resolvedPath)) {
      failedIncludes.push({ includerPath: filePath, ...ref });
    }
  }
}

function readIncludePath(operand: Token[]): string | null {
  if (operand.length === 0) return null;
  if (operand[0].type === TokenType.String) {
      return operand[0].rawValue ?? operand[0].value;
  }

  const reconstructedPath = operand.map((token) => token.value).join("");
  return reconstructedPath.length > 0 ? reconstructedPath : null;
}
