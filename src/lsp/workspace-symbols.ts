import { SymbolInformation, WorkspaceSymbol } from "vscode-languageserver/node";
import { AsmDocument } from "../asm/document";
import { buildDocumentSymbols } from "./document-symbols";

export function buildWorkspaceSymbols(
  openDocuments: ReadonlyMap<string, AsmDocument>,
  query: string
): WorkspaceSymbol[] {
  const symbols: WorkspaceSymbol[] = [];

  for (const [uri, document] of openDocuments.entries()) {
    const documentSymbols = buildDocumentSymbols(uri, document);
    for (const symbol of documentSymbols) {
      if (matchesQuery(symbol, query)) {
        symbols.push({
          name: symbol.name,
          kind: symbol.kind,
          location: symbol.location
        });
      }
    }
  }

  return symbols;
}

function matchesQuery(symbol: SymbolInformation, query: string): boolean {
  const normalizedQuery = query.trim().toLowerCase();
  if (normalizedQuery.length === 0) {
    return true;
  }
  return symbol.name.toLowerCase().includes(normalizedQuery);
}
