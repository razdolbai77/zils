import test from "node:test";
import assert from "node:assert/strict";
import { FoldingRangeKind } from "vscode-languageserver/node";
import { AsmDocument } from "../src/asm/document";
import { CpuDialect } from "../src/asm/metadata";
import { buildFoldingRanges } from "../src/lsp/folding-ranges";

test("folds all metadata data directives", () => {
  const ez80Document = new AsmDocument([
    "  db 1",
    "  dw 1",
    "  dl 1",
    "  dw24 1",
    "  dw32 1",
    "  byte 1"
  ].join("\n"), CpuDialect.EZ80);
  const z80Document = new AsmDocument([
    "  db 1",
    "  dt 1",
    "  deft 1",
    "  byte",
    "  word"
  ].join("\n"), CpuDialect.Z80, true);

  assert.deepEqual(buildFoldingRanges(ez80Document), [{
    startLine: 0,
    endLine: 5,
    kind: FoldingRangeKind.Region
  }]);
  assert.deepEqual(buildFoldingRanges(z80Document), [{
    startLine: 0,
    endLine: 4,
    kind: FoldingRangeKind.Region
  }]);
});
