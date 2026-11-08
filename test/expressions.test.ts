import { describe, it } from 'node:test';
import * as assert from 'assert';
import { Lexer, ParseError } from '../src/asm/lexer';
import { ExpressionParser, evaluate, isConstantExpression, tryParseExpression, tryEvaluateExpression } from '../src/asm/expressions';
import { CpuDialect } from '../src/asm/metadata';

describe("Expressions", () => {
    function evalExpr(expr: string, symbols: Record<string, number> = {}, currentLoc: number = 0, dialect: CpuDialect = CpuDialect.EZ80): number {
        const lexer = new Lexer(expr, dialect === CpuDialect.Z80);
        const tokens = lexer.tokenize();
        const parser = new ExpressionParser(tokens, dialect);
        const ast = parser.parse();
        return evaluate(ast, name => symbols[name], currentLoc);
    }

    describe("Numeric formats", () => {
        it("evaluates decimal", () => assert.strictEqual(evalExpr("123"), 123));
        it("evaluates hex with $", () => assert.strictEqual(evalExpr("$1a"), 26));
        it("evaluates hex with 0x", () => assert.strictEqual(evalExpr("0x1A"), 26));
        it("evaluates hex with h", () => assert.strictEqual(evalExpr("1Ah"), 26));
        it("evaluates eZ80 binary forms", () => {
            assert.strictEqual(evalExpr("%1010"), 10);
            assert.strictEqual(evalExpr("1010b"), 10);
        });
        it("evaluates eZ80 hexadecimal and binary prefixes", () => {
            assert.strictEqual(evalExpr("#1a"), 26);
            assert.strictEqual(evalExpr("#Ff"), 255);
            assert.strictEqual(evalExpr("0b1010"), 10);
            assert.strictEqual(evalExpr("0B01"), 1);
            assert.strictEqual(evalExpr("#10 + 0b10"), 18);
        });
        it("evaluates documented asMSX numeric formats", () => {
            const dialect = CpuDialect.Z80;

            assert.strictEqual(evalExpr("077", {}, 0, dialect), 63);
            assert.strictEqual(evalExpr("77o", {}, 0, dialect), 63);
            assert.strictEqual(evalExpr("10O", {}, 0, dialect), 8);
            assert.strictEqual(evalExpr("0x1A", {}, 0, dialect), 26);
            assert.strictEqual(evalExpr("$1a", {}, 0, dialect), 26);
            assert.strictEqual(evalExpr("1Ah", {}, 0, dialect), 26);
            assert.strictEqual(evalExpr("1010b", {}, 0, dialect), 10);
            assert.strictEqual(evalExpr("1.5", {}, 0, dialect), 1.5);
        });

        it("rejects eZ80-only numeric forms in asMSX expressions", () => {
            for (const expression of ["#1a", "%1010", "0b1010", "1.5e2"]) {
                assert.throws(() => evalExpr(expression, {}, 0, CpuDialect.Z80), /(Unexpected token|Undefined symbol)/);
            }
        });

        it("rejects malformed eZ80 hexadecimal and binary prefixes", () => {
            for (const expression of ["#", "#g", "0b", "0b102"]) {
                assert.throws(() => evalExpr(expression), /(Unexpected token|Undefined symbol)/);
            }
        });
    });

    describe("Evaluation errors", () => {
        it("throws token-anchored ParseError for division by zero", () => {
            const lexer = new Lexer("1 / 0");
            const parser = new ExpressionParser(lexer.tokenize());
            const ast = parser.parse();
            assert.throws(
                () => evaluate(ast, () => undefined, 0),
                (error: unknown) => {
                    assert.ok(error instanceof ParseError);
                    assert.strictEqual(error.token?.value, "/");
                    return true;
                }
            );
        });

        it("throws token-anchored ParseError for invalid shift operands", () => {
            const lexer = new Lexer("1 << -1");
            const parser = new ExpressionParser(lexer.tokenize());
            const ast = parser.parse();
            assert.throws(
                () => evaluate(ast, () => undefined, 0),
                (error: unknown) => {
                    assert.ok(error instanceof ParseError);
                    assert.strictEqual(error.token?.value, "<<");
                    return true;
                }
            );
        });

        it("throws token-anchored ParseError for shifts by 32 or more", () => {
            const lexer = new Lexer("1 << 33");
            const parser = new ExpressionParser(lexer.tokenize());
            const ast = parser.parse();
            assert.throws(
                () => evaluate(ast, () => undefined, 0),
                (error: unknown) => {
                    assert.ok(error instanceof ParseError);
                    assert.strictEqual(error.token?.value, "<<");
                    return true;
                }
            );
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

        it("evaluates unary ~ to an unsigned 32-bit value", () => {
            assert.strictEqual(evalExpr("~%00001111"), 4294967280);
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

        it("keeps bitwise results unsigned 32-bit", () => {
            assert.strictEqual(evalExpr("#FFFFFFFF & #FFFFFFFF"), 4294967295);
            assert.strictEqual(evalExpr("~0"), 4294967295);
            assert.strictEqual(evalExpr("#80000000 | 0"), 2147483648);
        });

        it("keeps shift results inside the unsigned 32-bit domain", () => {
            assert.strictEqual(evalExpr("1 << 31"), 2147483648);
            assert.strictEqual(evalExpr("#80000000 >> 31"), 1, "logical right shift of the unsigned value");
        });

        it("divides floats exactly while truncating integral division", () => {
            assert.strictEqual(evalExpr("1.5 / 2", {}, 0, CpuDialect.Z80), 0.75);
            assert.strictEqual(evalExpr("7 / 2", {}, 0, CpuDialect.Z80), 3);
            assert.strictEqual(evalExpr("-5 / 2", {}, 0, CpuDialect.Z80), -2);
            assert.strictEqual(evalExpr("1.5 / 2"), 0.75);
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
            assert.strictEqual(evalExpr("NOT 0"), 4294967295);
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

        it("resolves a user label shadowing the PI constant", () => {
            assert.strictEqual(evalExpr("pi + 1", { pi: 5 }), 6);
            assert.strictEqual(evalExpr("PI", { PI: 3 }), 3);
            assert.strictEqual(evalExpr("PI"), Math.PI);
        });

        it("evaluates built-in math functions and the PI constant case-insensitively when unshadowed", () => {
            assert.strictEqual(evalExpr("pi"), Math.PI);
            assert.strictEqual(evalExpr("Pi"), Math.PI);
            assert.strictEqual(evalExpr("pI"), Math.PI);
            assert.strictEqual(Math.round(evalExpr("sin(pi / 2)")), 1);
            assert.strictEqual(Math.round(evalExpr("Sin(Pi / 2)")), 1);
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

        it("uses C-like precedence in both dialects", () => {
            // asMSX manual 2.3.2: "The precedence order is same as in C/C++."
            for (const dialect of [CpuDialect.Z80, CpuDialect.EZ80]) {
                assert.strictEqual(evalExpr("1 | 2 + 3", {}, 0, dialect), 5, `${dialect}: 1 | (2 + 3)`);
                assert.strictEqual(evalExpr("1 + 2 << 1", {}, 0, dialect), 6, `${dialect}: (1 + 2) << 1`);
                assert.strictEqual(evalExpr("1 & 2 == 2", {}, 0, dialect), 1, `${dialect}: 1 & (2 == 2)`);
                assert.strictEqual(evalExpr("1 || 0 && 0", {}, 0, dialect), -1, `${dialect}: 1 || (0 && 0)`);
                assert.strictEqual(evalExpr("2 + 3 > 4", {}, 0, dialect), -1, `${dialect}: (2 + 3) > 4`);
                assert.strictEqual(evalExpr("1 < 2 ^ 3", {}, 0, dialect), 4294967292, `${dialect}: (1 < 2) ^ 3`);
            }
        });

        it("binds asMSX unary operators tighter than comparisons and arithmetic", () => {
            assert.strictEqual(evalExpr("-a == b", { a: 1, b: -1 }, 0, CpuDialect.Z80), -1);
            assert.strictEqual(evalExpr("-a * b", { a: 2, b: 3 }, 0, CpuDialect.Z80), -6);
            assert.strictEqual(evalExpr("~a + b", { a: 0, b: 5 }, 0, CpuDialect.Z80), 4294967300);
            assert.strictEqual(evalExpr("NOT a && b", { a: 0, b: 1 }, 0, CpuDialect.Z80), -1);
        });

    describe("Symbols", () => {
        it("looks up symbols", () => {
            assert.strictEqual(evalExpr("FOO + 1", { FOO: 10 }), 11);
        });

        it("throws on undefined symbol", () => {
            assert.throws(() => evalExpr("BAR + 1", { FOO: 10 }), /Undefined symbol: BAR/);
        });
    });

    describe("Constant-expression gate", () => {
        function parseAsmsx(expr: string) {
            const lexer = new Lexer(expr, true);
            return new ExpressionParser(lexer.tokenize(), CpuDialect.Z80).parse();
        }

        it("keeps pure arithmetic constant", () => {
            assert.strictEqual(isConstantExpression(parseAsmsx("1 + 2 * 3")), true);
            assert.strictEqual(isConstantExpression(parseAsmsx("sqrt(4)")), true);
        });

        it("rejects .random at any nesting depth", () => {
            // .RANDOM(n) evaluates to Math.random(); the constant gate would
            // otherwise let range validators roll the dice on every publish.
            assert.strictEqual(isConstantExpression(parseAsmsx(".random(8)")), false);
            assert.strictEqual(isConstantExpression(parseAsmsx(".random(8) + 1")), false);
            assert.strictEqual(isConstantExpression(parseAsmsx("1 + .random(8)")), false);
            assert.strictEqual(isConstantExpression(parseAsmsx("sqrt(.random(8))")), false);
        });
    });

    describe("Safely-evaluated expressions", () => {
        it("tryParseExpression returns AST for valid tokens and null for invalid tokens", () => {
            const validTokens = new Lexer("1 + 2").tokenize();
            const invalidTokens = new Lexer("1 + +").tokenize();

            const validAst = tryParseExpression(validTokens, CpuDialect.EZ80);
            assert.ok(validAst !== null);
            assert.strictEqual(validAst?.type, "BinaryOp");

            const invalidAst = tryParseExpression(invalidTokens, CpuDialect.EZ80);
            assert.strictEqual(invalidAst, null);
        });

        it("tryEvaluateExpression evaluates valid expressions and returns undefined on parse or eval failure", () => {
            const validTokens = new Lexer("FOO * 2").tokenize();
            const invalidTokens = new Lexer("1 / 0").tokenize();
            const malformedTokens = new Lexer("1 + * 2").tokenize();

            const res = tryEvaluateExpression(validTokens, CpuDialect.EZ80, (name) => name === "FOO" ? 21 : undefined);
            assert.strictEqual(res, 42);

            const divZero = tryEvaluateExpression(invalidTokens, CpuDialect.EZ80);
            assert.strictEqual(divZero, undefined);

            const malformed = tryEvaluateExpression(malformedTokens, CpuDialect.EZ80);
            assert.strictEqual(malformed, undefined);
        });
    });
});

