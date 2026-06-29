export enum CpuDialect {
    Z80 = 'z80',
    EZ80 = 'ez80'
}

export interface InstructionMetadata {
    mnemonic: string;
    isDialectSpecific: boolean;
    supportedDialects: CpuDialect[];
}

export const COMMON_REGISTERS = new Set([
    'a', 'b', 'c', 'd', 'e', 'h', 'l',
    'af', 'bc', 'de', 'hl', 'sp', 'ix', 'iy',
    'i', 'r', 'ixh', 'ixl', 'iyh', 'iyl', 'af\''
]);

export const EZ80_REGISTERS = new Set([
    ...Array.from(COMMON_REGISTERS),
    'mbase'
]);

export const CONDITION_CODES = new Set([
    'z', 'nz', 'c', 'nc', 'po', 'pe', 'p', 'm'
]);

export const EZ80_SUFFIXES = new Set([
    's', 'l', 'is', 'il', 'sis', 'sil', 'lis', 'lil'
]);

export const INSTRUCTIONS = new Map<string, InstructionMetadata>();

function addInst(mnemonic: string, dialects?: CpuDialect[]) {
    const supportedDialects = dialects || [CpuDialect.Z80, CpuDialect.EZ80];
    const isDialectSpecific = supportedDialects.length < 2;
    INSTRUCTIONS.set(mnemonic, {
        mnemonic,
        isDialectSpecific,
        supportedDialects
    });
}

// Common instructions (subset for now, can be expanded)
const commonMnemonics = [
    'adc', 'add', 'and', 'bit', 'call', 'ccf', 'cp', 'cpd', 'cpdr', 'cpi', 'cpir',
    'cpl', 'daa', 'dec', 'di', 'djnz', 'ei', 'ex', 'exx', 'halt', 'im', 'in',
    'inc', 'ind', 'indr', 'ini', 'inir', 'jp', 'jr', 'ld', 'ldd', 'lddr', 'ldi', 'ldir',
    'neg', 'nop', 'or', 'otdr', 'otir', 'out', 'outd', 'outi', 'pop', 'push', 'res',
    'ret', 'reti', 'retn', 'rl', 'rla', 'rlc', 'rlca', 'rld', 'rr', 'rra', 'rrc', 'rrca',
    'rrd', 'rst', 'sbc', 'scf', 'set', 'sla', 'sra', 'srl', 'sub', 'xor'
];

commonMnemonics.forEach(m => addInst(m));

// eZ80 specific instructions
const ez80Mnemonics = [
    'in0', 'out0', 'lea', 'pea', 'rsmix', 'stmix', 'slp'
];

ez80Mnemonics.forEach(m => addInst(m, [CpuDialect.EZ80]));

export function isRegister(name: string, dialect: CpuDialect): boolean {
    const lower = name.toLowerCase();
    if (dialect === CpuDialect.EZ80) {
        return EZ80_REGISTERS.has(lower);
    }
    return COMMON_REGISTERS.has(lower);
}

export function isConditionCode(code: string): boolean {
    return CONDITION_CODES.has(code.toLowerCase());
}

export function isEz80Suffix(suffix: string, dialect: CpuDialect): boolean {
    if (dialect !== CpuDialect.EZ80) {
        return false;
    }
    return EZ80_SUFFIXES.has(suffix.toLowerCase());
}

export function getInstructionMetadata(mnemonic: string): InstructionMetadata | undefined {
    return INSTRUCTIONS.get(mnemonic.toLowerCase());
}
