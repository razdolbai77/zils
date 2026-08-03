import { describe, it } from 'node:test';
import * as assert from 'assert';
import { AsmDocument } from '../src/asm/document';
import { CpuDialect } from '../src/asm/metadata';

describe("Asm Document Model", () => {
    it("preserves one parsed line per physical line", () => {
        const cases = [
            { name: "empty input", source: "", expectedLineCount: 1 },
            { name: "trailing blank line", source: "nop\n", expectedLineCount: 2 },
            { name: "middle blank line", source: "nop\n\nret", expectedLineCount: 3 },
            { name: "crlf lines", source: "nop\r\nret\r\n", expectedLineCount: 3 },
            { name: "cr-only lines", source: "nop\rret\r", expectedLineCount: 3 }
        ];

        for (const testCase of cases) {
            const doc = new AsmDocument(testCase.source, CpuDialect.Z80);
            assert.strictEqual(doc.lines.length, testCase.expectedLineCount, `Expected ${testCase.name} to preserve physical line count`);
        }

        const structured = new AsmDocument("start:\n\nret\n", CpuDialect.Z80);
        assert.strictEqual(structured.lines[0].label, "start");
        assert.strictEqual(structured.lines[1].mnemonic, undefined);
        assert.strictEqual(structured.lines[2].mnemonic, "ret");
        assert.strictEqual(structured.lines[3].mnemonic, undefined);
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

    it("keeps diagnostic lines and columns stable for CRLF and CR-only sources", () => {
        for (const newline of ["\r\n", "\r"]) {
            const doc = new AsmDocument(`ld a, b${newline}ld.lil a, b${newline}`, CpuDialect.Z80);
            const errors = doc.getDiagnostics();

            assert.strictEqual(errors.length, 1);
            assert.ok(errors[0].message.includes("Invalid suffix"));
            assert.strictEqual(errors[0].line, 1);
            assert.strictEqual(errors[0].startCharacter, 3);
            assert.strictEqual(errors[0].length, 3);
        }
    });

    it("keeps lines aligned after multi-line block comments", () => {
        const doc = new AsmDocument("/* comment\nspans\nthree lines */\nld.lil a, b\nret", CpuDialect.Z80);

        assert.strictEqual(doc.lines.length, 5);
        assert.strictEqual(doc.lines[3].mnemonic, "ld");
        assert.strictEqual(doc.lines[3].invalidSuffix, true);
        assert.strictEqual(doc.lines[4].mnemonic, "ret");

        const errors = doc.getDiagnostics();
        assert.strictEqual(errors.length, 1);
        assert.ok(errors[0].message.includes("Invalid suffix"));
        assert.strictEqual(errors[0].line, 3);
        assert.strictEqual(errors[0].startCharacter, 3);
    });

    it("parses code after a block comment closing mid-line", () => {
        const doc = new AsmDocument("/* header */ nop\nret", CpuDialect.Z80);

        assert.strictEqual(doc.lines.length, 2);
        assert.strictEqual(doc.lines[0].mnemonic, "nop");
        assert.strictEqual(doc.lines[1].mnemonic, "ret");
        assert.deepStrictEqual(doc.getDiagnostics(), []);
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

