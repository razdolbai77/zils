import { SelectionRange, Position, Range } from "vscode-languageserver/node";
import { AsmDocument } from "../asm/document";
import { Lexer } from "../asm/lexer";

export function buildSelectionRanges(
  openDocuments: ReadonlyMap<string, AsmDocument>,
  uri: string,
  positions: Position[]
): SelectionRange[] | null {
  const document = openDocuments.get(uri);
  if (!document) return null;

  const lines = document.source.split(/\r?\n/);
  const totalLines = lines.length;

  const globalLabelLines: number[] = [];
  for (let i = 0; i < document.lines.length; i++) {
    const node = document.lines[i];
    if (node && node.label && !node.label.startsWith("@")) {
      globalLabelLines.push(i);
    }
  }

  const results: SelectionRange[] = [];

  for (const pos of positions) {
    const fileRange: Range = {
      start: { line: 0, character: 0 },
      end: { line: totalLines - 1, character: lines[totalLines - 1].length }
    };

    let parentRange: SelectionRange = { range: fileRange };

    let scopeStart = 0;
    let scopeEnd = totalLines - 1;
    for (const glLine of globalLabelLines) {
      if (glLine <= pos.line) {
        scopeStart = glLine;
      } else {
        scopeEnd = glLine - 1;
        break;
      }
    }
    
    const scopeRange: Range = {
      start: { line: scopeStart, character: 0 },
      end: { line: scopeEnd, character: lines[scopeEnd].length }
    };

    if (!rangesEqual(scopeRange, fileRange)) {
      parentRange = { range: scopeRange, parent: parentRange };
    }

    const lineRange: Range = {
      start: { line: pos.line, character: 0 },
      end: { line: pos.line, character: lines[pos.line].length }
    };

    if (!rangesEqual(lineRange, scopeRange)) {
      parentRange = { range: lineRange, parent: parentRange };
    }

    const docLineText = lines[pos.line];
    if (docLineText !== undefined) {
        const lexer = new Lexer(docLineText);
        const tokens = lexer.tokenize();
        for (const token of tokens) {
            if (pos.character >= token.start && pos.character <= token.start + token.length) {
                const tokenRange: Range = {
                    start: { line: pos.line, character: token.start },
                    end: { line: pos.line, character: token.start + token.length }
                };
                if (!rangesEqual(tokenRange, lineRange)) {
                    parentRange = { range: tokenRange, parent: parentRange };
                }
                break;
            }
        }
    }

    results.push(parentRange);
  }

  return results;
}

function rangesEqual(a: Range, b: Range): boolean {
  return a.start.line === b.start.line &&
         a.start.character === b.start.character &&
         a.end.line === b.end.line &&
         a.end.character === b.end.character;
}
