import test from "node:test";
import assert from "node:assert/strict";
import { type Range } from "vscode-languageserver/node";

import { AsmDocument } from "../src/asm/document";
import { CpuDialect } from "../src/asm/metadata";
import { buildInlayHints } from "../src/lsp/inlay-hints";

test("inlay hints honor the requested range and use line-relative positions", () => {
  const uri = "file:///tmp/inlay.asm";
  const document = new AsmDocument([
    "VALUE equ 10",
    "ld a, VALUE",
    "ld b, VALUE",
    "ld c, VALUE"
  ].join("\n"), CpuDialect.Z80);
  const openDocuments = new Map([[uri, document]]);
  const range: Range = {
    start: { line: 1, character: 0 },
    end: { line: 1, character: 11 }
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
