import { WorkspaceEdit, TextEdit } from "vscode-languageserver/node";
import { AsmDocument } from "../asm/document";

import { getSymbolAtPosition, findReferences } from "./symbol-navigation";
import { SymbolCollector } from "../asm/symbols";

/** Validate that `newName` is a legal Z80/eZ80 identifier (or .local form). */
function isValidIdentifier(name: string): boolean {
  return /^(\.|@{1,2})?[A-Za-z_][A-Za-z0-9_]*$/.test(name);
}

/** Walk backwards from `line` to find the enclosing global label name. */
function resolveGlobalScope(document: AsmDocument, line: number): string | null {
  for (let i = line; i >= 0; i--) {
    const node = document.lines[i];
    if (node && node.label && !node.label.startsWith("@") && !node.label.startsWith(".")) {
      return node.label;
    }
  }
  return null;
}

/**
 * Compute the fully-scoped symbol name at (line, character):
 *   - global "FOO"  → resolved = "FOO"
 *   - local ".bar" inside "start" → resolved = "start.bar"
 * Returns null if no symbol is at the position.
 */
function resolveSymbolName(
  document: AsmDocument,
  line: number,
  character: number
): { resolved: string; isLocal: boolean } | null {
  const symbolAtPos = getSymbolAtPosition(document, line, character);
  if (symbolAtPos === null) return null;
  
  if (symbolAtPos.isLocal) {
    const scope = resolveGlobalScope(document, line);
    const resolved = scope ? scope + symbolAtPos.name : symbolAtPos.name;
    return { resolved, isLocal: true };
  }
  return { resolved: symbolAtPos.name, isLocal: false };
}

/**
 * Build a workspace edit that renames all occurrences of the symbol under
 * the cursor to `newName`.  Returns null when the rename is refused:
 *   - no symbol at position
 *   - newName is not a valid identifier
 *   - the symbol has no definition (e.g. a mnemonic or unknown identifier)
 *   - the symbol has multiple definitions (ambiguous rename target)
 *   - the symbol is a local label and newName crosses the local boundary
 *     (e.g. user tries to rename `@loop` to `loop` or vice-versa)
 */
export async function buildRenameEdits(
  openDocuments: ReadonlyMap<string, AsmDocument>,
  uri: string,
  line: number,
  character: number,
  newName: string
): Promise<WorkspaceEdit | null> {
  if (!isValidIdentifier(newName)) {
    return null;
  }

  const document = openDocuments.get(uri);
  if (document === undefined) {
    return null;
  }

  const symbolAtPos = getSymbolAtPosition(document, line, character);
  if (symbolAtPos === null) {
    return null;
  }
  
  if (symbolAtPos.name === '@@' || symbolAtPos.name === '@b' || symbolAtPos.name === '@f') {
    return null;
  }

  // A local symbol must stay local and a global symbol must stay global.
  const newIsLocal = newName.startsWith("@") || newName.startsWith(".");
  if (symbolAtPos.isLocal !== newIsLocal) {
    return null;
  }

  // Resolve the fully-scoped name (e.g. "start.loop" for ".loop" inside "start").
  const resolved = resolveSymbolName(document, line, character);
  if (resolved === null) {
    return null;
  }
  const resolvedName = resolved.resolved;

  // Count definitions for this symbol across all open documents.
  // Refuse if there are 0 (not a defined symbol — e.g. a mnemonic or forward
  // reference) or >1 (duplicate definition — ambiguous rename target).
  let definitionCount = 0;
  for (const doc of openDocuments.values()) {
    const collector = new SymbolCollector(doc);
    for (const sym of collector.getSymbols()) {
      if (sym.name === resolvedName) {
        definitionCount++;
      }
    }
  }

  if (definitionCount === 0 || definitionCount > 1) {
    return null;
  }

  // Collect all sites where the symbol appears.
  // findReferences(includeDeclaration:true) returns two kinds of ranges:
  //   (a) full-line ranges from SymbolCollector: start.character === 0,
  //       span = full line length.
  //   (b) token-level ranges from the token scan: span === display-name length.
  // We want only (b) so that each TextEdit replaces exactly the token text.
  // The display name is the unscoped form: "MY_LABEL" (global) or "@loop" (local).
  const allLocations = await findReferences(openDocuments, uri, line, character, true);

  const displayName = symbolAtPos.name; // e.g. "MY_LABEL" or "@loop"
  const tokenLen = displayName.length;

  const tokenLocations = allLocations.filter((loc) => {
    const span = loc.range.end.character - loc.range.start.character;
    // Token-level ranges exactly match the display-name width.
    // Full-line ranges from SymbolCollector will be wider.
    return span === tokenLen;
  });

  if (tokenLocations.length === 0) {
    return null;
  }

  // Build the workspace edit.
  const changes: Record<string, TextEdit[]> = {};

  for (const loc of tokenLocations) {
    if (!changes[loc.uri]) {
      changes[loc.uri] = [];
    }
    changes[loc.uri].push(TextEdit.replace(loc.range, newName));
  }

  return { changes };
}
