import { SymbolInformation, WorkspaceSymbol } from "vscode-languageserver/node";
import { AsmDocument } from "../asm/document";
import { buildDocumentSymbols } from "./document-symbols";

const MAX_WORKSPACE_SYMBOLS = 100;

export function buildWorkspaceSymbols(
  openDocuments: ReadonlyMap<string, AsmDocument>,
  query: string
): WorkspaceSymbol[] {
  const symbols: WorkspaceSymbol[] = [];
  const normalizedQuery = query.trim().toLowerCase();

  for (const [uri, document] of openDocuments.entries()) {
    const documentSymbols = buildDocumentSymbols(uri, document);
    for (const symbol of documentSymbols) {
      if (matchesQuery(symbol, normalizedQuery)) {
        symbols.push({
          name: symbol.name,
          kind: symbol.kind,
          location: symbol.location
        });
        if (symbols.length === MAX_WORKSPACE_SYMBOLS) {
          return symbols;
        }
      }
    }
  }

  return symbols;
}

function matchesQuery(symbol: SymbolInformation, normalizedQuery: string): boolean {
  return normalizedQuery.length === 0 || symbol.name.toLowerCase().includes(normalizedQuery);
}
