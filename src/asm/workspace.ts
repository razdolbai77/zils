import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { AsmDocument } from "./document";
import { SymbolCollector } from "./symbols";
import { CpuDialect } from "./metadata";
import { Token, TokenType } from "./lexer";

export type WorkspaceSymbol = {
  name: string;
  kind: "label" | "equate" | "data";
  line: number;
  filePath: string;
};

export type IndexedWorkspace = {
  documents: ReadonlyMap<string, AsmDocument>;
  dependencies: ReadonlyMap<string, readonly string[]>;
  loadOrder: readonly string[];
  symbols: ReadonlyMap<string, WorkspaceSymbol>;
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
  isAsmsx: boolean = false
): Promise<IndexedWorkspace> {
  const documents = new Map<string, AsmDocument>();
  const dependencies = new Map<string, readonly string[]>();
  const loadOrder: string[] = [];
  const symbols = new Map<string, WorkspaceSymbol>();

  const resolvedEntry = entryPath.startsWith("untitled:")
    ? entryPath
    : path.resolve(entryPath);
  
  await visitFile(resolvedEntry, documents, dependencies, loadOrder, overrides, dialect, isAsmsx);

  for (const filePath of loadOrder) {
    const document = documents.get(filePath);
    if (document === undefined) {
      continue;
    }

    const collector = new SymbolCollector(document);
    for (const symbol of collector.getSymbols()) {
      symbols.set(symbol.name, {
        name: symbol.name,
        kind: symbol.isEquate ? "equate" : "label",
        line: symbol.line,
        filePath
      });
    }
  }

  return {
    documents,
    dependencies,
    loadOrder,
    symbols
  };
}

async function visitFile(
  filePath: string,
  documents: Map<string, AsmDocument>,
  dependencies: Map<string, readonly string[]>,
  loadOrder: string[],
  overrides?: ReadonlyMap<string, AsmDocument>,
  dialect: CpuDialect = CpuDialect.EZ80,
  isAsmsx: boolean = false
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
    let source: string;
    try {
      source = await fs.promises.readFile(filePath, "utf8");
    } catch {
      return;
    }
    document = new AsmDocument(source, dialect, isAsmsx);
  }

  documents.set(filePath, document);
  loadOrder.push(filePath);

  const resolvedDependencies = document.lines
    .flatMap((line) => {
      if (!line.isDirective || !line.mnemonic || !includeDirectives.has(line.mnemonic.toLowerCase())) {
        return [];
      }

      if (!line.operands || line.operands.length === 0) {
          return [];
      }

      const includePath = readIncludePath(line.operands[0]);
      if (includePath === null) {
        return [];
      }

      const dir = path.dirname(filePath);
      return [path.resolve(dir, includePath)];
    });

  dependencies.set(filePath, resolvedDependencies);

  for (const dependencyPath of resolvedDependencies) {
    await visitFile(dependencyPath, documents, dependencies, loadOrder, overrides);
  }
}

function readIncludePath(operand: Token[]): string | null {
  if (operand.length === 0) return null;
  // Common case: include "file.asm"
  if (operand[0].type === TokenType.String) {
      return operand[0].value;
  }
  // Fallback: identifier if no quotes used
  if (operand[0].type === TokenType.Identifier) {
      return operand[0].value;
  }
  return null;
}
