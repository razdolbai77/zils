import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { normalizeUri } from "../src/asm/workspace";

import { AsmDocument } from "../src/asm/document";
import { CpuDialect } from "../src/asm/metadata";
import { findDefinition, findReferences, resolveScope } from "../src/lsp/symbol-navigation";

test("resolveScope finds only enclosing global labels", () => {
  const document = new AsmDocument("GLOBAL:\n.local:\n@@:\n  nop", CpuDialect.Z80, true);

  assert.equal(resolveScope(document, 3), "GLOBAL");
  assert.equal(resolveScope(document, 0), "GLOBAL");
  assert.equal(resolveScope(new AsmDocument("@local:\n  nop", CpuDialect.EZ80), 1), null);
});

test("findReferences respects includeDeclaration for global labels", async () => {
  const filePath = path.resolve("/symbol-navigation-references.asm");
  const fileUri = normalizeUri(pathToFileURL(filePath).href);
  const openDocuments = new Map([
    [fileUri, new AsmDocument("MAIN:\n  jp MAIN\n", CpuDialect.EZ80)]
  ]);

  const referencesOnly = await findReferences(openDocuments, fileUri, 1, 6, false);
  const withDeclaration = await findReferences(openDocuments, fileUri, 1, 6, true);

  assert.deepEqual(referencesOnly, [
    {
      uri: fileUri,
      range: {
        start: { line: 1, character: 5 },
        end: { line: 1, character: 9 }
      },
      definition: false
    }
  ]);
  assert.deepEqual(withDeclaration, [
    {
      uri: fileUri,
      range: {
        start: { line: 0, character: 0 },
        end: { line: 0, character: 4 }
      },
      definition: true
    },
    {
      uri: fileUri,
      range: {
        start: { line: 1, character: 5 },
        end: { line: 1, character: 9 }
      },
      definition: false
    }
  ]);
});

test("findReferences respects includeDeclaration for local labels", async () => {
  const filePath = path.resolve("/symbol-navigation-local-references.asm");
  const fileUri = normalizeUri(pathToFileURL(filePath).href);
  const openDocuments = new Map([
    [fileUri, new AsmDocument("GLOBAL:\n.local:\n  jp .local\n", CpuDialect.Z80, true)]
  ]);

  const referencesOnly = await findReferences(openDocuments, fileUri, 2, 8, false);
  const withDeclaration = await findReferences(openDocuments, fileUri, 2, 8, true);

  assert.deepEqual(referencesOnly, [
    {
      uri: fileUri,
      range: {
        start: { line: 2, character: 5 },
        end: { line: 2, character: 11 }
      },
      definition: false
    }
  ]);
  assert.deepEqual(withDeclaration, [
    {
      uri: fileUri,
      range: {
        start: { line: 1, character: 0 },
        end: { line: 1, character: 6 }
      },
      definition: true
    },
    {
      uri: fileUri,
      range: {
        start: { line: 2, character: 5 },
        end: { line: 2, character: 11 }
      },
      definition: false
    }
  ]);
});

test("resolves eZ80 anonymous next and previous aliases", async () => {
  const filePath = path.resolve("/anonymous-aliases.ez80");
  const fileUri = normalizeUri(pathToFileURL(filePath).href);
  const openDocuments = new Map([
    [fileUri, new AsmDocument("@@:\n  jr @n\n@@:\n  jr @p\n", CpuDialect.EZ80)]
  ]);

  const nextDefinition = await findDefinition(openDocuments, fileUri, 1, 6);
  const previousDefinition = await findDefinition(openDocuments, fileUri, 3, 6);


  const references = await findReferences(openDocuments, fileUri, 2, 0, true);
  assert.deepEqual(references.map((reference) => reference.range.start.line), [2, 3, 1]);
  assert.deepEqual(nextDefinition, {
    uri: fileUri,
    range: { start: { line: 2, character: 0 }, end: { line: 2, character: 2 } }
  });
  assert.deepEqual(previousDefinition, {
    uri: fileUri,
    range: { start: { line: 2, character: 0 }, end: { line: 2, character: 2 } }
  });
});

test("go-to-definition lands in the entry file when an include shadows it", async () => {
  const entryPath = path.resolve("/shadow-entry-main.asm");
  const includePath = path.resolve("/shadow-entry-lib.asm");
  const entryUri = normalizeUri(pathToFileURL(entryPath).href);
  const includeUri = normalizeUri(pathToFileURL(includePath).href);
  const openDocuments = new Map([
    [entryUri, new AsmDocument("  include \"shadow-entry-lib.asm\"\nshared:\n  jp shared\n", CpuDialect.EZ80)],
    [includeUri, new AsmDocument("shared:\n  ret\n", CpuDialect.EZ80)]
  ]);

  const definition = await findDefinition(openDocuments, entryUri, 2, 6);

  assert.ok(definition !== null);
  const locations = Array.isArray(definition) ? definition : [definition];
  assert.equal(locations.length, 2, "both definitions must be reported");
  assert.equal(locations[0].uri, entryUri, "the entry file's definition must come first");
  assert.equal(locations[0].range.start.line, 1);
  assert.equal(locations[1].uri, includeUri);
  assert.equal(locations[1].range.start.line, 0);
});
