import { describe, it } from 'node:test';
import * as assert from 'assert';
import { Lexer } from '../src/asm/lexer';
import { ExpressionParser, evaluate } from '../src/asm/expressions';

describe("Expressions", () => {
    function evalExpr(expr: string, symbols: Record<string, number> = {}, currentLoc: number = 0): number {
        const lexer = new Lexer(expr);
        const tokens = lexer.tokenize();
        const parser = new ExpressionParser(tokens);
        const ast = parser.parse();
        return evaluate(ast, name => symbols[name], currentLoc);
    }

    describe("Numeric formats", () => {
        it("evaluates decimal", () => assert.strictEqual(evalExpr("123"), 123));
        it("evaluates hex with $", () => assert.strictEqual(evalExpr("$1a"), 26));
        it("evaluates hex with 0x", () => assert.strictEqual(evalExpr("0x1A"), 26));
        it("evaluates hex with h", () => assert.strictEqual(evalExpr("1Ah"), 26));
        it("evaluates binary with %", () => assert.strictEqual(evalExpr("%1010"), 10));
        it("evaluates binary with b", () => assert.strictEqual(evalExpr("1010b"), 10));
        it("evaluates eZ80 hexadecimal and binary prefixes", () => {
            assert.strictEqual(evalExpr("#1a"), 26);
            assert.strictEqual(evalExpr("#Ff"), 255);
            assert.strictEqual(evalExpr("0b1010"), 10);
            assert.strictEqual(evalExpr("0B01"), 1);
            assert.strictEqual(evalExpr("#10 + 0b10"), 18);
        });
        it("evaluates asMSX octal integers", () => {
            assert.strictEqual(evalExpr("077"), 63);
            assert.strictEqual(evalExpr("77o"), 63);
            assert.strictEqual(evalExpr("10O"), 8);
        });

        it("evaluates asMSX decimal floating-point tokens", () => {
            assert.strictEqual(evalExpr("1.5"), 1.5);
            assert.strictEqual(evalExpr("1.5e2"), 150);
            assert.strictEqual(evalExpr("1.5e-2"), 0.015);
            assert.strictEqual(evalExpr("100.0E-1"), 10);
        });

        it("rejects malformed eZ80 hexadecimal and binary prefixes", () => {
            for (const expression of ["#", "#g", "0b", "0b102"]) {
                assert.throws(() => evalExpr(expression), /Unexpected token/);
            }
        });
    });

    describe("Character literals", () => {
        it("evaluates supported escape sequences", () => {
            assert.strictEqual(evalExpr(String.raw`'\n'`), 0x0a);
            assert.strictEqual(evalExpr(String.raw`'\\'`), 0x5c);
        });
    });

    describe("Current location", () => {
        it("evaluates $ as current location", () => {
            assert.strictEqual(evalExpr("$", {}, 0x4000), 0x4000);
            assert.strictEqual(evalExpr("$ + 5", {}, 0x4000), 0x4005);
        });
    });

    describe("Operators", () => {
        it("evaluates unary + and -", () => {
            assert.strictEqual(evalExpr("-5"), -5);
            assert.strictEqual(evalExpr("+5"), 5);
            assert.strictEqual(evalExpr("-(--5)"), -5);
        });

        it("evaluates unary ~", () => {
            assert.strictEqual(evalExpr("~%00001111"), ~15);
        });

        it("evaluates basic binary operators", () => {
            assert.strictEqual(evalExpr("10 + 5"), 15);
            assert.strictEqual(evalExpr("10 - 5"), 5);
            assert.strictEqual(evalExpr("10 * 5"), 50);
            assert.strictEqual(evalExpr("10 / 5"), 2);
            assert.strictEqual(evalExpr("10 % 3"), 1);
        });

        it("rejects division and modulo by zero and truncates division toward zero", () => {
            assert.throws(() => evalExpr("5 / 0"), /Division by zero/);
            assert.throws(() => evalExpr("5 % 0"), /Modulo by zero/);
            assert.strictEqual(evalExpr("-5 / 2"), -2);
        });

        it("evaluates bitwise operators", () => {
            assert.strictEqual(evalExpr("1 | 2"), 3);
            assert.strictEqual(evalExpr("1 & 3"), 1);
            assert.strictEqual(evalExpr("1 ^ 3"), 2);
            assert.strictEqual(evalExpr("1 << 2"), 4);
            assert.strictEqual(evalExpr("8 >> 1"), 4);
        });
    });
        it("evaluates logical operators and comparisons", () => {
            assert.strictEqual(evalExpr("1 == 1"), -1);
            assert.strictEqual(evalExpr("1 = 1"), -1);
            assert.strictEqual(evalExpr("1 != 2"), -1);
            assert.strictEqual(evalExpr("1 <> 2"), -1);
            assert.strictEqual(evalExpr("1 < 2"), -1);
            assert.strictEqual(evalExpr("2 > 1"), -1);
            assert.strictEqual(evalExpr("1 <= 1"), -1);
            assert.strictEqual(evalExpr("2 >= 2"), -1);
            
            assert.strictEqual(evalExpr("1 == 2"), 0);
            assert.strictEqual(evalExpr("1 > 2"), 0);
            
            assert.strictEqual(evalExpr("-1 && -1"), -1);
            assert.strictEqual(evalExpr("1 || 0"), -1);
            assert.strictEqual(evalExpr("!0"), -1);
            assert.strictEqual(evalExpr("!1"), 0);
        });

        it("evaluates named operators", () => {
            assert.strictEqual(evalExpr("1 AND 3"), 1);
            assert.strictEqual(evalExpr("1 OR 2"), 3);
            assert.strictEqual(evalExpr("1 XOR 3"), 2);
            assert.strictEqual(evalExpr("NOT 0"), -1);
            assert.strictEqual(evalExpr("5 MOD 2"), 1);
            assert.strictEqual(evalExpr("1 SHL 2"), 4);
            assert.strictEqual(evalExpr("4 SHR 1"), 2);
            assert.strictEqual(evalExpr("1 EQ 1"), -1);
            assert.strictEqual(evalExpr("1 NE 2"), -1);
            assert.strictEqual(evalExpr("1 LT 2"), -1);
            assert.strictEqual(evalExpr("1 LE 1"), -1);
            assert.strictEqual(evalExpr("2 GT 1"), -1);
            assert.strictEqual(evalExpr("2 GE 2"), -1);
        });

        it("evaluates math functions and constants", () => {
            assert.strictEqual(Math.round(evalExpr("SIN(PI / 2)")), 1);
            assert.strictEqual(Math.round(evalExpr("COS(PI)")), -1);
            assert.strictEqual(Math.round(evalExpr("TAN(0)")), 0);
            assert.strictEqual(Math.round(evalExpr("ASIN(1) * 2 / PI")), 1);
            assert.strictEqual(Math.round(evalExpr("ACOS(-1) / PI")), 1);
            assert.strictEqual(Math.round(evalExpr("ATAN(0)")), 0);
            assert.strictEqual(evalExpr("LOG(1)"), 0);
            assert.strictEqual(evalExpr("LOG10(10)"), 1);
            assert.strictEqual(evalExpr("EXP(0)"), 1);
            assert.strictEqual(evalExpr("POW(2, 3)"), 8);
            assert.strictEqual(evalExpr("SQRT(9)"), 3);
            assert.strictEqual(evalExpr("INT(3.7)"), 3);
            assert.strictEqual(evalExpr("ABS(-5)"), 5);
            assert.strictEqual(evalExpr("SGN(-5)"), -1);
            assert.strictEqual(evalExpr("SGN(0)"), 0);
            assert.strictEqual(evalExpr("SGN(5)"), 1);
            assert.strictEqual(evalExpr("MAX(1, 2)"), 2);
            assert.strictEqual(evalExpr("MIN(1, 2)"), 1);
        });

        it("rejects invalid arity in math functions", () => {
            assert.throws(() => evalExpr("SIN(1, 2)"), /arity/);
            assert.throws(() => evalExpr("POW(2)"), /arity/);
        });

    describe("Precedence and Parentheses", () => {
        it("respects operator precedence", () => {
            assert.strictEqual(evalExpr("1 + 2 * 3"), 7);
            assert.strictEqual(evalExpr("2 * 3 + 1"), 7);
            assert.strictEqual(evalExpr("10 - 4 / 2"), 8);
        });

        it("respects parentheses", () => {
            assert.strictEqual(evalExpr("(1 + 2) * 3"), 9);
            assert.strictEqual(evalExpr("2 * (3 + 1)"), 8);
            assert.strictEqual(evalExpr("-(5 + 5)"), -10);
        });
    });

    describe("Symbols", () => {
        it("looks up symbols", () => {
            assert.strictEqual(evalExpr("FOO + 1", { FOO: 10 }), 11);
        });

        it("throws on undefined symbol", () => {
            assert.throws(() => evalExpr("BAR + 1", { FOO: 10 }), /Undefined symbol: BAR/);
        });
    });
});

