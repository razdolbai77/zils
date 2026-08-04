import { describe, it } from 'node:test';
import * as assert from 'assert';
import { isValidNumberLiteral, parseNumberValue } from '../src/asm/numbers';

describe("Numeric literals", () => {
    it("accepts every documented format in eZ80 mode", () => {
        const valid = ['$1F', '#1f', '0x1F', '10h', '0B101', '%101', '101b', '77o', '077', '0', '255', '1.25', '1.5e3', '1.5E-3'];
        for (const value of valid) {
            assert.ok(isValidNumberLiteral(value, false), `${value} must be valid in eZ80 mode`);
        }
    });

    it("rejects eZ80-only formats in asMSX mode", () => {
        for (const value of ['#1F', '0b101', '%101', '1.5e3']) {
            assert.ok(!isValidNumberLiteral(value, true), `${value} must be invalid in asMSX mode`);
        }
        for (const value of ['$1F', '0x1F', '10h', '101b', '77o', '077', '255', '1.25']) {
            assert.ok(isValidNumberLiteral(value, true), `${value} must stay valid in asMSX mode`);
        }
    });

    it("rejects malformed literals", () => {
        for (const value of ['08', '09', '1e', '$', '%', '1.5e', '0x', '0b', '10q']) {
            assert.ok(!isValidNumberLiteral(value, false), `${value} must be invalid`);
        }
    });

    it("parses every format to its documented value", () => {
        const cases: Array<[string, number]> = [
            ['$1F', 31], ['#1f', 31], ['0x1F', 31], ['10h', 16], ['0B101', 5],
            ['%101', 5], ['101b', 5], ['77o', 63], ['077', 63], ['0', 0],
            ['255', 255], ['1.25', 1.25], ['1.5e3', 1500]
        ];
        for (const [value, expected] of cases) {
            assert.strictEqual(parseNumberValue(value), expected, value);
        }
    });

    it("throws for unparseable literals", () => {
        for (const value of ['1e', '08', '1.5e', '$', '10q']) {
            assert.throws(() => parseNumberValue(value), /Unparseable numeric literal/, value);
        }
    });
});
