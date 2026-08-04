import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import * as assert from 'node:assert/strict';

type LanguageContribution = {
  id: string;
  extensions: string[];
};

type ExtensionManifest = {
  activationEvents?: unknown;
  contributes: {
    configurationDefaults: Record<string, Record<string, unknown>>;
    languages: LanguageContribution[];
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

test('Zaets registers .asm as eZ80 and relies on contribution activation', () => {
  const ez80 = manifest.contributes.languages.find(language => language.id === 'ez80');

  assert.ok(ez80);
  assert.deepEqual(ez80.extensions, ['.ez80', '.asm']);
  assert.equal(manifest.activationEvents, undefined);
});
