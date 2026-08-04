import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { normalizeUri } from "../src/asm/workspace";

import { AsmDocument } from "../src/asm/document";
import { CpuDialect } from "../src/asm/metadata";
import { buildCodeLenses } from "../src/lsp/code-lens";

test("code lenses count cross-document references without counting declarations", async () => {
  const mainUri = normalizeUri(pathToFileURL(path.resolve("/main.asm")).href);
  const depUri = normalizeUri(pathToFileURL(path.resolve("/dep.asm")).href);
  const openDocuments = new Map([
    [mainUri, new AsmDocument("MAIN:\n  jp MAIN\nOTHER:\n  jp MAIN\n", CpuDialect.Z80)],
    [depUri, new AsmDocument("  jp MAIN\n", CpuDialect.Z80)]
  ]);

  const lenses = await buildCodeLenses(openDocuments, mainUri);

  const mainLens = lenses.find((lens) => lens.range.start.line === 0);
  const otherLens = lenses.find((lens) => lens.range.start.line === 2);

  assert.equal(mainLens?.command?.title, "3 references");
  assert.equal(otherLens?.command?.title, "0 references");
});
