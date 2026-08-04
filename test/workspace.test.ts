import { describe, it } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

import { indexWorkspace, normalizeUri, pathKey, type DiskDocumentCache } from "../src/asm/workspace";
import { CpuDialect } from "../src/asm/metadata";
import { AsmDocument } from "../src/asm/document";

describe("Workspace Indexing", () => {
  it("indexes a single file", async () => {
    const overrides = new Map();
    overrides.set(path.resolve("/main.asm"), new AsmDocument("start:\n  nop\n  ret"));
    const workspace = await indexWorkspace(path.resolve("/main.asm"), overrides);

    assert.equal(workspace.documents.size, 1);
    assert.ok(workspace.symbols.has("start"));
  });
  it("does not resolve includes from untitled documents", async () => {
    const workspace = await indexWorkspace(
      "untitled:workspace.asm",
      new Map([["untitled:workspace.asm", new AsmDocument('  include "missing.asm"')]])
    );

    assert.equal(workspace.documents.size, 1);
    assert.equal(workspace.failedIncludes.length, 0);
  });


  it("follows include directives", async () => {
    const overrides = new Map();
    overrides.set(path.resolve("/main.asm"), new AsmDocument("  include \"lib.asm\"\nmain_label: nop"));
    overrides.set(path.resolve("/lib.asm"), new AsmDocument("lib_label: ret"));
    
    const workspace = await indexWorkspace(path.resolve("/main.asm"), overrides);

    assert.equal(workspace.documents.size, 2);
    
    assert.ok(workspace.symbols.has("main_label"));
    assert.ok(workspace.symbols.has("lib_label"));
    assert.equal(workspace.symbols.get("lib_label")?.[0]?.filePath, path.resolve("/lib.asm"));
  });

  it("preserves backslashes in quoted include paths", async () => {
    const overrides = new Map();
    overrides.set(path.resolve("/main.asm"), new AsmDocument(String.raw`  include "dir\data.asm"`));
    overrides.set(path.resolve("/dir/data.asm"), new AsmDocument("lib_label: ret"));

    const workspace = await indexWorkspace(path.resolve("/main.asm"), overrides);

    assert.equal(workspace.documents.size, 2);
    assert.ok(workspace.symbols.has("lib_label"));
  });

  it("decodes escapes in quoted eZ80 include paths", async () => {
    const overrides = new Map();
    overrides.set(path.resolve("/main.asm"), new AsmDocument(String.raw`  include "lib\nfile.asm"`));
    overrides.set(path.resolve("/lib\nfile.asm"), new AsmDocument("lib_label: ret"));

    const workspace = await indexWorkspace(path.resolve("/main.asm"), overrides);

    assert.equal(workspace.documents.size, 2);
    assert.ok(workspace.documents.has(path.resolve("/lib\nfile.asm")));
    assert.ok(workspace.symbols.has("lib_label"));
  });

  it("preserves spaces in unquoted include paths", async () => {
    const overrides = new Map();
    overrides.set(path.resolve("/main.asm"), new AsmDocument("  include lib dir.asm"));
    overrides.set(path.resolve("/lib dir.asm"), new AsmDocument("lib_label: ret"));

    const workspace = await indexWorkspace(path.resolve("/main.asm"), overrides);

    assert.equal(workspace.documents.size, 2);
    assert.ok(workspace.documents.has(path.resolve("/lib dir.asm")));
    assert.ok(workspace.symbols.has("lib_label"));
  });

  it("reconstructs unquoted include paths without truncating dotted filenames", async () => {
    const overrides = new Map();
    overrides.set(path.resolve("/main.asm"), new AsmDocument("  include lib.asm\nmain_label: nop"));
    overrides.set(path.resolve("/lib.asm"), new AsmDocument("lib_label: ret"));

    const workspace = await indexWorkspace(path.resolve("/main.asm"), overrides);

    assert.equal(workspace.documents.size, 2);
    assert.ok(workspace.documents.has(path.resolve("/lib.asm")));
    assert.ok(workspace.symbols.has("lib_label"));
  });

  it("keeps every definition of a shadowed symbol with the entry file first", async () => {
    const overrides = new Map();
    overrides.set(path.resolve("/main.asm"), new AsmDocument("  include \"lib.asm\"\nshared: nop"));
    overrides.set(path.resolve("/lib.asm"), new AsmDocument("shared: ret"));

    const workspace = await indexWorkspace(path.resolve("/main.asm"), overrides);

    const definitions = workspace.symbols.get("shared");
    assert.equal(definitions?.length, 2, "both definitions must survive the merge");
    assert.equal(definitions?.[0]?.filePath, path.resolve("/main.asm"), "the entry file's definition wins the lookup order");
    assert.equal(definitions?.[1]?.filePath, path.resolve("/lib.asm"));
  });

  it("preserves explicit symbol kinds in the workspace index", async () => {
    const overrides = new Map();
    overrides.set(path.resolve("/main.asm"), new AsmDocument([
      "macro emit_byte",
      "endm",
      "DATA db 1",
      "CONST equ 2",
      "LABEL:",
      "  nop"
    ].join("\n"), CpuDialect.Z80, true));

    const workspace = await indexWorkspace(path.resolve("/main.asm"), overrides, CpuDialect.Z80, true);

    assert.equal(workspace.symbols.get("emit_byte")?.[0]?.kind, "macro");
    assert.equal(workspace.symbols.get("DATA")?.[0]?.kind, "data");
    assert.equal(workspace.symbols.get("CONST")?.[0]?.kind, "equate");
    assert.equal(workspace.symbols.get("LABEL")?.[0]?.kind, "label");
  });

  it("refreshes cached disk documents when the file changes on disk", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "zils-workspace-cache-"));
    const mainPath = path.join(tempDir, "main.asm");
    const depPath = path.join(tempDir, "dep.asm");
    const diskCache: DiskDocumentCache = new Map();

    fs.writeFileSync(mainPath, 'include "dep.asm"\nMAIN:\n  nop\n', "utf8");
    fs.writeFileSync(depPath, "OLD_LABEL:\n  ret\n", "utf8");

    try {
      const firstWorkspace = await indexWorkspace(mainPath, undefined, CpuDialect.Z80, false, diskCache);
      assert.ok(firstWorkspace.symbols.has("OLD_LABEL"));

      // Change the dependency without any watched-file event; the next
      // index must pick the new content up via mtime instead of serving
      // the stale cached document.
      fs.writeFileSync(depPath, "NEW_LABEL:\n  ret\n", "utf8");
      const bumped = new Date(Date.now() + 1000);
      fs.utimesSync(depPath, bumped, bumped);

      const secondWorkspace = await indexWorkspace(mainPath, undefined, CpuDialect.Z80, false, diskCache);
      assert.ok(secondWorkspace.symbols.has("NEW_LABEL"), "a modified include must be re-read");
      assert.ok(!secondWorkspace.symbols.has("OLD_LABEL"));

      // Unmodified files still come from the cache.
      const thirdWorkspace = await indexWorkspace(mainPath, undefined, CpuDialect.Z80, false, diskCache);
      assert.strictEqual(
        thirdWorkspace.documents.get(depPath),
        secondWorkspace.documents.get(depPath)
      );

      const overrideDependency = new AsmDocument("OVERRIDE_LABEL:\n  ret\n", CpuDialect.Z80);
      const overrideWorkspace = await indexWorkspace(
        mainPath,
        new Map([[depPath, overrideDependency]]),
        CpuDialect.Z80,
        false,
        diskCache
      );

      assert.strictEqual(overrideWorkspace.documents.get(depPath), overrideDependency);
      assert.ok(overrideWorkspace.symbols.has("OVERRIDE_LABEL"));
      assert.ok(!overrideWorkspace.symbols.has("NEW_LABEL"));
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("avoids infinite loops with circular includes", async () => {
    const overrides = new Map();
    overrides.set(path.resolve("/a.asm"), new AsmDocument("  include \"b.asm\""));
    overrides.set(path.resolve("/b.asm"), new AsmDocument("  include \"a.asm\""));
    
    const workspace = await indexWorkspace(path.resolve("/a.asm"), overrides);

    assert.equal(workspace.documents.size, 2);
  });

  it("records includes whose files are missing", async () => {
    const overrides = new Map();
    overrides.set(path.resolve("/main.asm"), new AsmDocument("  include \"missing.asm\"\n  nop"));

    const workspace = await indexWorkspace(path.resolve("/main.asm"), overrides);

    assert.equal(workspace.documents.size, 1);
    assert.equal(workspace.failedIncludes.length, 1);
    const failed = workspace.failedIncludes[0];
    assert.equal(failed.includerPath, path.resolve("/main.asm"));
    assert.equal(failed.line, 0);
    assert.equal(failed.resolvedPath, path.resolve("/missing.asm"));
    assert.equal(failed.startCharacter, 10);
    assert.equal(failed.length, "\"missing.asm\"".length);
  });

  it("records includes whose files cannot be read", async () => {
    // A directory is readable to stat but readFile rejects (EISDIR),
    // standing in for an unreadable include on every platform.
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "zils-include-"));
    const unreadableTarget = path.join(tmpDir, "unreadable");
    fs.mkdirSync(unreadableTarget);
    try {
      const mainPath = path.join(tmpDir, "main.asm");
      const overrides = new Map();
      overrides.set(mainPath, new AsmDocument("  include \"unreadable\"\n  nop"));

      const workspace = await indexWorkspace(mainPath, overrides);

      assert.equal(workspace.failedIncludes.length, 1);
      assert.equal(workspace.failedIncludes[0].includerPath, mainPath);
      assert.equal(workspace.failedIncludes[0].resolvedPath, unreadableTarget);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("matches open buffers to includes regardless of path case", async () => {
    // On case-insensitive file systems an include spelled "Lib.ASM" must hit
    // the open buffer for lib.asm instead of missing the override and
    // reporting the include as broken.
    const overrides = new Map();
    overrides.set(path.resolve("/main.asm"), new AsmDocument("  include \"Lib.ASM\"\nmain_label: nop"));
    overrides.set(path.resolve("/lib.asm"), new AsmDocument("lib_label: ret"));

    const workspace = await indexWorkspace(path.resolve("/main.asm"), overrides);

    assert.equal(workspace.documents.size, 2);
    assert.equal(workspace.failedIncludes.length, 0);
    assert.ok(workspace.symbols.has("lib_label"));
    assert.ok(workspace.documents.has(path.resolve("/lib.asm")));
    assert.ok(workspace.pathIndex.has(pathKey(path.resolve("/LIB.asm"))));
  });

  it("keeps one entry when the same file is included with different casing", async () => {
    const overrides = new Map();
    overrides.set(
      path.resolve("/main.asm"),
      new AsmDocument("  include \"Lib.ASM\"\n  include \"lib.asm\"\nmain_label: nop")
    );
    overrides.set(path.resolve("/lib.asm"), new AsmDocument("lib_label: ret"));

    const workspace = await indexWorkspace(path.resolve("/main.asm"), overrides);

    assert.equal(workspace.documents.size, 2);
    assert.equal(workspace.failedIncludes.length, 0);
  });

  it("normalizes URIs on Windows", () => {
    if (os.platform() === "win32") {
      const uri1 = "file:///C:/projects/test/main.asm";
      const uri2 = "file:///c:/projects/test/main.asm";
      assert.equal(normalizeUri(uri1), normalizeUri(uri2));
      assert.ok(normalizeUri(uri1).startsWith("file:///c:"));
    } else {
      const uri = "file:///home/user/main.asm";
      assert.equal(normalizeUri(uri), uri);
    }
  });
});
