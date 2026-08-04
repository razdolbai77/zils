import { describe, it } from 'node:test';
import * as assert from 'assert';
import { AsmDocument, Diagnostic } from '../src/asm/document';
import { CpuDialect, CpuTarget } from '../src/asm/metadata';
import {
    createStructuralState,
    advanceStructuralState,
    finalizeStructuralState,
    markOpenMacrosInvalid
} from '../src/asm/structural-state';

describe("Structural state machine", () => {
    function drive(source: string, isAsmsx: boolean) {
        const document = new AsmDocument(source, CpuDialect.Z80, isAsmsx);
        const state = createStructuralState(document);
        const diagnostics: Diagnostic[] = [];
        const emit = (diag: Diagnostic) => diagnostics.push(diag);
        for (let i = 0; i < document.lines.length; i++) {
            const line = document.lines[i];
            if (line.isInactive) continue;
            if (line.error) continue;
            advanceStructuralState(state, document, { line, lineIndex: i, emit, emitMarking: emit });
        }
        finalizeStructuralState(state, document, emit, emit);
        return { state, diagnostics };
    }

    it("seeds syntax mode and cpu from the document", () => {
        const asmsx = createStructuralState(new AsmDocument("nop", CpuDialect.Z80, true));
        assert.strictEqual(asmsx.isAsmsxSyntax, true);
        assert.strictEqual(asmsx.cpu, CpuTarget.Z80);
        const ez80 = createStructuralState(new AsmDocument("nop", CpuDialect.EZ80, false));
        assert.strictEqual(ez80.isAsmsxSyntax, false);
        assert.strictEqual(ez80.cpu, CpuTarget.EZ80);
    });

    it("zilog switches asMSX syntax mode off", () => {
        const { state } = drive("zilog\nnop", true);
        assert.strictEqual(state.isAsmsxSyntax, false);
    });

    it("cpu directive updates the tracked target", () => {
        const { state } = drive("cpu ez80\nnop", true);
        assert.strictEqual(state.cpu, CpuTarget.EZ80);
    });

    it("tracks scope labels", () => {
        const { state } = drive("start:\n.local:\nnop", true);
        assert.strictEqual(state.scopeLabel, "start");
    });

    it("reports unmatched relocate, if, and macro terminators", () => {
        const { diagnostics } = drive("endrelocate\nelse\nendif\nendm", true);
        const messages = diagnostics.map((diag) => diag.message);
        assert.ok(messages.includes("ENDRELOCATE without matching RELOCATE"));
        assert.ok(messages.includes("ELSE without matching IF"));
        assert.ok(messages.includes("ENDIF without matching IF"));
        assert.ok(messages.includes("ENDM without matching MACRO"));
    });

    it("reports unclosed blocks at finalize", () => {
        const { diagnostics } = drive("relocate 100h\nif 1\nmacro m\nnop", true);
        const messages = diagnostics.map((diag) => diag.message);
        assert.ok(messages.includes("RELOCATE without matching ENDRELOCATE"));
        assert.ok(messages.includes("IF without matching ENDIF"));
        assert.ok(messages.includes("MACRO without matching ENDM"));
    });

    it("pairs nested conditionals without diagnostics", () => {
        const { diagnostics } = drive("if 1\nifdef X\nendif\nendif", true);
        assert.strictEqual(diagnostics.length, 0);
    });

    it("captures macro parameters and pops on terminator", () => {
        const document = new AsmDocument("macro m #a, #b\nnop\nendm", CpuDialect.Z80, true);
        const state = createStructuralState(document);
        const emit = () => { /* unused */ };
        advanceStructuralState(state, document, { line: document.lines[0], lineIndex: 0, emit, emitMarking: emit });
        assert.strictEqual(state.macroDepth, 1);
        assert.ok(state.macroStack.at(-1)?.parameters.has('#a'));
        advanceStructuralState(state, document, { line: document.lines[2], lineIndex: 2, emit, emitMarking: emit });
        assert.strictEqual(state.macroDepth, 0);
        assert.strictEqual(state.macroStack.length, 0);
    });

    it("marks open macros invalid when asked", () => {
        const document = new AsmDocument("macro m\nnop", CpuDialect.Z80, true);
        const state = createStructuralState(document);
        const emit = () => { /* unused */ };
        advanceStructuralState(state, document, { line: document.lines[0], lineIndex: 0, emit, emitMarking: emit });
        markOpenMacrosInvalid(state);
        assert.ok(state.invalidMacros.has('m'));
    });

    it("returns continue for structural mnemonics and falls through otherwise", () => {
        const document = new AsmDocument("if 1\nnop", CpuDialect.Z80, true);
        const state = createStructuralState(document);
        const emit = () => { /* unused */ };
        const first = advanceStructuralState(state, document, { line: document.lines[0], lineIndex: 0, emit, emitMarking: emit });
        const second = advanceStructuralState(state, document, { line: document.lines[1], lineIndex: 1, emit, emitMarking: emit });
        assert.strictEqual(first, 'continue');
        assert.strictEqual(second, 'fell-through');
    });
});
