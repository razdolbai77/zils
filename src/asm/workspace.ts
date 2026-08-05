import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { AsmDocument } from "./document";
import type { SymbolKind } from "./symbols";
import { getCachedCollector } from "./symbol-cache";
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
  // Every definition of each symbol, in load order (entry file first).
  // Consumers that need a single winner take the first entry; consumers
  // that list definitions see them all.
  symbols: ReadonlyMap<string, readonly WorkspaceSymbol[]>;
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

const includeDirectives = new Set(["include", "maclib"]);

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
  const loadOrder: string[] = [];
  const symbols = new Map<string, WorkspaceSymbol[]>();
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

    const collector = getCachedCollector(document);
    for (const symbol of collector.getSymbols()) {
      const definition: WorkspaceSymbol = {
        name: symbol.name,
        kind: symbol.kind,
        line: symbol.line,
        filePath: canonicalPath,
        docComment: symbol.docComment
      };
      const existing = symbols.get(symbol.name);
      if (existing === undefined) {
        symbols.set(symbol.name, [definition]);
      } else {
        existing.push(definition);
      }
    }
  }

  return {
    documents,
    symbols,
    failedIncludes,
    pathIndex
  };
}

// Combine several indexes of the same workspace (one per root file) into
// a single index. The shared documents/pathIndex make every per-root index
// mostly identical; merging dedupes symbol definitions and failed includes
// so collectDiagnostics can walk one workspace per request instead of
// re-indexing for every open root.
export function mergeIndexedWorkspaces(workspaces: readonly IndexedWorkspace[]): IndexedWorkspace {
  const documents = new Map<string, AsmDocument>();
  const symbols = new Map<string, WorkspaceSymbol[]>();
  const failedIncludes: FailedInclude[] = [];
  const pathIndex = new Map<string, string>();
  const seenSymbols = new Set<string>();
  const seenFailedIncludes = new Set<string>();

  for (const workspace of workspaces) {
    for (const [canonicalPath, document] of workspace.documents.entries()) {
      if (!documents.has(canonicalPath)) {
        documents.set(canonicalPath, document);
      }
    }

    for (const [key, canonicalPath] of workspace.pathIndex.entries()) {
      if (!pathIndex.has(key)) {
        pathIndex.set(key, canonicalPath);
      }
    }

    for (const [name, definitions] of workspace.symbols.entries()) {
      const merged = symbols.get(name);
      if (merged === undefined) {
        symbols.set(name, []);
      }
      for (const definition of definitions) {
        const dedupeKey = `${definition.filePath}#${definition.line}#${definition.kind}`;
        if (!seenSymbols.has(dedupeKey)) {
          seenSymbols.add(dedupeKey);
          symbols.get(name)!.push(definition);
        }
      }
    }

    for (const failed of workspace.failedIncludes) {
      const dedupeKey = `${failed.includerPath}#${failed.line}#${failed.resolvedPath}`;
      if (!seenFailedIncludes.has(dedupeKey)) {
        seenFailedIncludes.add(dedupeKey);
        failedIncludes.push(failed);
      }
    }
  }

  return { documents, symbols, failedIncludes, pathIndex };
}

async function visitFile(
  filePath: string,
  documents: Map<string, AsmDocument>,
  pathIndex: Map<string, string>,
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
  if (canonicalPath.startsWith("untitled:")) {
    return;
  }

  const includeRefs = document.lines.flatMap((line, lineIndex) => {
    if (!line.isDirective || !line.mnemonic || !includeDirectives.has(line.mnemonic.toLowerCase())) {
      return [];
    }

    if (!line.operands || line.operands.length === 0 || line.operands[0].length === 0) {
      return [];
    }

    const includePath = readIncludePath(line.operands[0], document.source, document.dialect);
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

  for (const ref of includeRefs) {
    await visitFile(ref.resolvedPath, documents, pathIndex, failedIncludes, loadOrder, overrides, overrideSpelling, dialect, isAsmsx, diskCache);
    if (!pathIndex.has(pathKey(ref.resolvedPath))) {
      failedIncludes.push({ includerPath: canonicalPath, ...ref });
    }
  }
}

export function readIncludePath(operand: Token[], source: string, dialect: CpuDialect): string | null {
  if (operand.length === 0) return null;
  if (operand[0].type === TokenType.String) {
    return dialect === CpuDialect.EZ80
      ? operand[0].value
      : operand[0].rawValue ?? operand[0].value;
  }

  const first = operand[0];
  const last = operand[operand.length - 1];
  const includePath = source.slice(first.start, last.start + last.length);
  return includePath.length > 0 ? includePath : null;
}
