import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { normalizeUri } from "../src/asm/workspace";

import { AsmDocument } from "../src/asm/document";
import { CpuDialect } from "../src/asm/metadata";
import { findDefinition, findReferences } from "../src/lsp/symbol-navigation";

test("findDefinition resolves symbols in untitled documents", async () => {
  const untitledUri = "untitled:Untitled-1";
  const openDocuments = new Map([
    [untitledUri, new AsmDocument("start:\n  jp start\n", CpuDialect.EZ80)]
  ]);

  const definition = await findDefinition(openDocuments, untitledUri, 1, 6);

  assert.ok(definition && !Array.isArray(definition));
  assert.equal(definition.uri, untitledUri);
  assert.equal(definition.range.start.line, 0);
});

test("findReferences still works for file URIs while an untitled document is open", async () => {
  const filePath = path.resolve("/symbol-navigation-main.asm");
  const fileUri = normalizeUri(pathToFileURL(filePath).href);
  const untitledUri = "untitled:Untitled-1";
  const openDocuments = new Map([
    [fileUri, new AsmDocument("MAIN_LABEL:\n  jp MAIN_LABEL\n", CpuDialect.EZ80)],
    [untitledUri, new AsmDocument("OTHER_LABEL:\n  jp OTHER_LABEL\n", CpuDialect.EZ80)]
  ]);

  const references = await findReferences(openDocuments, fileUri, 1, 9, true);

  assert.ok(references.length >= 2);
  assert.ok(references.every((location) => location.uri === fileUri));
});
