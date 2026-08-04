import test from "node:test";
import assert from "node:assert/strict";

import { AsmDocument } from "../src/asm/document";
import { CpuDialect } from "../src/asm/metadata";
import { buildSelectionRanges } from "../src/lsp/selection-ranges";

test("selection ranges keep dot-local labels inside the enclosing global scope", () => {
  const uri = "file:///tmp/selection.asm";
  const document = new AsmDocument([
    "GLOBAL:",
    ".local:",
    "  ld a, 10",
    "NEXT:",
    "  ret"
  ].join("\n"), CpuDialect.Z80, true);
  const openDocuments = new Map([[uri, document]]);

  const result = buildSelectionRanges(openDocuments, uri, [{ line: 2, character: 6 }]);
  assert.ok(result);

  const tokenRange = result[0];
  const lineRange = tokenRange.parent;
  const scopeRange = lineRange?.parent;

  assert.equal(scopeRange?.range.start.line, 0);
  assert.equal(scopeRange?.range.end.line, 2);
});

test("selection ranges clamp out-of-range positions onto the document", () => {
  const uri = "file:///tmp/selection.asm";
  const document = new AsmDocument("GLOBAL:\n  nop\n", CpuDialect.Z80);
  const openDocuments = new Map([[uri, document]]);

  const result = buildSelectionRanges(openDocuments, uri, [{ line: 10, character: 0 }]);

  assert.ok(result, "out-of-range positions must clamp, not fail the request");
  assert.equal(result.length, 1);
});

test("selection ranges return an empty list for an unknown document", () => {
  const uri = "file:///tmp/selection.asm";
  const document = new AsmDocument("GLOBAL:\n  nop\n", CpuDialect.Z80);
  const openDocuments = new Map([[uri, document]]);

  const result = buildSelectionRanges(openDocuments, "file:///tmp/missing.asm", [{ line: 0, character: 0 }]);

  assert.deepEqual(result, [], "a missing document is a list-feature failure and must return []");
});
