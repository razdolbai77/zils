import { describe, it } from 'node:test';
import * as assert from 'assert';
import { AsmDocument } from '../src/asm/document';
import { SymbolCollector } from '../src/asm/symbols';

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
        const doc = new AsmDocument("MAX_COUNT equ 100\nOFFSET equ MAX_COUNT + 5");
        const collector = new SymbolCollector(doc);
        const symbols = collector.getSymbols();
        
        assert.strictEqual(symbols.length, 2);
        assert.strictEqual(symbols[0].name, "MAX_COUNT");
        assert.strictEqual(symbols[0].isEquate, true);
        assert.strictEqual(symbols[0].value, 100);
        
        assert.strictEqual(symbols[1].name, "OFFSET");
        assert.strictEqual(symbols[1].value, 105);
    });

    it("preserves label, equate, data, and macro kinds", () => {
        const doc = new AsmDocument([
            "  macro emit_byte",
            "  endm",
            "DATA db 1",
            "CONST equ 2",
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

