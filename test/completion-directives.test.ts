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
