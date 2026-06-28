import { SymbolInformation, SymbolKind } from "vscode-languageserver/node";
import { AsmDocument } from "../asm/document";
import { SymbolCollector } from "../asm/symbols";

export function buildDocumentSymbols(uri: string, document: AsmDocument): SymbolInformation[] {
  const symbols: SymbolInformation[] = [];
  const collector = new SymbolCollector(document);
  const infos = collector.getSymbols();

  for (const info of infos) {
    const lineText = document.source.split(/\r?\n/)[info.line] ?? "";
    const kind = info.isEquate ? SymbolKind.Variable : SymbolKind.Function;
    
    symbols.push({
      name: info.name,
      kind,
      location: {
        uri,
        range: {
          start: { line: info.line, character: 0 },
          end: { line: info.line, character: lineText.length }
        }
      }
    });
  }

  return symbols;
}
