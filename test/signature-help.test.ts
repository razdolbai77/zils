import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { normalizeUri } from "../src/asm/workspace";

import { AsmDocument } from "../src/asm/document";
import { CpuDialect } from "../src/asm/metadata";
import { buildSignatureHelp } from "../src/lsp/signature-help";

type SignatureShape = {
  label: string;
  documentation?: string;
  parameters?: Array<{ label: string }>;
};

function helpFor(source: string, line: number, character: number, uri = "/sig.z80") {
  const documentUri = normalizeUri(pathToFileURL(path.resolve(uri)).href);
  const openDocuments = new Map([[documentUri, new AsmDocument(source, CpuDialect.Z80)]]);
  return buildSignatureHelp(openDocuments, documentUri, line, character);
}

test("returns null for unknown documents", () => {
  const openDocuments = new Map<string, AsmDocument>();
  assert.equal(buildSignatureHelp(openDocuments, "/nope.z80", 0, 0), null);
});

test("returns null for directives and unknown mnemonics", () => {
  assert.equal(helpFor("  org 100h\n", 0, 6), null, "directives have no instruction signature");
  assert.equal(helpFor("  frobnicate a,b\n", 0, 14), null, "unknown mnemonics have no metadata");
});

test("active parameter is 0 before the first comma", () => {
  const help = helpFor("  ld a,b\n", 0, 5);
  assert.notEqual(help, null);
  assert.equal(help!.activeParameter, 0);
});

test("active parameter advances past a top-level comma", () => {
  const help = helpFor("  ld a,b\n", 0, 7);
  assert.notEqual(help, null);
  assert.equal(help!.activeParameter, 1);
});

test("cursor exactly on the comma stays on the current parameter", () => {
  const help = helpFor("  ld a,b\n", 0, 6);
  assert.notEqual(help, null);
  assert.equal(help!.activeParameter, 0, "the comma itself belongs to the parameter before it");
});

test("cursor exactly on an opening paren reports parameter 0", () => {
  const help = helpFor("  ld (ix+1),a\n", 0, 5);
  assert.notEqual(help, null);
  assert.equal(help!.activeParameter, 0);
});

test("commas nested in parentheses do not advance the parameter", () => {
  // (b,c) is ONE operand; only the comma AFTER the closing paren separates
  // parameters. The cursor between the nested paren and the outer comma must
  // still report parameter 0 — without depth tracking the nested comma would
  // be counted, and clamping against LD's two-parameter first overload would
  // hide the miscount.
  const beforeOuter = helpFor("  ld (b,c),a\n", 0, 10);
  assert.notEqual(beforeOuter, null);
  assert.equal(beforeOuter!.activeParameter, 0);

  const afterOuter = helpFor("  ld (b,c),a\n", 0, 11);
  assert.notEqual(afterOuter, null);
  assert.equal(afterOuter!.activeParameter, 1);
});

test("empty operand lists offer every overload", () => {
  const help = helpFor("  call\n", 0, 6);
  assert.notEqual(help, null);
  assert.equal(help!.activeParameter, 0);
  assert.equal(help!.activeSignature, 0);
  const labels = help!.signatures.map((signature) => signature.label);
  assert.deepEqual(labels, ["CALL cc, nn", "CALL nn"]);
});

test("a matched line collapses to the single matching overload", () => {
  const help = helpFor("  call 1234\n", 0, 7);
  assert.notEqual(help, null);
  assert.equal(help!.signatures.length, 1, "one matching overload means one signature");
  const signature = help!.signatures[0] as SignatureShape;
  assert.ok(signature.label.toUpperCase().startsWith("CALL"), `unexpected label: ${signature.label}`);
  assert.ok(signature.parameters && signature.parameters.length >= 1);
});

test("active parameter clamps to the last parameter of the first signature", () => {
  // Three operands match no CALL overload, so every overload is offered; the
  // two top-level commas must clamp to the first overload's parameter count.
  const help = helpFor("  call 1,2,3\n", 0, 12);
  assert.notEqual(help, null);
  assert.ok(help!.signatures.length > 1, "no overload matches three operands");
  const first = help!.signatures[0] as SignatureShape;
  assert.equal(help!.activeParameter, Math.max(0, (first.parameters?.length ?? 1) - 1));
});

test("zero-operand instructions expose one parameter-less signature", () => {
  const help = helpFor("  halt\n", 0, 6);
  assert.notEqual(help, null);
  assert.equal(help!.signatures.length, 1);
  const signature = help!.signatures[0] as SignatureShape;
  assert.equal(signature.label, "HALT");
  assert.deepEqual(signature.parameters, []);
  assert.equal(help!.activeParameter, 0);
});
