import { DocumentHighlight, DocumentHighlightKind } from "vscode-languageserver/node";
import { AsmDocument } from "../asm/document";
import { findReferences, findDefinition } from "./symbol-navigation";
import { normalizeUri } from "../asm/workspace";

export async function buildDocumentHighlights(
  openDocuments: ReadonlyMap<string, AsmDocument>,
  uri: string,
  line: number,
  character: number
): Promise<DocumentHighlight[]> {
  const document = openDocuments.get(uri);
  if (!document) return [];

  const references = await findReferences(openDocuments, uri, line, character, true);
  const normalizedUri = normalizeUri(uri);

  const defLocationOrLocations = await findDefinition(openDocuments, uri, line, character);
  const defLocations = Array.isArray(defLocationOrLocations) ? defLocationOrLocations : (defLocationOrLocations ? [defLocationOrLocations] : []);

  const defSet = new Set(defLocations.map(l => JSON.stringify(l)));

  const uniqueHighlights = new Map<string, DocumentHighlight>();

  for (const ref of references) {
    if (ref.uri === normalizedUri) {
      const isDef = defSet.has(JSON.stringify(ref));
      const key = `${ref.range.start.line}:${ref.range.start.character}`;
      if (!uniqueHighlights.has(key) || isDef) {
        uniqueHighlights.set(key, {
          range: ref.range,
          kind: isDef ? DocumentHighlightKind.Write : DocumentHighlightKind.Read
        });
      }
    }
  }

  return Array.from(uniqueHighlights.values());
}
