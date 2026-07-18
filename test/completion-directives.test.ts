import test from "node:test";
import assert from "node:assert/strict";

import { AsmDocument } from "../src/asm/document";
import { CpuDialect, DIRECTIVES } from "../src/asm/metadata";
import { buildCompletionItems } from "../src/lsp/completion";

const EZ80_ONLY_DIRECTIVES: Record<string, true> = {
  assume: true,
  dl: true,
  defl: true,
  align: true,
  maclib: true,
  incbin: true,
  dl24: true,
  ds24: true
};

const ASMSX_ONLY_DIRECTIVES: Record<string, true> = {
  megas: true,
  bios: true,
  biosvars: true,
  fpos: true,
  rb: true,
  rw: true,
  rl: true,
  rs: true,
  insert: true,
  phase: true,
  dephase: true,
  zilog: true,
  page: true,
  rom: true,
  megarom: true,
  basic: true,
  msxdos: true,
  start: true,
  search: true,
  subpage: true,
  select: true,
  callbios: true,
  calldos: true,
  size: true,
  debug: true,
  break: true,
  breakpoint: true,
  rept: true,
  endr: true,
  printtext: true,
  printstring: true,
  print: true,
  printdec: true,
  printhex: true,
  printfix: true,
  cas: true,
  cassette: true,
  wav: true,
  filename: true,
  sinclair: true
};

const DIRECTIVE_NAME_COLLISIONS: Record<string, true> = {
  rl: true
};

function assertDirectiveCompletions(document: AsmDocument, uri: string): void {
  const items = buildCompletionItems(new Map([[uri, document]]), uri, 0, 0);
  const labels = items.map((item) => item.label);

  for (const directive of DIRECTIVES.keys()) {
    const isSupported = document.isAsmsx
      ? !EZ80_ONLY_DIRECTIVES[directive]
      : !ASMSX_ONLY_DIRECTIVES[directive];

    const plainCount = labels.filter((label) => label === directive).length;
    const dottedCount = labels.filter((label) => label === `.${directive}`).length;

    if (isSupported) {
      if (!DIRECTIVE_NAME_COLLISIONS[directive]) {
        assert.equal(plainCount, 1, `Expected ${directive} once`);
      }
      assert.equal(dottedCount, 1, `Expected .${directive} once`);
    } else {
      if (!DIRECTIVE_NAME_COLLISIONS[directive]) {
        assert.equal(plainCount, 0, `Expected ${directive} to be absent`);
      }
      assert.equal(dottedCount, 0, `Expected .${directive} to be absent`);
    }
  }
}

test("completion uses canonical directive metadata in Z80 asMSX mode", () => {
  assertDirectiveCompletions(new AsmDocument("", CpuDialect.Z80, true), "file:///tmp/z80.asm");
});

test("completion uses canonical directive metadata in eZ80 mode", () => {
  assertDirectiveCompletions(new AsmDocument("", CpuDialect.EZ80, false), "file:///tmp/ez80.asm");
});

test("completion keeps global labels and excludes invalid asMSX local labels", () => {
  const uri = "file:///tmp/local-labels.z80";
  const document = new AsmDocument(
    [
      "entry:",
      "@@local:",
      "@incorrect_local_label:",
      ".dotLocal:",
      "  jr @",
      "  jr @@",
      "  jr @@l",
      "  jr @@lo",
      "  jr entry",
      "  jr .",
      "other:",
      "@@other:",
      "  jr @"
    ].join("\n"),
    CpuDialect.Z80,
    true
  );

  for (const [line, character] of [[4, 6], [5, 7], [6, 8], [7, 9]]) {
    const labels = buildCompletionItems(new Map([[uri, document]]), uri, line, character)
      .map((item) => item.label);

    assert.deepEqual(labels, ["@@local"]);
  }

  const globalLabels = buildCompletionItems(new Map([[uri, document]]), uri, 8, 10)
    .map((item) => item.label);
  assert.deepEqual(globalLabels, ["entry"]);

  const dotLocalLabels = buildCompletionItems(new Map([[uri, document]]), uri, 9, 6)
    .map((item) => item.label);
  assert.deepEqual(dotLocalLabels, [".dotLocal"]);
});

test("completion suggests condition codes only in valid first operands", () => {
  const uri = "file:///tmp/condition-completion.z80";
  const document = new AsmDocument(
    [
      "entry:",
      "  ld a, ",
      "  jp ",
      "  jr ",
      "  ret ",
      "  jp nz, "
    ].join("\n"),
    CpuDialect.Z80,
    true
  );
  const allConditionCodes = ["z", "nz", "c", "nc", "po", "pe", "p", "m"];
  const conditionLabels = (line: number, character: number) =>
    buildCompletionItems(new Map([[uri, document]]), uri, line, character)
      .map((item) => item.label)
      .filter((label) => allConditionCodes.includes(label));

  assert.deepEqual(conditionLabels(1, 8), []);
  assert.deepEqual(conditionLabels(2, 5), allConditionCodes);
  assert.deepEqual(conditionLabels(3, 5), ["z", "nz", "c", "nc"]);
  assert.deepEqual(conditionLabels(4, 6), allConditionCodes);
  assert.deepEqual(conditionLabels(5, 9), []);

  const jrItems = buildCompletionItems(new Map([[uri, document]]), uri, 3, 5);
  assert.equal(jrItems.find((item) => item.label === "nz")?.insertText, "nz,");
  const retItems = buildCompletionItems(new Map([[uri, document]]), uri, 4, 6);
  assert.equal(retItems.find((item) => item.label === "nz")?.insertText, undefined);
});
