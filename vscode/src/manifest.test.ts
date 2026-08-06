import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'fs';
import * as path from 'path';

interface ExtensionManifest {
  contributes?: {
    configuration?: {
      properties?: Record<string, unknown>;
    };
    configurationDefaults?: Record<string, Record<string, unknown>>;
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

test('manifest enables automatic suggestions for assembly source', () => {
  const defaults = readManifest().contributes?.configurationDefaults;

  for (const language of ['z80', 'ez80']) {
    const editorDefaults = defaults?.[`[${language}]`];
    assert.deepEqual(editorDefaults?.['editor.quickSuggestions'], {
      other: true,
      comments: false,
      strings: false
    });
    assert.equal(editorDefaults?.['editor.suggestOnTriggerCharacters'], true);
  }
});

test('vscodeignore excludes compiled tests and keeps runtime assets', () => {
  const ignorePath = path.resolve(__dirname, '..', '.vscodeignore');
  const patterns = fs.readFileSync(ignorePath, 'utf8')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'));

  assert.ok(patterns.includes('out/**/*.test.js'));
  assert.ok(patterns.includes('**/*.map'));
  assert.ok(patterns.includes('src/**'));
  assert.ok(patterns.includes('node_modules/@razdolbai/zils/src/**'));

  assert.equal(patterns.includes('out/extension.js'), false);
  assert.equal(patterns.includes('README.md'), false);
  assert.equal(patterns.includes('language-configuration.json'), false);
  assert.equal(patterns.includes('images/icon.jpg'), false);
});

test('compiled out/ contains no orphaned artifacts', () => {
  const outDir = path.resolve(__dirname, '..', 'out');
  const srcDir = path.resolve(__dirname, '..', 'src');

  for (const file of fs.readdirSync(outDir).filter((name) => name.endsWith('.js'))) {
    const sourceName = file.replace(/\.js$/, '.ts');
    assert.ok(
      fs.existsSync(path.join(srcDir, sourceName)),
      `out/${file} has no matching src/${sourceName} — stale artifact from a deleted source`
    );
  }
});

