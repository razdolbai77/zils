import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { type Range } from "vscode-languageserver/node";
import { normalizeUri } from "../src/asm/workspace";

import { AsmDocument } from "../src/asm/document";
import { CpuDialect } from "../src/asm/metadata";
import { buildSelectionRanges } from "../src/lsp/selection-ranges";
import { getSymbolAtPosition } from "../src/lsp/symbol-navigation";
import { buildHover } from "../src/lsp/hover";
import { findDefinition } from "../src/lsp/symbol-navigation";
import { buildInlayHints } from "../src/lsp/inlay-hints";
import { formatRange } from "../src/lsp/formatting";

test("selection ranges clamp each position instead of failing the whole request", () => {
  const uri = normalizeUri(pathToFileURL(path.resolve("/clamp-selection.z80")).href);
  const document = new AsmDocument("GLOBAL:\n  nop\n", CpuDialect.Z80, true);
  const openDocuments = new Map([[uri, document]]);

  const result = buildSelectionRanges(openDocuments, uri, [
    { line: 10, character: 0 },
    { line: 1, character: 2 }
  ]);

  assert.ok(result, "one bad position must not fail the whole request");
  assert.equal(result.length, 2);
  // The out-of-range position clamps onto the final (empty) line.
  assert.equal(result[0].range.start.line, 2);
  assert.equal(result[0].range.start.character, 0);
  // The valid position keeps resolving inside its token.
  assert.equal(result[1].range.start.line, 1);
});

test("selection ranges clamp characters past the line end", () => {
  const uri = normalizeUri(pathToFileURL(path.resolve("/clamp-selection-char.z80")).href);
  const document = new AsmDocument("GLOBAL:\n  nop\n", CpuDialect.Z80, true);
  const openDocuments = new Map([[uri, document]]);

  const result = buildSelectionRanges(openDocuments, uri, [{ line: 1, character: 999 }]);

  assert.ok(result);
  // Character 999 clamps to the end of "  nop" (5), landing on the nop token.
  assert.equal(result[0].range.start.character, 2);
  assert.equal(result[0].range.end.character, 5);
});

test("hover clamps out-of-range characters onto the line", async () => {
  const uri = normalizeUri(pathToFileURL(path.resolve("/clamp-hover.z80")).href);
  const document = new AsmDocument("MAIN:\n  jp MAIN\n", CpuDialect.Z80);
  const openDocuments = new Map([[uri, document]]);

  const hover = await buildHover(openDocuments, uri, 1, 999);

  assert.ok(hover, "a character past the line end must clamp, not return nothing");
});

test("go-to-definition clamps out-of-range characters onto the line", async () => {
  const uri = normalizeUri(pathToFileURL(path.resolve("/clamp-definition.z80")).href);
  const document = new AsmDocument("MAIN:\n  jp MAIN\n", CpuDialect.Z80);
  const openDocuments = new Map([[uri, document]]);

  const definition = await findDefinition(openDocuments, uri, 1, 999);

  assert.ok(definition && !Array.isArray(definition));
  assert.equal(definition.uri, uri);
  assert.deepEqual(definition.range, {
    start: { line: 0, character: 0 },
    end: { line: 0, character: 5 }
  });
});

test("getSymbolAtPosition clamps out-of-range line and character", () => {
  const document = new AsmDocument("MAIN:\n  jp MAIN\n", CpuDialect.Z80);

  const pastEnd = getSymbolAtPosition(document, 1, 999);
  assert.ok(pastEnd);
  assert.equal(pastEnd.name, "MAIN");

  const pastDocument = getSymbolAtPosition(document, 99, 0);
  assert.equal(pastDocument, null);
});

test("inlay hints clamp ranges spanning beyond the document", () => {
  const uri = normalizeUri(pathToFileURL(path.resolve("/clamp-inlay.z80")).href);
  const document = new AsmDocument("VALUE equ 10\nld a, VALUE\n", CpuDialect.Z80);
  const openDocuments = new Map([[uri, document]]);

  const range: Range = {
    start: { line: -5, character: -3 },
    end: { line: 999, character: 999 }
  };
  const hints = buildInlayHints(openDocuments, uri, range);

  assert.deepEqual(hints, [
    {
      position: { line: 1, character: 11 },
      label: ": $A",
      kind: 1,
      paddingLeft: true
    }
  ]);
});

test("formatRange clamps ranges lying entirely past the document", () => {
  const document = new AsmDocument("   LABEL:     ld a,b    ;comment", CpuDialect.Z80, true);

  const edits = formatRange(document, { insertSpaces: true, tabSize: 8 }, {
    start: { line: 50, character: 0 },
    end: { line: 99, character: 0 }
  });

  assert.equal(edits.length, 1, "a past-EOF range must clamp onto the last line instead of being ignored");
  assert.equal(edits[0].range.start.line, 0);
});

test("formatRange normalizes inverted ranges", () => {
  const document = new AsmDocument("   LABEL:     ld a,b    ;comment\n  ret", CpuDialect.Z80, true);

  const edits = formatRange(document, { insertSpaces: true, tabSize: 8 }, {
    start: { line: 1, character: 0 },
    end: { line: 0, character: 0 }
  });

  assert.ok(edits.some((edit) => edit.range.start.line === 0), "an inverted range must still format the span");
});
