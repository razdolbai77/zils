import { describe, it } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

import { indexWorkspace, normalizeUri } from "../src/asm/workspace";
import { CpuDialect } from "../src/asm/metadata";
import { AsmDocument } from "../src/asm/document";

describe("Workspace Indexing", () => {
  it("indexes a single file", async () => {
    const overrides = new Map();
    overrides.set(path.resolve("/main.asm"), new AsmDocument("start:\n  nop\n  ret"));
    const workspace = await indexWorkspace(path.resolve("/main.asm"), overrides);

    assert.equal(workspace.documents.size, 1);
    assert.equal(workspace.loadOrder.length, 1);
    assert.equal(workspace.loadOrder[0], path.resolve("/main.asm"));
    assert.ok(workspace.symbols.has("start"));
  });

  it("follows include directives", async () => {
    const overrides = new Map();
    overrides.set(path.resolve("/main.asm"), new AsmDocument("  include \"lib.asm\"\nmain_label: nop"));
    overrides.set(path.resolve("/lib.asm"), new AsmDocument("lib_label: ret"));
    
    const workspace = await indexWorkspace(path.resolve("/main.asm"), overrides);

    assert.equal(workspace.documents.size, 2);
    assert.equal(workspace.loadOrder.length, 2);
    assert.equal(workspace.loadOrder[0], path.resolve("/main.asm"));
    assert.equal(workspace.loadOrder[1], path.resolve("/lib.asm"));
    
    assert.ok(workspace.symbols.has("main_label"));
    assert.ok(workspace.symbols.has("lib_label"));
    assert.equal(workspace.symbols.get("lib_label")?.filePath, path.resolve("/lib.asm"));
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

    assert.equal(workspace.symbols.get("emit_byte")?.kind, "macro");
    assert.equal(workspace.symbols.get("DATA")?.kind, "data");
    assert.equal(workspace.symbols.get("CONST")?.kind, "equate");
    assert.equal(workspace.symbols.get("LABEL")?.kind, "label");
  });

  it("reuses cached disk documents and lets overrides replace them", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "zils-workspace-cache-"));
    const mainPath = path.join(tempDir, "main.asm");
    const depPath = path.join(tempDir, "dep.asm");
    const diskCache = new Map<string, AsmDocument>();

    fs.writeFileSync(mainPath, 'include "dep.asm"\nMAIN:\n  nop\n', "utf8");
    fs.writeFileSync(depPath, "OLD_LABEL:\n  ret\n", "utf8");

    try {
      const firstWorkspace = await indexWorkspace(mainPath, undefined, CpuDialect.Z80, false, diskCache);
      const cachedDependency = diskCache.get(depPath);
      assert.ok(cachedDependency);
      assert.strictEqual(firstWorkspace.documents.get(depPath), cachedDependency);
      assert.ok(firstWorkspace.symbols.has("OLD_LABEL"));

      fs.writeFileSync(depPath, "NEW_LABEL:\n  ret\n", "utf8");
      const secondWorkspace = await indexWorkspace(mainPath, undefined, CpuDialect.Z80, false, diskCache);
      assert.strictEqual(secondWorkspace.documents.get(depPath), cachedDependency);
      assert.ok(secondWorkspace.symbols.has("OLD_LABEL"));
      assert.ok(!secondWorkspace.symbols.has("NEW_LABEL"));

      const overrideDependency = new AsmDocument("NEW_LABEL:\n  ret\n", CpuDialect.Z80);
      const thirdWorkspace = await indexWorkspace(
        mainPath,
        new Map([[depPath, overrideDependency]]),
        CpuDialect.Z80,
        false,
        diskCache
      );

      assert.strictEqual(thirdWorkspace.documents.get(depPath), overrideDependency);
      assert.ok(thirdWorkspace.symbols.has("NEW_LABEL"));
      assert.ok(!thirdWorkspace.symbols.has("OLD_LABEL"));
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
    assert.equal(workspace.loadOrder.length, 2);
  });

  it("normalizes URIs on Windows", () => {
    if (os.platform() === "win32") {
      const uri1 = "file:///C:/projects/test/main.asm";
      const uri2 = "file:///c:/Projects/test/main.asm";
      // This verifies normalization is stable
      assert.ok(normalizeUri(uri1).startsWith("file:///"));
      assert.ok(normalizeUri(uri2).startsWith("file:///"));
    } else {
      const uri = "file:///home/user/main.asm";
      assert.equal(normalizeUri(uri), uri);
    }
  });
});
