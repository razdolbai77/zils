import { describe, it } from 'node:test';
import * as assert from 'assert';
import { 
    isRegister, 
    isConditionCode, 
    isEz80Suffix, 
    getInstructionMetadata,
    CpuDialect,
    BIOS_ROUTINES,
    BIOS_VARS,
    DIRECTIVES
} from '../src/asm/metadata';
import { BIOS_ROUTINE_DESCRIPTIONS } from '../src/asm/bios';
import { BIOS_VARIABLE_DESCRIPTIONS } from '../src/asm/bios-variables';

describe("ASM Metadata", () => {
    describe("Registers", () => {
        it("identifies standard Z80 registers", () => {
            assert.ok(isRegister('a', CpuDialect.Z80));
            assert.ok(isRegister('hl', CpuDialect.Z80));
            assert.ok(isRegister('ix', CpuDialect.Z80));
            assert.ok(!isRegister('mbase', CpuDialect.Z80));
        });

        it("identifies eZ80 specific registers", () => {
            assert.ok(isRegister('mbase', CpuDialect.EZ80));
            assert.ok(isRegister('hl', CpuDialect.EZ80));
        });
    });

    describe("Condition Codes", () => {
        it("identifies condition codes", () => {
            assert.ok(isConditionCode('z'));
            assert.ok(isConditionCode('nz'));
            assert.ok(isConditionCode('c'));
            assert.ok(isConditionCode('nc'));
            assert.ok(isConditionCode('po'));
            assert.ok(isConditionCode('pe'));
            assert.ok(isConditionCode('p'));
            assert.ok(isConditionCode('m'));
            assert.ok(!isConditionCode('a'));
        });
    });

    describe("eZ80 Suffixes", () => {
        it("rejects suffixes in Z80 mode", () => {
            assert.ok(!isEz80Suffix('lil', CpuDialect.Z80));
            assert.ok(!isEz80Suffix('s', CpuDialect.Z80));
        });

        it("identifies suffixes in eZ80 mode", () => {
            assert.ok(isEz80Suffix('lil', CpuDialect.EZ80));
            assert.ok(isEz80Suffix('s', CpuDialect.EZ80));
            assert.ok(isEz80Suffix('is', CpuDialect.EZ80));
            assert.ok(!isEz80Suffix('xyz', CpuDialect.EZ80));
        });
    });

    describe("Instruction Metadata", () => {
        it("identifies common instructions", () => {
            const meta = getInstructionMetadata('ld');
            assert.ok(meta);
            assert.strictEqual(meta?.isDialectSpecific, false);
        });

        it("identifies eZ80 specific instructions", () => {
            const peaMeta = getInstructionMetadata('pea');
            assert.ok(peaMeta);
            assert.strictEqual(peaMeta?.isDialectSpecific, true);
            assert.deepStrictEqual(peaMeta?.supportedDialects, [CpuDialect.EZ80]);
        });
        
        it("returns undefined for unknown instructions", () => {
            assert.strictEqual(getInstructionMetadata('notaninst'), undefined);
        });
    });

    describe("BIOS name sets", () => {
        it("covers exactly the documented BIOS routines", () => {
            assert.deepStrictEqual(
                Array.from(BIOS_ROUTINES),
                Array.from(BIOS_ROUTINE_DESCRIPTIONS.keys()),
                "BIOS_ROUTINES must contain exactly the routine description keys"
            );
        });

        it("covers exactly the documented BIOS variables", () => {
            assert.deepStrictEqual(
                Array.from(BIOS_VARS),
                Array.from(BIOS_VARIABLE_DESCRIPTIONS.keys()),
                "BIOS_VARS must contain exactly the variable description keys"
            );
        });
    });

    describe("Column-0 directives", () => {
        it("marks exactly the structural directives as allowed at column 0", () => {
            const allowed = Array.from(DIRECTIVES.entries())
                .filter(([, meta]) => meta.allowedColumn0)
                .map(([name]) => name)
                .sort();
            assert.deepStrictEqual(allowed, [
                "else", "endif", "endm", "endmacro",
                "endrelocate", "if", "macro", "relocate"
            ]);
        });
    });
});

