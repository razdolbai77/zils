import test from "node:test";
import assert from "node:assert/strict";

import { AsmDocument } from "../src/asm/document";
import { CpuDialect, DIRECTIVES } from "../src/asm/metadata";
import { buildCompletionItems } from "../src/lsp/completion";


const DIRECTIVE_NAME_COLLISIONS: Record<string, true> = {
  rl: true
};

function assertDirectiveCompletions(document: AsmDocument, uri: string): void {
  const items = buildCompletionItems(new Map([[uri, document]]), uri, 0, 0);
  const labels = items.map((item) => item.label);

  for (const directive of DIRECTIVES.keys()) {
    const isSupported = DIRECTIVES.get(directive)!.supportedDialects.includes(document.dialect);

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

test("completion includes incbin in Z80 asMSX mode", () => {
  const uri = "file:///tmp/z80.asm";
  const items = buildCompletionItems(
    new Map([[uri, new AsmDocument("", CpuDialect.Z80, true)]]),
    uri,
    0,
    0
  );

  assert.ok(items.some((item) => item.label === "incbin"));
  assert.ok(items.some((item) => item.label === ".incbin"));
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

test("local label completion replaces every typed at-sign", () => {
  const uri = "file:///tmp/local-label-replacement.z80";
  const document = new AsmDocument(
    ["entry:", "@@local:", "  jr @", "  jr @@"].join("\n"),
    CpuDialect.Z80,
    true
  );

  for (const [line, endCharacter] of [[2, 6], [3, 7]]) {
    const completion = buildCompletionItems(new Map([[uri, document]]), uri, line, endCharacter)
      .find((item) => item.label === "@@local");

    assert.deepEqual(completion?.textEdit, {
      newText: "@@local",
      range: {
        start: { line, character: 5 },
        end: { line, character: endCharacter }
      }
    });
    assert.equal(completion?.filterText, "@@local");
  }
});

test("local macro completion uses matching filter text", () => {
  const uri = "file:///tmp/local-macro-completion.z80";
  const document = new AsmDocument(
    ["global:", "@@OneMacro macro arg", "endm", "@@On"].join("\n"),
    CpuDialect.Z80,
    true
  );

  const completion = buildCompletionItems(new Map([[uri, document]]), uri, 3, 4)
    .find((item) => item.label === "@@OneMacro");

  assert.deepEqual(completion?.textEdit, {
    newText: "@@OneMacro",
    range: {
      start: { line: 3, character: 0 },
      end: { line: 3, character: 4 }
    }
  });
  assert.equal(completion?.filterText, "@@OneMacro");
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

test("completion classifies the mnemonic position after a label correctly", () => {
  const uri = "file:///tmp/mnemonic-position.z80";
  const document = new AsmDocument(
    [
      "VALUE equ 5",
      "start: l",
      "  ld a, VALUE"
    ].join("\n"),
    CpuDialect.Z80,
    true
  );

  // Cursor after 'l' in 'start: l' — the user is typing a mnemonic.
  const mnemonicLabels = buildCompletionItems(new Map([[uri, document]]), uri, 1, 8)
    .map((item) => item.label);
  assert.ok(mnemonicLabels.includes("ld"), "mnemonic position must offer instructions");
  assert.ok(mnemonicLabels.includes("equ"), "mnemonic position must offer directives");
  assert.ok(!mnemonicLabels.includes("VALUE"), "mnemonic position must not offer operand symbols");

  // Cursor after the label 'VALUE' in 'VALUE equ 1' — still mnemonic slot.
  const afterLabel = buildCompletionItems(new Map([[uri, document]]), uri, 0, 3)
    .map((item) => item.label);
  assert.ok(afterLabel.includes("ld"), "cursor at label position must offer instructions");
  assert.ok(afterLabel.includes("equ"), "cursor at label position must offer directives");
});

test("completion suppresses at the comment boundary and inside comments", () => {
  const uri = "file:///tmp/comment-boundary.z80";
  const document = new AsmDocument(
    [
      "VALUE equ 5",
      "  ld a, VALUE ; note"
    ].join("\n"),
    CpuDialect.Z80,
    true
  );

  const semiColumn = "  ld a, VALUE ; note".indexOf(";");

  // Exactly at ';' — the comment starts here, no completions.
  const atBoundary = buildCompletionItems(new Map([[uri, document]]), uri, 1, semiColumn);
  assert.deepEqual(atBoundary, [], "cursor exactly at ';' must return nothing");

  // Inside the comment text.
  const inComment = buildCompletionItems(new Map([[uri, document]]), uri, 1, semiColumn + 3);
  assert.deepEqual(inComment, [], "cursor inside a comment must return nothing");
});

test("completion still works in operand context after a mnemonic", () => {
  const uri = "file:///tmp/operand-context.z80";
  const document = new AsmDocument(
    [
      "VALUE equ 5",
      "  ld a, VALUE"
    ].join("\n"),
    CpuDialect.Z80,
    true
  );

  // Cursor after 'VALUE' in operand position — symbols offered.
  const operandLabels = buildCompletionItems(new Map([[uri, document]]), uri, 1, 13)
    .map((item) => item.label);
  assert.ok(operandLabels.includes("VALUE"), "operand position must offer symbols");
  assert.ok(!operandLabels.includes("ld"), "operand position must not offer instructions");
});

test("local label completion filters by scope using single-pass precomputed scope tracking", () => {
  const source = [
    "SCOPE1:",
    ".local1:",
    ".local2:",
    "  jp .",
    "SCOPE2:",
    ".local3:"
  ].join("\n");
  const document = new AsmDocument(source, CpuDialect.Z80, true);
  const uri = "file:///tmp/scope-test.asm";
  const items = buildCompletionItems(new Map([[uri, document]]), uri, 3, 6);
  const labels = items.map((item) => item.label);

  assert.ok(labels.includes(".local1"));
  assert.ok(labels.includes(".local2"));
  assert.ok(!labels.includes(".local3"));
});
