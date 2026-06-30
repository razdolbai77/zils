import { TextDocument, TextEditor } from 'vscode';

export const zaetsEditorOptions = {
  indentSize: 8,
  tabSize: 8
} as const;

export function isZaetsDocument(document: TextDocument): boolean {
  return document.languageId === 'z80' || document.languageId === 'ez80';
}

export function applyZaetsEditorOptions(editor: TextEditor): boolean {
  if (!isZaetsDocument(editor.document)) {
    return false;
  }

  editor.options = {
    ...editor.options,
    ...zaetsEditorOptions
  };
  return true;
}
