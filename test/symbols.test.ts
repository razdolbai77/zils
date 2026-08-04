import { describe, it } from 'node:test';
import * as assert from 'assert';
import { AsmDocument } from '../src/asm/document';
import { SymbolCollector } from '../src/asm/symbols';
import { CpuDialect } from '../src/asm/metadata';

describe("Symbol Collector", () => {
    it("collects global labels", () => {
        const doc = new AsmDocument("start:\n  nop\nend_loop:");
        const collector = new SymbolCollector(doc);
        const symbols = collector.getSymbols();
        
        assert.strictEqual(symbols.length, 2);
        assert.strictEqual(symbols[0].name, "start");
        assert.strictEqual(symbols[0].isLocal, false);
        assert.strictEqual(symbols[1].name, "end_loop");
    });

    it("collects local labels", () => {
        const doc = new AsmDocument("main:\n@loop:\n  jr @loop");
        const collector = new SymbolCollector(doc);
        const symbols = collector.getSymbols();
        
        assert.strictEqual(symbols.length, 2);
        assert.strictEqual(symbols[1].name, "main@loop");
        assert.strictEqual(symbols[1].isLocal, true);
    });

    it("collects equates and attempts to evaluate them", () => {
        const doc = new AsmDocument("MAX_COUNT: equ 100\nOFFSET: equ MAX_COUNT + 5");
        const collector = new SymbolCollector(doc);
        const symbols = collector.getSymbols();
        
        assert.strictEqual(symbols.length, 2);
        assert.strictEqual(symbols[0].name, "MAX_COUNT");
        assert.strictEqual(symbols[0].isEquate, true);
        assert.strictEqual(symbols[0].value, 100);
        
        assert.strictEqual(symbols[1].name, "OFFSET");
        assert.strictEqual(symbols[1].value, 105);
    });

    it("evaluates Z80 equates with C-like asMSX precedence", () => {
        const doc = new AsmDocument("FIRST equ 1\nSECOND equ 2\nVALUE equ FIRST | SECOND + 3", CpuDialect.Z80, true);
        const collector = new SymbolCollector(doc);

        assert.strictEqual(collector.getSymbols().find((symbol) => symbol.name === "VALUE")?.value, 5);
    });

    it("does not inject BIOS symbols outside asMSX", () => {
        const doc = new AsmDocument("bios:\n  ret");
        const collector = new SymbolCollector(doc);
        const names = collector.getSymbols().map((symbol) => symbol.name);
        assert.deepEqual(names, ["bios"]);
    });

    it("injects BIOS symbols in asMSX documents", () => {
        const doc = new AsmDocument("bios\n  call CHPUT", CpuDialect.Z80, true);
        const collector = new SymbolCollector(doc);
        assert.ok(collector.getSymbols().some((symbol) => symbol.name === "CHPUT"));
    });

    it("reports user symbols colliding with BIOS names in asMSX", () => {
        const doc = new AsmDocument("CHPUT:\n  ret\nbios", CpuDialect.Z80, true);
        const collector = new SymbolCollector(doc);
        const chput = collector.getSymbols().find((symbol) => symbol.name === "CHPUT");
        assert.strictEqual(chput?.line, 0, "the user definition must win over the injection");
        assert.ok(
            collector.getErrors().some((error) => error.message.includes("collides with an asMSX BIOS")),
            "a collision with a BIOS name must be reported"
        );
    });

    it("preserves label, equate, data, and macro kinds", () => {
        const doc = new AsmDocument([
            "  macro emit_byte",
            "  endm",
            "DATA: db 1",
            "CONST: equ 2",
            "LABEL:",
            "  nop"
        ].join("\n"));
        const collector = new SymbolCollector(doc);
        const symbols = collector.getSymbols();

        assert.strictEqual(symbols.find((symbol) => symbol.name === "emit_byte")?.kind, "macro");
        assert.strictEqual(symbols.find((symbol) => symbol.name === "DATA")?.kind, "data");
        assert.strictEqual(symbols.find((symbol) => symbol.name === "CONST")?.kind, "equate");
        assert.strictEqual(symbols.find((symbol) => symbol.name === "LABEL")?.kind, "label");
    });

    it("detects duplicate definitions", () => {
        const doc = new AsmDocument("start:\nstart:\n");
        const collector = new SymbolCollector(doc);
        const errors = collector.getErrors();
        
        assert.strictEqual(errors.length, 1);
        assert.ok(errors[0].message.includes("Duplicate symbol"));
    });
});

