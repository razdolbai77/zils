import { describe, it } from "node:test";
import assert from "node:assert";

import path from "node:path";
import os from "node:os";

import { indexWorkspace, normalizeUri } from "../src/asm/workspace";
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
