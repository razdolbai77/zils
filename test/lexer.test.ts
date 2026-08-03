import { describe, it } from 'node:test';
import * as assert from 'assert';
import { Lexer, TokenType } from '../src/asm/lexer';

describe("Lexer", () => {
    it("lexes identifiers and mnemonics", () => {
        const lexer = new Lexer("ld a, b");
        const tokens = lexer.tokenize();
        assert.strictEqual(tokens.length, 4);
        assert.strictEqual(tokens[0].type, TokenType.Identifier);
        assert.strictEqual(tokens[0].value, "ld");
        assert.strictEqual(tokens[1].type, TokenType.Identifier);
        assert.strictEqual(tokens[1].value, "a");
        assert.strictEqual(tokens[2].type, TokenType.Comma);
        assert.strictEqual(tokens[3].type, TokenType.Identifier);
        assert.strictEqual(tokens[3].value, "b");
    });

    it("lexes numbers in various formats", () => {
        const lexer = new Lexer("123 0x1A $1A 1Ah %1010 1010b");
        const tokens = lexer.tokenize();
        assert.strictEqual(tokens.length, 6);
        for (const t of tokens) {
            assert.strictEqual(t.type, TokenType.Number);
        }
    });
    it("lexes documented asMSX numeric formats", () => {
        const lexer = new Lexer("0 255 1.25 077 77o 123O 0x1A $1A 1Ah 1010b 1010B", true);
        const tokens = lexer.tokenize();
        assert.strictEqual(tokens.length, 11);
        for (const token of tokens) {
            assert.strictEqual(token.type, TokenType.Number);
        }
    });

    it("rejects non-asMSX numeric formats", () => {
        const tokens = new Lexer("#1A %1010 0b1010 1.5e2", true).tokenize();

        assert.strictEqual(tokens[0].type, TokenType.Identifier);
        for (const token of tokens.slice(1)) {
            assert.strictEqual(token.type, TokenType.Unknown);
        }
    });

    it("rejects malformed number suffixes as Unknown", () => {
        const lexer = new Lexer("078 77q 1.23xyz 4.5e");
        const tokens = lexer.tokenize();
        assert.strictEqual(tokens.length, 4);
        for (const t of tokens) {
            assert.strictEqual(t.type, TokenType.Unknown);
        }
    });

    it("lexes strings", () => {
        const lexer = new Lexer("\"hello\" 'world'");
        const tokens = lexer.tokenize();
        assert.strictEqual(tokens.length, 2);
        assert.strictEqual(tokens[0].type, TokenType.String);
        assert.strictEqual(tokens[0].value, "hello");
        assert.strictEqual(tokens[1].type, TokenType.String);
        assert.strictEqual(tokens[1].value, "world");
    });

    it("decodes and marks invalid escapes in eZ80 strings", () => {
        const tokens = new Lexer(String.raw`"line\n\t\"\\\?" "invalid\q"`).tokenize();

        assert.strictEqual(tokens[0].value, "line\n\t\"\\?");
        assert.strictEqual(tokens[1].value, String.raw`invalid\q`);
        assert.strictEqual(tokens[1].invalidEscape, true);
    });

    it("retains the full contents of unterminated strings", () => {
        const lexer = new Lexer("\"hello\n'world");
        const tokens = lexer.tokenize();
        assert.strictEqual(tokens.length, 3);
        assert.strictEqual(tokens[0].type, TokenType.String);
        assert.strictEqual(tokens[0].value, "hello");
        assert.strictEqual(tokens[0].unterminated, true);
        assert.strictEqual(tokens[1].type, TokenType.Newline);
        assert.strictEqual(tokens[2].type, TokenType.String);
        assert.strictEqual(tokens[2].value, "world");
        assert.strictEqual(tokens[2].unterminated, true);
    });

    it("lexes comments", () => {
        const lexer = new Lexer("ld a, b ; this is a comment\ninc a");
        const tokens = lexer.tokenize();
        assert.strictEqual(tokens.length, 8); // ld, a, comma, b, comment, newline, inc, a
        assert.strictEqual(tokens[4].type, TokenType.Comment);
        assert.strictEqual(tokens[4].value, "; this is a comment");
        assert.strictEqual(tokens[5].type, TokenType.Newline);
    });

    it("lexes asMSX line comments through their line boundaries", () => {
        const lexer = new Lexer("ld a, b // slash comment\r\ninc a -- dash comment\nret", true);
        const tokens = lexer.tokenize();
        const comments = tokens.filter((token) => token.type === TokenType.Comment);
        const newlines = tokens.filter((token) => token.type === TokenType.Newline);

        assert.deepStrictEqual(comments.map((token) => token.value), ["// slash comment", "-- dash comment"]);
        assert.strictEqual(newlines.length, 2);
        assert.strictEqual(tokens.at(-1)?.value, "ret");
    });

    it("lexes asMSX block comments and preserves strings containing comment markers", () => {
        const lexer = new Lexer('db "// -- /* */ { }" /* first\nsecond */ db "{ not comment }" { final }', true);
        const tokens = lexer.tokenize();
        const comments = tokens.filter((token) => token.type === TokenType.Comment);
        const strings = tokens.filter((token) => token.type === TokenType.String);
        const newlines = tokens.filter((token) => token.type === TokenType.Newline);

        assert.deepStrictEqual(comments.map((token) => token.value), ["/* first", "second */", "{ final }"]);
        assert.deepStrictEqual(strings.map((token) => token.value), ["// -- /* */ { }", "{ not comment }"]);
        assert.strictEqual(newlines.length, 1);
    });

    it("emits newline tokens for newlines inside multi-line block comments", () => {
        const lexer = new Lexer("/* line one\r\n   line two\r\nline three */\nld a, b", true);
        const tokens = lexer.tokenize();

        assert.deepStrictEqual(tokens.map((token) => token.type), [
            TokenType.Comment,
            TokenType.Newline,
            TokenType.Comment,
            TokenType.Newline,
            TokenType.Comment,
            TokenType.Newline,
            TokenType.Identifier,
            TokenType.Identifier,
            TokenType.Comma,
            TokenType.Identifier
        ]);
        assert.deepStrictEqual(
            tokens.filter((token) => token.type === TokenType.Comment).map((token) => token.value),
            ["/* line one", "   line two", "line three */"]
        );
        assert.strictEqual(tokens.at(-1)?.value, "b");
    });

    it("retains unterminated asMSX block comments", () => {
        const lexer = new Lexer("ld a, b /* missing end", true);
        const tokens = lexer.tokenize();
        const comment = tokens.at(-1);

        assert.strictEqual(comment?.type, TokenType.Comment);
        assert.strictEqual(comment?.value, "/* missing end");
        assert.strictEqual(comment?.unterminated, true);
    });

    it("flags the opening segment of an unterminated multi-line block comment", () => {
        const lexer = new Lexer("/* open\nstill open", true);
        const tokens = lexer.tokenize();
        const comments = tokens.filter((token) => token.type === TokenType.Comment);

        assert.deepStrictEqual(comments.map((token) => token.value), ["/* open", "still open"]);
        assert.strictEqual(comments[0].unterminated, true);
        assert.strictEqual(comments[1].unterminated, undefined);
    });

    it("lexes punctuation", () => {
        const lexer = new Lexer("label: (ix+5) .s");
        const tokens = lexer.tokenize();
        assert.strictEqual(tokens[0].type, TokenType.Identifier);
        assert.strictEqual(tokens[1].type, TokenType.Colon);
        assert.strictEqual(tokens[2].type, TokenType.LParen);
        assert.strictEqual(tokens[3].type, TokenType.Identifier); // ix
        assert.strictEqual(tokens[4].type, TokenType.Plus);
        assert.strictEqual(tokens[5].type, TokenType.Number);
        assert.strictEqual(tokens[6].type, TokenType.RParen);
        assert.strictEqual(tokens[7].type, TokenType.Dot);
        assert.strictEqual(tokens[8].type, TokenType.Identifier); // s
    });
});

