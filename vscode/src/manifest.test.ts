import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'fs';
import * as path from 'path';

interface ExtensionManifest {
  contributes?: {
    configuration?: {
      properties?: Record<string, unknown>;
    };
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

test('manifest contributes trace settings for both language client ids', () => {
  const manifest = readManifest();
  const properties = manifest.contributes?.configuration?.properties;

  assert.ok(properties, 'configuration properties should be defined in contributes');
  assert.ok(properties['zaets-z80.trace.server'], 'z80 trace setting should match the client id');
  assert.ok(properties['zaets-ez80.trace.server'], 'ez80 trace setting should match the client id');
  assert.equal(properties['zaets.trace.server'], undefined);
});

