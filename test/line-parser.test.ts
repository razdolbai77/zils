import { describe, it } from 'node:test';
import * as assert from 'assert';
import { Lexer } from '../src/asm/lexer';
import { LineParser } from '../src/asm/line-parser';
import { CpuDialect } from '../src/asm/metadata';

describe("Line Parser", () => {
    function parseLine(text: string, dialect: CpuDialect = CpuDialect.Z80, isAsmsx: boolean = false) {
        const lexer = new Lexer(text);
        const tokens = lexer.tokenize();
        const parser = new LineParser(tokens, dialect, isAsmsx);
        return parser.parseLine(); // parse single line
    }

    it("parses empty lines and comments", () => {
        const line = parseLine("; just a comment");
        assert.ok(line);
        assert.strictEqual(line.comment, "; just a comment");
        assert.strictEqual(line.mnemonic, undefined);
    });

    it("parses labels", () => {
        const line = parseLine("my_label:");
        assert.strictEqual(line.label, "my_label");
    });

    it("parses instructions without operands", () => {
        const line = parseLine("  nop");
        assert.strictEqual(line.mnemonic, "nop");
    });

    it("parses instructions with operands", () => {
        const line = parseLine("ld a, b");
        assert.strictEqual(line.mnemonic, "ld");
        assert.strictEqual(line.operands?.length, 2);
    });

    it("parses labels and instructions", () => {
        const line = parseLine("loop: inc hl ; increment");
        assert.strictEqual(line.label, "loop");
        assert.strictEqual(line.mnemonic, "inc");
        assert.strictEqual(line.operands?.length, 1);
        assert.strictEqual(line.comment, "; increment");
    });

    it("parses eZ80 suffixes", () => {
        const line = parseLine("ld.lil a, b", CpuDialect.EZ80);
        assert.strictEqual(line.mnemonic, "ld");
        assert.strictEqual(line.suffix, "lil");
    });
    
    it("rejects eZ80 suffixes in Z80 mode", () => {
        const line = parseLine("ld.lil a, b", CpuDialect.Z80);
        assert.strictEqual(line.error !== undefined, true);
    });

    it("parses directives", () => {
        const line = parseLine("  equ 10");
        assert.strictEqual(line.mnemonic, "equ");
        assert.strictEqual(line.isDirective, true);
    });

    it("parses dotted directives when they are known", () => {
        const line = parseLine(".org 100", CpuDialect.Z80, true);
        assert.strictEqual(line.mnemonic, "org");
        assert.strictEqual(line.isDirective, true);
    });

    it("parses rl as an instruction in asMSX mode when no label is present", () => {
        const line = parseLine("rl c", CpuDialect.Z80, true);
        assert.strictEqual(line.mnemonic, "rl");
        assert.notStrictEqual(line.isDirective, true);
        assert.strictEqual(line.operands?.length, 1);
    });

    it("parses rl as a reserve-long directive when used after a label in asMSX mode", () => {
        const line = parseLine("value rl 1", CpuDialect.Z80, true);
        assert.strictEqual(line.label, "value");
        assert.strictEqual(line.mnemonic, "rl");
        assert.strictEqual(line.isDirective, true);
        assert.strictEqual(line.operands?.length, 1);
    });
});

