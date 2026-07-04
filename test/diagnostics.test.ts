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

    it("reports [register] as wrong indirect syntax in eZ80 mode", () => {
        const overrides = new Map();
        overrides.set(path.resolve("/main.asm"), new AsmDocument("ld a,[hl]", CpuDialect.EZ80, false));
        const workspace = indexWorkspace(path.resolve("/main.asm"), overrides);
        const diags = collectDiagnostics(workspace, path.resolve("/main.asm"));
        assert.ok(diags.some((d: Diagnostic) => d.message.includes("Square brackets")), "Expected bracket diagnostic in eZ80 mode");
    });

    it("allows [expression] grouping in eZ80 mode", () => {
        const overrides = new Map();
        // [val+1] where val is a symbol - no register inside, so this is expression grouping
        overrides.set(path.resolve("/main.asm"), new AsmDocument("MY_SYM equ 5\nld hl,[MY_SYM+1]", CpuDialect.EZ80, false));
        const workspace = indexWorkspace(path.resolve("/main.asm"), overrides);
        const diags = collectDiagnostics(workspace, path.resolve("/main.asm"));
        assert.ok(!diags.some((d: Diagnostic) => d.message.includes("Square brackets")), "Should not flag [symbol+offset] as wrong indirect syntax");
    });

    it("allows (register-pair) as correct indirect syntax in eZ80 mode", () => {
        const overrides = new Map();
        overrides.set(path.resolve("/main.asm"), new AsmDocument("ld a,(hl)", CpuDialect.EZ80, false));
        const workspace = indexWorkspace(path.resolve("/main.asm"), overrides);
        const diags = collectDiagnostics(workspace, path.resolve("/main.asm"));
        assert.equal(diags.length, 0, "Expected no diagnostics for (hl) in eZ80 mode");
    });

    it("reports (8-bit-register) as invalid indirect in eZ80 mode", () => {
        const overrides = new Map();
        overrides.set(path.resolve("/main.asm"), new AsmDocument("ld a,(h)", CpuDialect.EZ80, false));
        const workspace = indexWorkspace(path.resolve("/main.asm"), overrides);
        const diags = collectDiagnostics(workspace, path.resolve("/main.asm"));
        assert.ok(diags.some((d: Diagnostic) => d.message.includes("cannot be used for indirect")), "Expected invalid-indirect diagnostic for (h) in eZ80 mode");
    });

    it("reports [8-bit-register] as invalid indirect in eZ80 mode (not a bracket-type error)", () => {
        const overrides = new Map();
        overrides.set(path.resolve("/main.asm"), new AsmDocument("ld a,[h]", CpuDialect.EZ80, false));
        const workspace = indexWorkspace(path.resolve("/main.asm"), overrides);
        const diags = collectDiagnostics(workspace, path.resolve("/main.asm"));
        assert.ok(diags.some((d: Diagnostic) => d.message.includes("cannot be used for indirect")), "Expected invalid-indirect diagnostic for [h] in eZ80 mode");
        assert.ok(!diags.some((d: Diagnostic) => d.message.includes("use parentheses")), "Should not suggest fixing brackets when register itself is invalid");
    });

    it("reports (8-bit-register) as invalid indirect in asMSX mode (not a bracket-type error)", () => {
        const overrides = new Map();
        overrides.set(path.resolve("/main.asm"), new AsmDocument("ld a,(h)", CpuDialect.Z80, true));
        const workspace = indexWorkspace(path.resolve("/main.asm"), overrides);
        const diags = collectDiagnostics(workspace, path.resolve("/main.asm"));
        assert.ok(diags.some((d: Diagnostic) => d.message.includes("cannot be used for indirect")), "Expected invalid-indirect diagnostic for (h) in asMSX mode");
        assert.ok(!diags.some((d: Diagnostic) => d.message.includes("use square brackets")), "Should not suggest fixing brackets when register itself is invalid");
    });

    it("reports [8-bit-register] as invalid indirect in asMSX mode", () => {
        const overrides = new Map();
        overrides.set(path.resolve("/main.asm"), new AsmDocument("ld a,[h]", CpuDialect.Z80, true));
        const workspace = indexWorkspace(path.resolve("/main.asm"), overrides);
        const diags = collectDiagnostics(workspace, path.resolve("/main.asm"));
        assert.ok(diags.some((d: Diagnostic) => d.message.includes("cannot be used for indirect")), "Expected invalid-indirect diagnostic for [h] in asMSX mode");
    });

    it("reports (register) as wrong indirect syntax in asMSX mode", () => {
        const overrides = new Map();
        overrides.set(path.resolve("/main.asm"), new AsmDocument("ld a,(hl)", CpuDialect.Z80, true));
        const workspace = indexWorkspace(path.resolve("/main.asm"), overrides);
        const diags = collectDiagnostics(workspace, path.resolve("/main.asm"));
        assert.ok(diags.some((d: Diagnostic) => d.message.includes("Parentheses")), "Expected parentheses diagnostic in asMSX mode");
    });

    it("allows (expression) grouping in asMSX mode", () => {
        const overrides = new Map();
        overrides.set(path.resolve("/main.asm"), new AsmDocument("MY_SYM equ 5\nld hl,(MY_SYM+1)", CpuDialect.Z80, true));
        const workspace = indexWorkspace(path.resolve("/main.asm"), overrides);
        const diags = collectDiagnostics(workspace, path.resolve("/main.asm"));
        assert.ok(!diags.some((d: Diagnostic) => d.message.includes("Parentheses")), "Should not flag (symbol+offset) as wrong indirect syntax");
    });

    it("allows [register-pair] as correct indirect syntax in asMSX mode", () => {
        const overrides = new Map();
        overrides.set(path.resolve("/main.asm"), new AsmDocument("ld a,[hl]", CpuDialect.Z80, true));
        const workspace = indexWorkspace(path.resolve("/main.asm"), overrides);
        const diags = collectDiagnostics(workspace, path.resolve("/main.asm"));
        assert.equal(diags.length, 0, "Expected no diagnostics for [hl] in asMSX mode");
    });

    it("reports invalid offset addressing (e.g. de+4) in eZ80 mode", () => {
        const overrides = new Map();
        overrides.set(path.resolve("/main.asm"), new AsmDocument("ld a,(de+4)", CpuDialect.EZ80, false));
        const workspace = indexWorkspace(path.resolve("/main.asm"), overrides);
        const diags = collectDiagnostics(workspace, path.resolve("/main.asm"));
        assert.ok(diags.some((d: Diagnostic) => d.message.includes("offset")), "Expected diagnostic for (de+4) in eZ80 mode");
    });

    it("reports invalid offset addressing (e.g. [bc-1]) in asMSX mode", () => {
        const overrides = new Map();
        overrides.set(path.resolve("/main.asm"), new AsmDocument("ld a,[bc-1]", CpuDialect.Z80, true));
        const workspace = indexWorkspace(path.resolve("/main.asm"), overrides);
        const diags = collectDiagnostics(workspace, path.resolve("/main.asm"));
        assert.ok(diags.some((d: Diagnostic) => d.message.includes("offset")), "Expected diagnostic for [bc-1] in asMSX mode");
    });

    it("allows ix/iy offset addressing (e.g. (ix+5)) in eZ80 mode", () => {
        const overrides = new Map();
        overrides.set(path.resolve("/main.asm"), new AsmDocument("ld a,(ix+5)", CpuDialect.EZ80, false));
        const workspace = indexWorkspace(path.resolve("/main.asm"), overrides);
        const diags = collectDiagnostics(workspace, path.resolve("/main.asm"));
        assert.equal(diags.length, 0, "Expected no diagnostics for (ix+5) in eZ80 mode");
    });

    it("allows ix/iy offset addressing (e.g. [iy-3]) in asMSX mode", () => {
        const overrides = new Map();
        overrides.set(path.resolve("/main.asm"), new AsmDocument("ld a,[iy-3]", CpuDialect.Z80, true));
        const workspace = indexWorkspace(path.resolve("/main.asm"), overrides);
        const diags = collectDiagnostics(workspace, path.resolve("/main.asm"));
        assert.equal(diags.length, 0, "Expected no diagnostics for [iy-3] in asMSX mode");
    });

    it("reports multiple indirect operands (memory-to-memory) in eZ80 mode", () => {
        const overrides = new Map();
        overrides.set(path.resolve("/main.asm"), new AsmDocument("ld (iy+4),(de)", CpuDialect.EZ80, false));
        const workspace = indexWorkspace(path.resolve("/main.asm"), overrides);
        const diags = collectDiagnostics(workspace, path.resolve("/main.asm"));
        assert.ok(diags.some((d: Diagnostic) => d.message.includes("multiple indirect operands")), "Expected diagnostic for multiple indirect operands");
    });

    it("reports multiple indirect operands (memory-to-memory) in asMSX mode", () => {
        const overrides = new Map();
        overrides.set(path.resolve("/main.asm"), new AsmDocument("ld [iy+4],[de]", CpuDialect.Z80, true));
        const workspace = indexWorkspace(path.resolve("/main.asm"), overrides);
        const diags = collectDiagnostics(workspace, path.resolve("/main.asm"));
        assert.ok(diags.some((d: Diagnostic) => d.message.includes("multiple indirect operands")), "Expected diagnostic for multiple indirect operands");
    });

    it("allows valid syntax", () => {
        const overrides = new Map();
        overrides.set(path.resolve("/main.asm"), new AsmDocument("start:\n  ld a, b\n  ret\n", CpuDialect.Z80));
        const workspace = indexWorkspace(path.resolve("/main.asm"), overrides);
        
        const diags = collectDiagnostics(workspace, path.resolve("/main.asm"));
        assert.equal(diags.length, 0, "Expected no diagnostics for valid syntax");
    });
});
