import test from "node:test";
import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { AsmDocument } from "../src/asm/document";
import { indexWorkspace } from "../src/asm/workspace";
import { collectDiagnostics } from "../src/asm/diagnostics";
import { findReferences } from "../src/lsp/symbol-navigation";

test("Performance", async (t) => {
  const lines: string[] = [];
  
  // Define 10,000 blocks of instructions, each with labels, instructions, and equates
  for (let i = 0; i < 10000; i++) {
    lines.push(`global_label_${i}:`);
    lines.push(`    ld a, 10`);
    lines.push(`    ld b, a`);
    lines.push(`@local_label_${i}:`);
    if (i > 0) {
      lines.push(`    call global_label_${i - 1}`);
      lines.push(`    jp @local_label_${i}`); // local label jump
    }
    lines.push(`equate_${i}: equ ${i}`);
    lines.push(`    ld c, equate_${i}`);
  }

  const source = lines.join("\n");
  
  await t.test("parse, index, diagnose, and navigate large workspace", async () => {
    const start = performance.now();
    
    const document = new AsmDocument(source);
    const fixturePath = path.resolve("performance_fixture.asm");
    const uri = pathToFileURL(fixturePath).toString();
    
    const fileOverrides = new Map([
      [fixturePath, document]
    ]);
    
    const workspace = await indexWorkspace(fixturePath, fileOverrides);
    const diagnostics = collectDiagnostics(workspace, fixturePath);
    
    const uriOverrides = new Map([
      [uri, document]
    ]);
    
    // Find references for global_label_0 (line 0, character 0)
    const refs = await findReferences(uriOverrides, uri, 0, 0, false);
    
    const duration = performance.now() - start;
    
    assert.ok(duration < 5000, `Performance test took too long: ${duration}ms`);
    assert.ok(workspace.symbols.size >= 10000, `Expected at least 10000 symbols`);
    assert.ok(diagnostics !== undefined);
    assert.ok(refs.length > 0, `Expected at least one reference`);
  });
});
