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

test("code lens ranges end at the definition line's last character", async () => {
  const uri = normalizeUri(pathToFileURL(path.resolve("/lens-ranges.z80")).href);
  const openDocuments = new Map([
    [uri, new AsmDocument("SHORT:\nVERY_LONG_LABEL_NAME:\n  nop\n", CpuDialect.Z80)]
  ]);

  const lenses = await buildCodeLenses(openDocuments, uri);

  assert.equal(lenses.length, 2);
  assert.equal(lenses[0].range.end.character, "SHORT:".length);
  assert.equal(lenses[1].range.end.character, "VERY_LONG_LABEL_NAME:".length);
});

test("code lenses resolve anonymous-label references positionally", async () => {
  const uri = normalizeUri(pathToFileURL(path.resolve("/anon-count.z80")).href);
  const openDocuments = new Map([
    [uri, new AsmDocument("@@:\n  jr @f\n@@:\n  jr @b\n", CpuDialect.Z80, true)]
  ]);

  const lenses = await buildCodeLenses(openDocuments, uri);

  // @f on line 1 reaches the second @@, @b on line 3 reaches it too... no:
  // @f resolves FORWARD (line 2), @b resolves BACKWARD (line 2).
  assert.equal(lenses.find((lens) => lens.range.start.line === 0)?.command?.title, "0 references");
  assert.equal(lenses.find((lens) => lens.range.start.line === 2)?.command?.title, "2 references");
});

test("a bare @@ token never credits every anonymous lens", async () => {
  const uri = normalizeUri(pathToFileURL(path.resolve("/bare-anon.z80")).href);
  const openDocuments = new Map([
    [uri, new AsmDocument("@@:\n  nop\n@@:\n  jr @@\n", CpuDialect.Z80, true)]
  ]);

  const lenses = await buildCodeLenses(openDocuments, uri);

  // A bare @@ is not a resolvable reference (@b/@f/@p/@n are), so it must
  // not inflate a shared count on every anonymous lens.
  assert.equal(lenses.find((lens) => lens.range.start.line === 0)?.command?.title, "0 references");
  assert.equal(lenses.find((lens) => lens.range.start.line === 2)?.command?.title, "0 references");
});

test("out-of-scope references to .local labels never inflate counts", async () => {
  const uri = normalizeUri(pathToFileURL(path.resolve("/local-scope.z80")).href);
  const openDocuments = new Map([
    [uri, new AsmDocument("GLOBAL:\n.loop:\nOTHER:\n  jr .loop\n  jr loop\nGLOBAL2:\n", CpuDialect.Z80, true)]
  ]);

  const lenses = await buildCodeLenses(openDocuments, uri);

  // Local labels get no lens (mirrors merls); out-of-scope unqualified
  // references must not land on any global's count.
  assert.equal(lenses.length, 3, "only global labels and @@ get lenses");
  for (const lens of lenses) {
    assert.equal(lens.command?.title, "0 references", `line ${lens.range.start.line} must see no references`);
  }
});

test("anonymous references in other documents do not credit local @@ lenses", async () => {
  const mainUri = normalizeUri(pathToFileURL(path.resolve("/anon-main.z80")).href);
  const depUri = normalizeUri(pathToFileURL(path.resolve("/anon-dep.z80")).href);
  const openDocuments = new Map([
    [mainUri, new AsmDocument("@@:\n  nop\n", CpuDialect.Z80, true)],
    [depUri, new AsmDocument("  jr @b\n", CpuDialect.Z80, true)]
  ]);

  const lenses = await buildCodeLenses(openDocuments, mainUri);

  assert.equal(lenses.find((lens) => lens.range.start.line === 0)?.command?.title, "0 references");
});

test("code lenses count references correctly using LineNode tokens across complex definitions", async () => {
  const uri = normalizeUri(pathToFileURL(path.resolve("/lens-tokens.z80")).href);
  const openDocuments = new Map([
    [uri, new AsmDocument([
      "FUNC1:",
      "  call FUNC1",
      "  call FUNC2",
      "FUNC2:",
      "  jp FUNC1",
      "  jp FUNC2",
      "  ret"
    ].join("\n"), CpuDialect.Z80, true)]
  ]);

  const lenses = await buildCodeLenses(openDocuments, uri);
  assert.equal(lenses.length, 2);
  assert.equal(lenses.find((lens) => lens.range.start.line === 0)?.command?.title, "2 references");
  assert.equal(lenses.find((lens) => lens.range.start.line === 3)?.command?.title, "2 references");
});
