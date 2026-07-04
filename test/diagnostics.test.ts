import { describe, it } from "node:test";
import assert from "node:assert";
import path from "node:path";
import { indexWorkspace } from "../src/asm/workspace";
import { collectDiagnostics } from "../src/asm/diagnostics";
import { AsmDocument, Diagnostic } from "../src/asm/document";
import { CpuDialect } from "../src/asm/metadata";

describe("Diagnostics", () => {
    it("reports malformed syntax", () => {
        const overrides = new Map();
        overrides.set(path.resolve("/main.asm"), new AsmDocument("ld a, , b", CpuDialect.Z80));
        const workspace = indexWorkspace(path.resolve("/main.asm"), overrides);
        
        const diags = collectDiagnostics(workspace, path.resolve("/main.asm"));
        assert.ok(diags.some((d: Diagnostic) => d.message.includes("Wrong operand form")), "Expected malformed syntax diagnostic");
    });

    it("reports unknown instructions", () => {
        const overrides = new Map();
        overrides.set(path.resolve("/main.asm"), new AsmDocument("fakeinst a, b", CpuDialect.Z80));
        const workspace = indexWorkspace(path.resolve("/main.asm"), overrides);
        
        const diags = collectDiagnostics(workspace, path.resolve("/main.asm"));
        assert.ok(diags.some((d: Diagnostic) => d.message.includes("Unknown instruction: fakeinst")), "Expected unknown instruction diagnostic");
    });

    it("reports eZ80 instruction in Z80 mode", () => {
        const overrides = new Map();
        overrides.set(path.resolve("/main.asm"), new AsmDocument("lea hl, ix+1", CpuDialect.Z80));
        const workspace = indexWorkspace(path.resolve("/main.asm"), overrides);
        
        const diags = collectDiagnostics(workspace, path.resolve("/main.asm"));
        assert.ok(diags.some((d: Diagnostic) => d.message.includes("is not supported in dialect z80")), "Expected dialect diagnostic");
    });

    it("allows eZ80 instruction in eZ80 mode", () => {
        const overrides = new Map();
        overrides.set(path.resolve("/main.asm"), new AsmDocument("lea hl, ix+1", CpuDialect.EZ80));
        const workspace = indexWorkspace(path.resolve("/main.asm"), overrides);
        
        const diags = collectDiagnostics(workspace, path.resolve("/main.asm"));
        assert.ok(!diags.some((d: Diagnostic) => d.message.includes("is not supported")), "Should not report dialect diagnostic");
    });

    it("reports unresolved symbols", () => {
        const overrides = new Map();
        overrides.set(path.resolve("/main.asm"), new AsmDocument("ld a, undefined_sym", CpuDialect.Z80));
        const workspace = indexWorkspace(path.resolve("/main.asm"), overrides);
        
        const diags = collectDiagnostics(workspace, path.resolve("/main.asm"));
        assert.ok(diags.some((d: Diagnostic) => d.message.includes("Unresolved symbol: undefined_sym")), "Expected unresolved symbol diagnostic");
    });

    it("reports duplicate symbols", () => {
        const overrides = new Map();
        overrides.set(path.resolve("/main.asm"), new AsmDocument("dup:\n  nop\ndup:\n  ret", CpuDialect.Z80));
        const workspace = indexWorkspace(path.resolve("/main.asm"), overrides);
        
        const diags = collectDiagnostics(workspace, path.resolve("/main.asm"));
        assert.ok(diags.some((d: Diagnostic) => d.message.includes("Duplicate symbol definition: dup")), "Expected duplicate symbol diagnostic");
    });

    it("allows assume adl=0 and adl=1 in eZ80 mode", () => {
        for (const src of ["assume adl=0", "assume adl=1"]) {
            const overrides = new Map();
            overrides.set(path.resolve("/main.asm"), new AsmDocument(src, CpuDialect.EZ80));
            const workspace = indexWorkspace(path.resolve("/main.asm"), overrides);
            const diags = collectDiagnostics(workspace, path.resolve("/main.asm"));
            assert.equal(diags.length, 0, `Expected no diagnostics for '${src}'`);
        }
    });

    it("rejects assume adl=2 (invalid value)", () => {
        const overrides = new Map();
        overrides.set(path.resolve("/main.asm"), new AsmDocument("assume adl=2", CpuDialect.EZ80));
        const workspace = indexWorkspace(path.resolve("/main.asm"), overrides);
        const diags = collectDiagnostics(workspace, path.resolve("/main.asm"));
        assert.ok(diags.some((d: Diagnostic) => d.message.includes("Invalid value for assume 'adl'")), "Expected invalid value diagnostic");
    });

    it("rejects assume with unknown key", () => {
        const overrides = new Map();
        overrides.set(path.resolve("/main.asm"), new AsmDocument("assume xyz=1", CpuDialect.EZ80));
        const workspace = indexWorkspace(path.resolve("/main.asm"), overrides);
        const diags = collectDiagnostics(workspace, path.resolve("/main.asm"));
        assert.ok(diags.some((d: Diagnostic) => d.message.includes("Unknown assume key")), "Expected unknown key diagnostic");
    });

    it("reports unresolved symbol in org operand", () => {
        const overrides = new Map();
        overrides.set(path.resolve("/main.asm"), new AsmDocument("org blah", CpuDialect.EZ80));
        const workspace = indexWorkspace(path.resolve("/main.asm"), overrides);
        const diags = collectDiagnostics(workspace, path.resolve("/main.asm"));
        assert.ok(diags.some((d: Diagnostic) => d.message.includes("Unresolved symbol: blah")), "Expected unresolved symbol diagnostic for org");
    });

    it("allows valid syntax", () => {
        const overrides = new Map();
        overrides.set(path.resolve("/main.asm"), new AsmDocument("start:\n  ld a, b\n  ret\n", CpuDialect.Z80));
        const workspace = indexWorkspace(path.resolve("/main.asm"), overrides);
        
        const diags = collectDiagnostics(workspace, path.resolve("/main.asm"));
        assert.equal(diags.length, 0, "Expected no diagnostics for valid syntax");
    });
});
