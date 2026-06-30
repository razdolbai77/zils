import { CallHierarchyItem, CallHierarchyIncomingCall, CallHierarchyOutgoingCall, SymbolKind } from "vscode-languageserver/node";
import { AsmDocument } from "../asm/document";
import { getSymbolAtPosition, findReferences, findDefinition } from "./symbol-navigation";
import { SymbolCollector } from "../asm/symbols";

function createCallHierarchyItem(uri: string, name: string, lineIndex: number, labelStart: number, labelLength: number): CallHierarchyItem {
  return {
    name,
    kind: SymbolKind.Function,
    uri,
    range: {
      start: { line: lineIndex, character: 0 },
      end: { line: lineIndex, character: labelStart + labelLength }
    },
    selectionRange: {
      start: { line: lineIndex, character: labelStart },
      end: { line: lineIndex, character: labelStart + labelLength }
    }
  };
}

export function prepareCallHierarchy(
  openDocuments: ReadonlyMap<string, AsmDocument>,
  uri: string,
  line: number,
  character: number
): CallHierarchyItem[] | null {
  const document = openDocuments.get(uri);
  if (!document) return null;

  const targetSymbol = getSymbolAtPosition(document, line, character);
  if (!targetSymbol) return null;

  const items: CallHierarchyItem[] = [];

  const defLocationOrLocations = findDefinition(openDocuments, uri, line, character);
  const defLocations = Array.isArray(defLocationOrLocations) ? defLocationOrLocations : (defLocationOrLocations ? [defLocationOrLocations] : []);

  for (const def of defLocations) {
    const doc = openDocuments.get(def.uri);
    if (!doc) continue;
    const defLine = doc.lines[def.range.start.line];
    if (defLine && defLine.label) {
      items.push(createCallHierarchyItem(
        def.uri,
        defLine.label,
        def.range.start.line,
        defLine.labelToken ? defLine.labelToken.start : 0,
        defLine.labelToken ? defLine.labelToken.length : defLine.label.length
      ));
    }
  }

  return items.length > 0 ? items : null;
}

export function provideCallHierarchyIncomingCalls(
  openDocuments: ReadonlyMap<string, AsmDocument>,
  item: CallHierarchyItem
): CallHierarchyIncomingCall[] | null {
  const incoming = new Map<string, CallHierarchyIncomingCall>();

  const refs = findReferences(openDocuments, item.uri, item.range.start.line, item.selectionRange.start.character, false);
  
  for (const ref of refs) {
      const refDoc = openDocuments.get(ref.uri);
      if (!refDoc) continue;
      const pLine = refDoc.lines[ref.range.start.line];
      if (!pLine || !pLine.mnemonic) continue;
      
      const mnemonic = pLine.mnemonic.toLowerCase();
      if (mnemonic !== "call" && mnemonic !== "jp" && mnemonic !== "jr") continue;
      
      let callerName = "";
      let callerLineIndex = 0;
      for (let i = ref.range.start.line; i >= 0; i--) {
          const l = refDoc.lines[i];
          if (l && l.label && !l.label.startsWith("@")) {
              callerName = l.label;
              callerLineIndex = i;
              break;
          }
      }
      if (!callerName) continue;

      const key = `${ref.uri}#${callerName}`;
      let incomingCall = incoming.get(key);
      if (!incomingCall) {
          const callerDocLine = refDoc.lines[callerLineIndex];
          incomingCall = {
              from: createCallHierarchyItem(
                  ref.uri,
                  callerName,
                  callerLineIndex,
                  callerDocLine.labelToken ? callerDocLine.labelToken.start : 0,
                  callerName.length
              ),
              fromRanges: []
          };
          incoming.set(key, incomingCall);
      }
      incomingCall.fromRanges.push(ref.range);
  }

  return incoming.size > 0 ? Array.from(incoming.values()) : null;
}

export function provideCallHierarchyOutgoingCalls(
  openDocuments: ReadonlyMap<string, AsmDocument>,
  item: CallHierarchyItem
): CallHierarchyOutgoingCall[] | null {
  const cached = openDocuments.get(item.uri);
  if (!cached) return null;

  const startLine = item.range.start.line;
  const pLine = cached.lines[startLine];
  if (!pLine || !pLine.label) return null;

  const outgoing = new Map<string, CallHierarchyOutgoingCall>();

  for (let i = startLine + 1; i < cached.lines.length; i++) {
    const line = cached.lines[i];
    if (line.label && !line.label.startsWith("@")) {
      break; 
    }

    if (line.mnemonic) {
      const mnemonic = line.mnemonic.toLowerCase();
      if (mnemonic === "call" || mnemonic === "jp" || mnemonic === "jr") {
        if (!line.operands || line.operands.length === 0) continue;
        
        let targetName: string | null = null;
        let targetTokenStart = 0;
        let targetTokenLength = 0;

        for (const token of line.operands[0]) {
            if (token.type === "Identifier") {
                targetName = token.value;
                targetTokenStart = token.start;
                targetTokenLength = token.length;
                break;
            }
        }

        if (targetName) {
            for (const [docUri, docCached] of openDocuments.entries()) {
                const collector = new SymbolCollector(docCached);
                for (const sym of collector.getSymbols()) {
                    if (sym.name === targetName || sym.name.endsWith("." + targetName)) {
                        const defLine = docCached.lines[sym.line];
                        if (defLine && defLine.label) {
                            const key = `${docUri}#${sym.name}`;
                            let outgoingCall = outgoing.get(key);
                            if (!outgoingCall) {
                                outgoingCall = {
                                    to: createCallHierarchyItem(
                                        docUri,
                                        sym.name,
                                        sym.line,
                                        defLine.labelToken ? defLine.labelToken.start : 0,
                                        sym.name.length
                                    ),
                                    fromRanges: []
                                };
                                outgoing.set(key, outgoingCall);
                            }
                            outgoingCall.fromRanges.push({
                                start: { line: i, character: targetTokenStart },
                                end: { line: i, character: targetTokenStart + targetTokenLength }
                            });
                        }
                    }
                }
            }
        }
      }
    }
  }

  return outgoing.size > 0 ? Array.from(outgoing.values()) : null;
}
