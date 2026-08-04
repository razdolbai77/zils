import { describe, it } from "node:test";
import assert from "node:assert";
import { validateInstructionOperands } from "../src/asm/instruction-operands";
import { Lexer } from "../src/asm/lexer";
import { CpuDialect } from "../src/asm/metadata";

describe("Instruction operand validation", () => {
    it("matches index offsets and reports specific unmatched operands", () => {
        const meta = { signature: "LD r,(IX+d)|LD r,(IY+d)" };

        const matchingOperands = [new Lexer("a").tokenize(), new Lexer("(ix+5)").tokenize()];
        const nonMatchingOperands = [new Lexer("a").tokenize(), new Lexer("(de)").tokenize()];

        assert.deepEqual(
            validateInstructionOperands(matchingOperands, "ld", meta, CpuDialect.EZ80, false),
            { error: null, sigOps: ["r", "(IX+d)"] }
        );
        assert.deepEqual(
            validateInstructionOperands(nonMatchingOperands, "ld", meta, CpuDialect.EZ80, false),
            { error: "Operand 2 of 'ld' must be (IX+d) or (IY+d)", errorIndex: 1, sigOps: null }
        );
    });
});
