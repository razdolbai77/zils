import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { normalizeUri } from "../src/asm/workspace";

import { AsmDocument } from "../src/asm/document";
import { CpuDialect } from "../src/asm/metadata";
import { findDefinition, findReferences } from "../src/lsp/symbol-navigation";

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
