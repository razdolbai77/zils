import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import {
  applyZaetsEditorOptions,
  isZaetsDocument
} from './editor-options';

test('isZaetsDocument matches only the Zaets language id', () => {
  assert.equal(isZaetsDocument({ languageId: 'z80' } as { languageId: string } & never), true);
  assert.equal(isZaetsDocument({ languageId: 'ez80' } as { languageId: string } & never), true);
  assert.equal(isZaetsDocument({ languageId: 'plaintext' } as { languageId: string } & never), false);
});

test('applyZaetsEditorOptions sets hard tabs with width 8 for z80 editors', () => {
  const editor = {
    document: { languageId: 'z80' },
    options: { insertSpaces: true, tabSize: 4, indentSize: 4 }
  };

  const changed = applyZaetsEditorOptions(editor as never);

  assert.equal(changed, true);
  assert.deepEqual(editor.options, { insertSpaces: true, tabSize: 8, indentSize: 8 });
});

test('applyZaetsEditorOptions sets hard tabs with width 8 for ez80 editors', () => {
  const editor = {
    document: { languageId: 'ez80' },
    options: { insertSpaces: true, tabSize: 4, indentSize: 4 }
  };

  const changed = applyZaetsEditorOptions(editor as never);

  assert.equal(changed, true);
  assert.deepEqual(editor.options, { insertSpaces: true, tabSize: 8, indentSize: 8 });
});

test('applyZaetsEditorOptions skips non-z80/ez80 editors', () => {
  const editor = {
    document: { languageId: 'plaintext' },
    options: { insertSpaces: true, tabSize: 4, indentSize: 4 }
  };

  const changed = applyZaetsEditorOptions(editor as never);

  assert.equal(changed, false);
  assert.deepEqual(editor.options, { insertSpaces: true, tabSize: 4, indentSize: 4 });
});
