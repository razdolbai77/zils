import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import * as assert from 'node:assert/strict';

type ExtensionManifest = {
  contributes: {
    configurationDefaults: Record<string, Record<string, unknown>>;
  };
};

const manifest = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, '..', 'package.json'), 'utf8')
) as ExtensionManifest;

test('Zaets reads tab settings from workspace configuration', () => {
  for (const language of ['[z80]', '[ez80]']) {
    const defaults = manifest.contributes.configurationDefaults[language];
    assert.equal(defaults['editor.tabSize'], undefined);
    assert.equal(defaults['editor.indentSize'], undefined);
  }
});
