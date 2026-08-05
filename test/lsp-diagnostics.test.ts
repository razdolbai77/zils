import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { normalizeUri } from "../src/asm/workspace";

import { AsmDocument } from "../src/asm/document";
import { CpuDialect } from "../src/asm/metadata";
import { collectDiagnosticsByUri } from "../src/lsp/diagnostics";

describe("LSP Diagnostics", () => {
  it("indexes disk-only includes using the open document dialect", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "zils-lsp-diag-"));

    try {
      const dependencyPath = path.join(tempDir, "lib.asm");
      fs.writeFileSync(dependencyPath, "value rb 1\n", "utf8");

      const rootPath = path.join(tempDir, "main.asm");
      const rootUri = normalizeUri(pathToFileURL(rootPath).href);
      const rootDocument = new AsmDocument('include "lib.asm"\nld a, value\n', CpuDialect.Z80, true);
      const openDocuments = new Map([[rootUri, rootDocument]]);

      const diagnosticsByUri = await collectDiagnosticsByUri(openDocuments, CpuDialect.Z80, true);

      assert.deepEqual(diagnosticsByUri.get(rootUri), []);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("pins end characters across multiple diagnostics in one publish", async () => {
    const rootUri = normalizeUri(pathToFileURL(path.resolve("/multi-error.asm")).href);
    // Line 0: the unanchored equate-evaluation error spans the whole line;
    // the unresolved-symbol scan anchors on the NOSUCH token and its end
    // lands on the line's last character. Line 2: the unanchored operand
    // error spans the whole physical line.
    const source = "VAL: equ NOSUCH\n  nop\n  ld a,,b\n";
    const openDocuments = new Map([[rootUri, new AsmDocument(source, CpuDialect.EZ80)]]);

    const byUri = await collectDiagnosticsByUri(openDocuments, CpuDialect.EZ80, false);
    const diagnostics = byUri.get(rootUri);

    assert.notEqual(diagnostics, undefined);
    assert.equal(diagnostics!.length, 3);

    const equError = diagnostics!.find((diagnostic) => diagnostic.message.includes("Failed to evaluate equate"))!;
    assert.deepEqual(equError.range, {
      start: { line: 0, character: 0 },
      end: { line: 0, character: "VAL: equ NOSUCH".length }
    });

    const unresolved = diagnostics!.find((diagnostic) => diagnostic.message.includes("Unresolved symbol"))!;
    assert.equal(unresolved.range.start.line, 0);
    assert.equal(unresolved.range.start.character, "VAL: equ ".length);
    assert.equal(unresolved.range.end.character, "VAL: equ NOSUCH".length);

    // The empty middle operand of `ld a,,b` has no anchor token, so the
    // operand-scan error spans the whole physical line.
    const operandError = diagnostics!.find((diagnostic) => diagnostic.range.start.line === 2)!;
    assert.deepEqual(operandError.range, {
      start: { line: 2, character: 0 },
      end: { line: 2, character: "  ld a,,b".length }
    }, "the unanchored operand error spans the whole line");
  });
});
