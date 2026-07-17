import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

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
      const rootUri = pathToFileURL(rootPath).href;
      const rootDocument = new AsmDocument('include "lib.asm"\nld a, value\n', CpuDialect.Z80, true);
      const openDocuments = new Map([[rootUri, rootDocument]]);
      const allDocuments = new Map(openDocuments);

      const diagnosticsByUri = await collectDiagnosticsByUri(openDocuments, allDocuments, CpuDialect.Z80, true);

      assert.deepEqual(diagnosticsByUri.get(rootUri), []);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
