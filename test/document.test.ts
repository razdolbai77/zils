import { describe, it } from 'node:test';
import * as assert from 'assert';
import { AsmDocument } from '../src/asm/document';
import { CpuDialect } from '../src/asm/metadata';

describe("Asm Document Model", () => {
    it("parses multiple lines and preserves structure", () => {
        const source = `
        ; A test program
        org 0x100
start:  ld a, b
        ret
        `;

        const doc = new AsmDocument(source, CpuDialect.Z80);
        const lines = doc.lines;
        
        // Let's verify line count.
        // Line 0: empty (first newline)
        // Line 1: comment
        // Line 2: org
        // Line 3: start: ld a,b
        // Line 4: ret
        // Line 5: empty trailing
        
        // Actually, our lexer creates newlines for every \n.
        // Wait, AsmDocument might filter out empty lines or keep them for 1:1 mapping with editor lines.
        // For LSP, we NEED a 1:1 mapping with source text lines.
        assert.ok(lines.length >= 5);
        
        // Find the start label
        const startLine = lines.find(l => l.label === 'start');
        assert.ok(startLine);
        assert.strictEqual(startLine?.mnemonic, 'ld');
        assert.strictEqual(startLine?.operands?.length, 2);
    });

    it("collects diagnostics for malformed lines", () => {
        const source = `
        ld a, b
        ld.lil a, b
        ret
        `;

        const doc = new AsmDocument(source, CpuDialect.Z80); // .lil is invalid in Z80
        const errors = doc.getDiagnostics();
        assert.strictEqual(errors.length, 1);
        assert.ok(errors[0].message.includes("Invalid suffix"));
        // Should know which line the error is on
        assert.strictEqual(errors[0].line, 2); // 0-indexed: line 0 is empty, 1 is ld a,b, 2 is ld.lil
    });

    it("reports unterminated strings with a precise range", () => {
        const doc = new AsmDocument('include "lib.asm', CpuDialect.Z80);
        const errors = doc.getDiagnostics();

        assert.strictEqual(errors.length, 1);
        assert.strictEqual(errors[0].message, "Unterminated string literal");
        assert.strictEqual(errors[0].line, 0);
        assert.strictEqual(errors[0].startCharacter, 8);
        assert.strictEqual(errors[0].length, 8);
    });
});

