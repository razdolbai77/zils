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

    it("keeps trailing comma operands consistent with leading comma operands", () => {
        const trailing = parseLine("ld a,");
        const leading = parseLine("ld ,b");

        assert.strictEqual(trailing.operands?.length, 2);
        assert.deepStrictEqual(trailing.operands?.map((operand) => operand.length), [1, 0]);
        assert.deepStrictEqual(leading.operands?.map((operand) => operand.length), [0, 1]);
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

    it("requires eZ80 undotted directives to be indented", () => {
        const unindented = parseLine("db 1", CpuDialect.EZ80);
        assert.match(unindented.error ?? "", /Undotted directive/);

        const indented = parseLine(" db 1", CpuDialect.EZ80);
        assert.strictEqual(indented.isDirective, true);

        const dotted = parseLine(".db 1", CpuDialect.EZ80);
        assert.strictEqual(dotted.isDirective, true);
    });

    it("requires eZ80 undotted directives to be indented on every line", () => {
        const tokens = new Lexer("nop\ndb 1\n db 1").tokenize();
        const parser = new LineParser(tokens, CpuDialect.EZ80);

        const first = parser.parseLine();
        const second = parser.parseLine();
        const third = parser.parseLine();

        assert.strictEqual(first.error, undefined);
        assert.match(second.error ?? "", /Undotted directive/);
        assert.strictEqual(second.errorToken?.value, "db");
        assert.strictEqual(third.isDirective, true);
    });

    it("allows column-0 eZ80 structural directives on every line", () => {
        const tokens = new Lexer("nop\nif 1\nendif").tokenize();
        const parser = new LineParser(tokens, CpuDialect.EZ80);

        parser.parseLine();
        const ifLine = parser.parseLine();
        const endifLine = parser.parseLine();

        assert.strictEqual(ifLine.error, undefined);
        assert.strictEqual(ifLine.mnemonic, "if");
        assert.strictEqual(endifLine.error, undefined);
        assert.strictEqual(endifLine.mnemonic, "endif");
    });

    it("parses dotted directives when they are known", () => {
        const line = parseLine(".org 100", CpuDialect.Z80, true);
        assert.strictEqual(line.mnemonic, "org");
        assert.strictEqual(line.isDirective, true);
    });

    it("parses first-column colonless labels before instructions", () => {
        const line = parseLine("loop jr loop", CpuDialect.Z80, true);
        assert.strictEqual(line.label, "loop");
        assert.strictEqual(line.mnemonic, "jr");
        assert.strictEqual(line.operands?.length, 1);
    });

    it("does not reinterpret indented mnemonics as colonless labels", () => {
        const line = parseLine("  ld a,b", CpuDialect.Z80, true);
        assert.strictEqual(line.label, undefined);
        assert.strictEqual(line.mnemonic, "ld");
        assert.strictEqual(line.operands?.length, 2);
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

    it("parses asMSX integer assignments as EQU directives", () => {
        const line = parseLine("Value1=Value1+1");
        assert.strictEqual(line.label, "Value1");
        assert.strictEqual(line.mnemonic, "equ");
        assert.strictEqual(line.isDirective, true);
        assert.strictEqual(line.operands?.length, 1);
        assert.strictEqual(line.operands![0].length, 3);
    });

    it("parses dotted asMSX integer assignments as EQU directives", () => {
        const line = parseLine(".Value1 = 1");
        assert.strictEqual(line.label, ".Value1");
        assert.strictEqual(line.mnemonic, "equ");
        assert.strictEqual(line.isDirective, true);
        assert.strictEqual(line.operands?.length, 1);
        assert.strictEqual(line.operands![0].length, 1);
    });

    it("keeps asMSX parse mode after .zilog", () => {
        // .zilog switches only bracket/paren indirection roles (manual 2.5),
        // not label, rl, or macro grammar.
        const tokens = new Lexer(".zilog\nvalue rl 1\nloop jr loop").tokenize();
        const parser = new LineParser(tokens, CpuDialect.Z80, true);

        parser.parseLine();
        const rlLine = parser.parseLine();
        const labelLine = parser.parseLine();

        assert.strictEqual(rlLine.label, "value");
        assert.strictEqual(rlLine.mnemonic, "rl");
        assert.strictEqual(rlLine.isDirective, true);
        assert.strictEqual(labelLine.label, "loop");
        assert.strictEqual(labelLine.mnemonic, "jr");
    });

    it("does not switch eZ80 files into asMSX parse mode on zilog", () => {
        const tokens = new Lexer("zilog\nloop jr loop").tokenize();
        const parser = new LineParser(tokens, CpuDialect.EZ80, false);

        const zilogLine = parser.parseLine();
        const labelLine = parser.parseLine();

        assert.strictEqual(zilogLine.mnemonic, "zilog");
        assert.strictEqual(labelLine.label, undefined);
        assert.match(labelLine.error ?? "", /must end with ':'/);
    });
});

