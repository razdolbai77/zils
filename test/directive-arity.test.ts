import { describe, it } from "node:test";
import assert from "node:assert";
import path from "node:path";
import { indexWorkspace } from "../src/asm/workspace";
import { collectDiagnostics } from "../src/asm/diagnostics";
import { AsmDocument, Diagnostic } from "../src/asm/document";
import { CpuDialect } from "../src/asm/metadata";

async function diagnose(source: string, isAsmsx: boolean): Promise<Diagnostic[]> {
    const overrides = new Map();
    overrides.set(path.resolve("/main.asm"), new AsmDocument(source, CpuDialect.Z80, isAsmsx));
    const workspace = await indexWorkspace(path.resolve("/main.asm"), overrides);
    return collectDiagnostics(workspace, path.resolve("/main.asm"));
}

describe("Directive arity from metadata", () => {
    it("rejects operands on no-parameter directives", async () => {
        const diags = await diagnose("bios 1", true);
        assert.ok(diags.some((d) => d.message === "Directive 'bios' does not take any operands"));
    });

    it("requires exactly one operand on one-parameter directives", async () => {
        const diags = await diagnose("org 100h, 200h", true);
        assert.ok(diags.some((d) => d.message === "Directive 'org' requires exactly one operand"));
    });

    it("requires one string operand on string directives", async () => {
        const diags = await diagnose("include 42", true);
        assert.ok(diags.some((d) => d.message === "Directive 'include' expects a string operand"));
    });

    it("accepts zero or one string operand on optional-string directives", async () => {
        const none = await diagnose("cas", true);
        assert.ok(!none.some((d) => d.message.includes("operand")));
        const numeric = await diagnose("cas 42", true);
        assert.ok(numeric.some((d) => d.message === "Directive 'cas' expects a string operand if provided"));
    });

    it("accepts zero or one numeric operand on optional directives", async () => {
        const none = await diagnose("break", true);
        assert.ok(!none.some((d) => d.message.includes("operand")));
        const string = await diagnose("break \"x\"", true);
        assert.ok(string.some((d) => d.message === "Directive 'break' expects a numeric expression if provided, not a string"));
    });

    it("accepts balanced rept/endr blocks", async () => {
        const diags = await diagnose("rept 4\nnop\nendr", true);
        assert.ok(!diags.some((d) => d.message.includes("REPT") || d.message.includes("ENDR")));
    });

    it("reports unmatched endr and unclosed rept", async () => {
        const unbalanced = await diagnose("endr\nrept 2", true);
        assert.ok(unbalanced.some((d) => d.message === "ENDR without matching REPT"));
        assert.ok(unbalanced.some((d) => d.message === "REPT without matching ENDR"));
    });
});
