import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { AsmDocument } from "../src/asm/document";
import { CpuDialect } from "../src/asm/metadata";
import { findReferences } from "../src/lsp/symbol-navigation";

test("findReferences respects includeDeclaration for global labels", async () => {
  const filePath = path.resolve("/symbol-navigation-references.asm");
  const fileUri = pathToFileURL(filePath).href;
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
      }
    }
  ]);
  assert.deepEqual(withDeclaration, [
    {
      uri: fileUri,
      range: {
        start: { line: 0, character: 0 },
        end: { line: 0, character: 5 }
      }
    },
    {
      uri: fileUri,
      range: {
        start: { line: 0, character: 0 },
        end: { line: 0, character: 4 }
      }
    },
    {
      uri: fileUri,
      range: {
        start: { line: 1, character: 5 },
        end: { line: 1, character: 9 }
      }
    }
  ]);
});

test("findReferences respects includeDeclaration for local labels", async () => {
  const filePath = path.resolve("/symbol-navigation-local-references.asm");
  const fileUri = pathToFileURL(filePath).href;
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
      }
    }
  ]);
  assert.deepEqual(withDeclaration, [
    {
      uri: fileUri,
      range: {
        start: { line: 1, character: 0 },
        end: { line: 1, character: 7 }
      }
    },
    {
      uri: fileUri,
      range: {
        start: { line: 1, character: 0 },
        end: { line: 1, character: 6 }
      }
    },
    {
      uri: fileUri,
      range: {
        start: { line: 2, character: 5 },
        end: { line: 2, character: 11 }
      }
    }
  ]);
});
