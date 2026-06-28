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

    it("lexes strings", () => {
        const lexer = new Lexer("\"hello\" 'world'");
        const tokens = lexer.tokenize();
        assert.strictEqual(tokens.length, 2);
        assert.strictEqual(tokens[0].type, TokenType.String);
        assert.strictEqual(tokens[0].value, "hello");
        assert.strictEqual(tokens[1].type, TokenType.String);
        assert.strictEqual(tokens[1].value, "world");
    });

    it("lexes comments", () => {
        const lexer = new Lexer("ld a, b ; this is a comment\ninc a");
        const tokens = lexer.tokenize();
        assert.strictEqual(tokens.length, 8); // ld, a, comma, b, comment, newline, inc, a
        assert.strictEqual(tokens[4].type, TokenType.Comment);
        assert.strictEqual(tokens[4].value, "; this is a comment");
        assert.strictEqual(tokens[5].type, TokenType.Newline);
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

