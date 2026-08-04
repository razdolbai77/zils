import { DocumentHighlight, DocumentHighlightKind } from "vscode-languageserver/node";
import { AsmDocument } from "../asm/document";
import { type DiskDocumentCache } from "../asm/workspace";
import { findReferences } from "./symbol-navigation";
import { normalizeUri } from "../asm/workspace";

export async function buildDocumentHighlights(
  openDocuments: ReadonlyMap<string, AsmDocument>,
  uri: string,
  line: number,
  character: number,
  diskCache?: DiskDocumentCache
): Promise<DocumentHighlight[]> {
  const document = openDocuments.get(uri);
  if (!document) return [];

  const references = await findReferences(openDocuments, uri, line, character, true, diskCache);
  const normalizedUri = normalizeUri(uri);

  const uniqueHighlights = new Map<string, DocumentHighlight>();

  for (const ref of references) {
    if (ref.uri === normalizedUri) {
      const key = `${ref.range.start.line}:${ref.range.start.character}`;
      if (!uniqueHighlights.has(key)) {
        uniqueHighlights.set(key, {
          range: ref.range,
          kind: ref.definition ? DocumentHighlightKind.Write : DocumentHighlightKind.Read
        });
      }
    }
  }

  return Array.from(uniqueHighlights.values());
}
