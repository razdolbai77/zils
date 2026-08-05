import { SymbolInformation, SymbolKind } from "vscode-languageserver/node";
import { AsmDocument } from "../asm/document";
import { getCachedCollector } from "../asm/symbol-cache";

export function buildDocumentSymbols(uri: string, document: AsmDocument): SymbolInformation[] {
  const symbols: SymbolInformation[] = [];
  const collector = getCachedCollector(document);
  const infos = collector.getSymbols();

  // One split per request: every symbol's range end needs its line length.
  const lineLengths = document.source.split(/\r?\n/).map((lineText) => lineText.length);

  for (const info of infos) {
    const lineLength = lineLengths[info.line] ?? 0;
    const kind = info.kind === "macro"
      ? SymbolKind.Function
      : info.kind === "data" || info.kind === "equate"
        ? SymbolKind.Variable
        : SymbolKind.Function;
    symbols.push({
      name: info.name,
      kind,
      location: {
        uri,
        range: {
          start: { line: info.line, character: 0 },
          end: { line: info.line, character: lineLength }
        }
      }
    });
  }

  return symbols;
}
