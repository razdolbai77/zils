import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { AsmDocument } from "../src/asm/document";
import { CpuDialect } from "../src/asm/metadata";
import { normalizeUri, type DiskDocumentCache } from "../src/asm/workspace";
import { findDefinition, findReferences } from "../src/lsp/symbol-navigation";
import { collectDiagnosticsByUri } from "../src/lsp/diagnostics";

// Patch fs.promises.readFile to count disk reads. Includes that are NOT in
// openDocuments must come from disk; the threaded cache makes the second
// access a hit. Without threading, every request re-reads the include.
const originalPromises = fs.promises;
const originalReadFile = originalPromises.readFile.bind(originalPromises);
let readCount = 0;

const patchedPromises = {
  ...originalPromises,
  readFile: (...args: Parameters<typeof originalReadFile>) => {
    readCount += 1;
    return originalReadFile(...args);
  }
};

function installReadCounter(): void {
  Object.defineProperty(fs, "promises", { get: () => patchedPromises, configurable: true });
}

function uninstallReadCounter(): void {
  Object.defineProperty(fs, "promises", { value: originalPromises, configurable: true });
}

function makeFixture(): { tempDir: string; mainUri: string; includeUri: string; mainDocument: AsmDocument } {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "zils-nav-cache-"));
  const mainPath = path.join(tempDir, "main.asm");
  const includePath = path.join(tempDir, "lib.asm");

  // eZ80 mode: equate labels need ':' or '=', and include lines must be
  // indented (column-0 undotted directives are illegal).
  fs.writeFileSync(mainPath, "  include \"lib.asm\"\nMAIN:\n  jp VALUE\n", "utf8");
  fs.writeFileSync(includePath, "VALUE = 7\n", "utf8");

  return {
    tempDir,
    mainUri: normalizeUri(pathToFileURL(mainPath).href),
    includeUri: normalizeUri(pathToFileURL(includePath).href),
    mainDocument: new AsmDocument("  include \"lib.asm\"\nMAIN:\n  jp VALUE\n", CpuDialect.EZ80)
  };
}

test("navigation threads the disk cache so includes are read once", async () => {
  const fixture = makeFixture();
  // Only the entry file is open; the include must come from disk.
  const openDocuments = new Map([[fixture.mainUri, fixture.mainDocument]]);
  const diskCache: DiskDocumentCache = new Map();

  installReadCounter();
  readCount = 0;
  try {
    const first = await findDefinition(openDocuments, fixture.mainUri, 2, 8, diskCache);
    assert.ok(first && !Array.isArray(first));
    assert.equal(first.uri, fixture.includeUri);
    const readsAfterFirst = readCount;
    assert.ok(readsAfterFirst >= 1, "the first request must read the include from disk");

    // Same cache, mixed requests: definition again, then references.
    const second = await findDefinition(openDocuments, fixture.mainUri, 2, 8, diskCache);
    assert.ok(second && !Array.isArray(second));
    const references = await findReferences(openDocuments, fixture.mainUri, 2, 8, true, diskCache);
    assert.ok(references.length >= 1);

    assert.equal(
      readCount - readsAfterFirst,
      0,
      "repeat requests must be served from the threaded disk cache"
    );
  } finally {
    uninstallReadCounter();
    fs.rmSync(fixture.tempDir, { recursive: true, force: true });
  }
});

test("navigation without a cache re-reads includes on every request", async () => {
  const fixture = makeFixture();
  const openDocuments = new Map([[fixture.mainUri, fixture.mainDocument]]);

  installReadCounter();
  readCount = 0;
  try {
    await findDefinition(openDocuments, fixture.mainUri, 2, 8);
    const readsAfterFirst = readCount;
    assert.ok(readsAfterFirst >= 1);

    await findDefinition(openDocuments, fixture.mainUri, 2, 8);
    assert.ok(
      readCount > readsAfterFirst,
      "without a threaded cache each indexWorkspace call reads the include again"
    );
  } finally {
    uninstallReadCounter();
    fs.rmSync(fixture.tempDir, { recursive: true, force: true });
  }
});

test("collectDiagnosticsByUri reads shared includes once across open documents", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "zils-diag-cache-"));
  const includePath = path.join(tempDir, "shared.asm");
  const rootAPath = path.join(tempDir, "a.asm");
  const rootBPath = path.join(tempDir, "b.asm");

  fs.writeFileSync(includePath, "SHARED = 1\n", "utf8");
  fs.writeFileSync(rootAPath, "  include \"shared.asm\"\n  ld a, SHARED\n", "utf8");
  fs.writeFileSync(rootBPath, "  include \"shared.asm\"\n  ld b, SHARED\n", "utf8");

  const rootAUri = normalizeUri(pathToFileURL(rootAPath).href);
  const rootBUri = normalizeUri(pathToFileURL(rootBPath).href);
  const allDocuments = new Map([
    [rootAUri, new AsmDocument("  include \"shared.asm\"\n  ld a, SHARED\n", CpuDialect.EZ80)],
    [rootBUri, new AsmDocument("  include \"shared.asm\"\n  ld b, SHARED\n", CpuDialect.EZ80)]
  ]);
  const diskCache: DiskDocumentCache = new Map();

  installReadCounter();
  readCount = 0;
  try {
    const diagnosticsByUri = await collectDiagnosticsByUri(allDocuments, CpuDialect.EZ80, false, diskCache);

    assert.deepEqual([...diagnosticsByUri.get(rootAUri) ?? []], []);
    assert.deepEqual([...diagnosticsByUri.get(rootBUri) ?? []], []);
    assert.equal(
      readCount,
      1,
      "two roots including the same file must read it once through the shared cache"
    );
  } finally {
    uninstallReadCounter();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
