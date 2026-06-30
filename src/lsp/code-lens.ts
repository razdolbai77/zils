import { CodeLens } from "vscode-languageserver/node";
import { AsmDocument } from "../asm/document";
import { SymbolCollector } from "../asm/symbols";
import { findReferences } from "./symbol-navigation";

export function buildCodeLenses(
  openDocuments: ReadonlyMap<string, AsmDocument>,
  uri: string
): CodeLens[] {
  const document = openDocuments.get(uri);
  if (document === undefined) {
    return [];
  }

  const lenses: CodeLens[] = [];
  const collector = new SymbolCollector(document);
  const definitions = collector.getSymbols();

  for (const definition of definitions) {
    if (definition.isLocal && definition.name !== '@@') {
      continue;
    }
    
    // findReferences in zils expects character position of the symbol on that line.
    // We can just use character 0, because findReferences uses getSymbolAtPosition which checks token ranges.
    // If character 0 falls on the label token, it will work.
    const refs = findReferences(openDocuments, uri, definition.line, 0, false);
    
    // Deduplicate any overlapping references that happen to be at the same token as definition
    let actualRefs = 0;
    for (const ref of refs) {
        if (ref.uri === uri && ref.range.start.line === definition.line && ref.range.start.character === 0) {
            // Probably the definition itself matched by token scan
            continue;
        }
        actualRefs++;
    }

    const title = actualRefs === 1 ? "1 reference" : `${actualRefs} references`;

    const lineText = document.source.split(/\r?\n/)[definition.line] ?? "";
    
    lenses.push({
      range: {
        start: { line: definition.line, character: 0 },
        end: { line: definition.line, character: lineText.length }
      },
      command: {
        title,
        command: ""
      }
    });
  }

  return lenses;
}
