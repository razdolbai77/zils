import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'fs';
import * as path from 'path';

interface ExtensionManifest {
  contributes?: {
    languages?: Array<{ id: string; configuration: string }>;
    grammars?: Array<{ language: string; scopeName: string; path: string }>;
  };
}

function readManifest(): ExtensionManifest {
  const manifestPath = path.resolve(__dirname, '..', 'package.json');
  const raw = fs.readFileSync(manifestPath, 'utf8');
  return JSON.parse(raw) as ExtensionManifest;
}

test('manifest defines languages correctly', () => {
  const manifest = readManifest();
  const languages = manifest.contributes?.languages;

  assert.ok(languages, 'languages should be defined in contributes');
  
  const z80 = languages.find(l => l.id === 'z80');
  assert.ok(z80, 'z80 language should be defined');
  assert.equal(z80.configuration, './language-configuration.json');

  const ez80 = languages.find(l => l.id === 'ez80');
  assert.ok(ez80, 'ez80 language should be defined');
  assert.equal(ez80.configuration, './language-configuration.json');
});

test('manifest defines grammars correctly', () => {
  const manifest = readManifest();
  const grammars = manifest.contributes?.grammars;

  assert.ok(grammars, 'grammars should be defined in contributes');
  
  const z80Grammar = grammars.find(g => g.language === 'z80');
  assert.ok(z80Grammar, 'z80 grammar should be defined');
  assert.equal(z80Grammar.scopeName, 'source.z80');
  assert.equal(z80Grammar.path, './syntaxes/z80.tmLanguage.json');

  const ez80Grammar = grammars.find(g => g.language === 'ez80');
  assert.ok(ez80Grammar, 'ez80 grammar should be defined');
  assert.equal(ez80Grammar.scopeName, 'source.ez80');
  assert.equal(ez80Grammar.path, './syntaxes/ez80.tmLanguage.json');
});
