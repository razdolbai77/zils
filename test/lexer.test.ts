import { describe, it } from 'node:test';
import * as assert from 'assert';
import { performance } from 'node:perf_hooks';
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

    it("lexes af' as one identifier, never a string", () => {
        const lexer = new Lexer("ex af, af'");
        const tokens = lexer.tokenize();
        assert.strictEqual(tokens.length, 4);
        assert.strictEqual(tokens[3].type, TokenType.Identifier);
        assert.strictEqual(tokens[3].value, "af'");
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

    it("lexes malformed eZ80 hash numbers as Unknown", () => {
        const tokens = new Lexer("#1A #xyz #").tokenize();
        assert.strictEqual(tokens.length, 3);
        assert.strictEqual(tokens[0].type, TokenType.Number);
        assert.strictEqual(tokens[1].type, TokenType.Unknown);
        assert.strictEqual(tokens[2].type, TokenType.Unknown);
    });

    it("keeps hash payloads as identifiers in asMSX mode", () => {
        const tokens = new Lexer("#1A #xyz #", true).tokenize();
        assert.strictEqual(tokens.length, 3);
        for (const token of tokens) {
            assert.strictEqual(token.type, TokenType.Identifier);
        }
    });

    it("rejects malformed prefixed numbers as Unknown per prefix", () => {
        const tokens = new Lexer("$xyz %abc 0b12 0xzz").tokenize();
        assert.strictEqual(tokens.length, 4);
        for (const token of tokens) {
            assert.strictEqual(token.type, TokenType.Unknown);
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

    it("advances astral characters by code point", () => {
        // U+1D11E MUSICAL SYMBOL G CLEF is a surrogate pair.
        const lexer = new Lexer("ld a\ud834\udd1eb");
        const tokens = lexer.tokenize();
        const unknown = tokens.filter((token) => token.type === TokenType.Unknown);
        assert.strictEqual(unknown.length, 1, "the surrogate pair must become one token, not two lone surrogates");
        assert.strictEqual(unknown[0].value, "\ud834\udd1e");
        assert.strictEqual(unknown[0].length, 2);
        assert.strictEqual(tokens[3].type, TokenType.Identifier);
        assert.strictEqual(tokens[3].value, "b");
        assert.strictEqual(tokens[3].start, 6);
    });

    it("lexes every multi-char and single-char operator", () => {
        const pairs: Array<[string, TokenType]> = [
            ["<<", TokenType.ShiftLeft],
            [">>", TokenType.ShiftRight],
            ["<=", TokenType.LessEqual],
            [">=", TokenType.GreaterEqual],
            ["==", TokenType.EqualEqual],
            ["!=", TokenType.NotEqual],
            ["<>", TokenType.LessGreater],
            ["&&", TokenType.LogicalAnd],
            ["||", TokenType.LogicalOr]
        ];
        for (const [source, expected] of pairs) {
            const tokens = new Lexer(source).tokenize();
            assert.strictEqual(tokens.length, 1, `${source} must lex as one token`);
            assert.strictEqual(tokens[0].type, expected);
            assert.strictEqual(tokens[0].value, source);
            assert.strictEqual(tokens[0].length, 2);
        }

        const singles: Array<[string, TokenType]> = [
            [":", TokenType.Colon], [",", TokenType.Comma],
            ["+", TokenType.Plus], ["-", TokenType.Minus],
            ["(", TokenType.LParen], [")", TokenType.RParen],
            ["[", TokenType.LBracket], ["]", TokenType.RBracket],
            [".", TokenType.Dot], ["*", TokenType.Asterisk],
            ["/", TokenType.Slash], ["%", TokenType.Percent],
            ["&", TokenType.Ampersand], ["|", TokenType.Pipe],
            ["^", TokenType.Caret], ["~", TokenType.Tilde],
            ["<", TokenType.Less], [">", TokenType.Greater],
            ["=", TokenType.Equals], ["!", TokenType.Exclamation]
        ];
        for (const [source, expected] of singles) {
            const tokens = new Lexer(source).tokenize();
            assert.strictEqual(tokens.length, 1, `${source} must lex as one token`);
            assert.strictEqual(tokens[0].type, expected);
        }

        // An unmatched pair keeps its first character single.
        const mismatch = new Lexer("<)").tokenize();
        assert.strictEqual(mismatch[0].type, TokenType.Less);
        assert.strictEqual(mismatch[1].type, TokenType.RParen);
    });

    it("lexes a large numeric-heavy source without quadratic scans", () => {
        // Every numeric token used to pay an O(remaining source) substring
        // copy; this fixture would blow up quadratically if that regresses.
        const lines: string[] = [];
        for (let i = 0; i < 60000; i++) {
            lines.push(`    ld a, ${i}`);
            lines.push(`    ld hl, $${i.toString(16)}`);
        }
        const source = lines.join("\n");

        const started = performance.now();
        const tokens = new Lexer(source).tokenize();
        const elapsed = performance.now() - started;

        assert.ok(tokens.length > 200000);
        assert.ok(elapsed < 2000, `large fixture must lex linearly, took ${elapsed}ms`);
    });

    it("completes tokenization for empty, whitespace-only, and complex sources", () => {
        assert.deepStrictEqual(new Lexer("").tokenize(), []);
        assert.deepStrictEqual(new Lexer("   \t  ").tokenize(), []);
        const tokens = new Lexer("  nop \n  ret ").tokenize();
        assert.strictEqual(tokens.length, 3);
        assert.strictEqual(tokens[0].value, "nop");
        assert.strictEqual(tokens[1].type, TokenType.Newline);
        assert.strictEqual(tokens[2].value, "ret");
    });
});

