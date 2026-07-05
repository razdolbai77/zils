export enum CpuDialect {
    Z80 = 'z80',
    EZ80 = 'ez80'
}

export interface InstructionMetadata {
    mnemonic: string;
    isDialectSpecific: boolean;
    supportedDialects: CpuDialect[];
    description: string;
    signature: string;
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

export interface SuffixMetadata {
    suffix: string;
    description: string;
}

export const EZ80_SUFFIXES = new Map<string, SuffixMetadata>([
    ['s', { suffix: 's', description: 'Short (16-bit) mode' }],
    ['l', { suffix: 'l', description: 'Long (24-bit) mode' }],
    ['is', { suffix: 'is', description: 'Interrupt Short mode' }],
    ['il', { suffix: 'il', description: 'Interrupt Long mode' }],
    ['sis', { suffix: 'sis', description: 'Short Index, Short Memory (16-bit index, 16-bit memory)' }],
    ['sil', { suffix: 'sil', description: 'Short Index, Long Memory' }],
    ['lis', { suffix: 'lis', description: 'Long Index, Short Memory' }],
    ['lil', { suffix: 'lil', description: 'Long Index, Long Memory' }]
]);

export interface DirectiveMetadata {
    name: string;
    description: string;
    signature: string;
}

export const DIRECTIVES = new Map<string, DirectiveMetadata>([
    ['equ', { name: 'equ', description: 'Equate - defines a symbol with a constant value.', signature: '<label> equ <expr>' }],
    ['db', { name: 'db', description: 'Define Byte - allocates and initializes one or more bytes of memory.', signature: 'db <expr> [, <expr>...]' }],
    ['defb', { name: 'defb', description: 'Define Byte - allocates and initializes one or more bytes of memory.', signature: 'defb <expr> [, <expr>...]' }],
    ['dw', { name: 'dw', description: 'Define Word - allocates and initializes one or more words (16-bit) of memory.', signature: 'dw <expr> [, <expr>...]' }],
    ['defw', { name: 'defw', description: 'Define Word - allocates and initializes one or more words (16-bit) of memory.', signature: 'defw <expr> [, <expr>...]' }],
    ['dl', { name: 'dl', description: 'Define Long - allocates and initializes one or more longs (24-bit) of memory.', signature: 'dl <expr> [, <expr>...]' }],
    ['defl', { name: 'defl', description: 'Define Long - allocates and initializes one or more longs (24-bit) of memory.', signature: 'defl <expr> [, <expr>...]' }],
    ['ds', { name: 'ds', description: 'Define Space - allocates a block of memory, optionally initializing it.', signature: 'ds <count> [, <value>]' }],
    ['defs', { name: 'defs', description: 'Define Space - allocates a block of memory, optionally initializing it.', signature: 'defs <count> [, <value>]' }],
    ['org', { name: 'org', description: 'Origin - sets the program counter to a specific address.', signature: 'org <address>' }],
    ['align', { name: 'align', description: 'Align - aligns the program counter to a specified boundary.', signature: 'align <boundary> [, <fill>]' }],
    ['assume', { name: 'assume', description: 'Assume - tells the assembler to assume a specific ADL mode.', signature: 'assume adl = <0|1>' }],
    ['include', { name: 'include', description: 'Include - includes another source file.', signature: 'include "<filename>"' }],
    ['macro', { name: 'macro', description: 'Macro - defines a macro.', signature: '<name> macro [<param1> [, <param2>...]]' }],
    ['endm', { name: 'endm', description: 'End Macro - ends a macro definition.', signature: 'endm' }],
    
    // eZ80 specific directives
    ['maclib', { name: 'maclib', description: 'Macro Library - includes a macro library file.', signature: 'maclib "<filename>"' }],
    ['incbin', { name: 'incbin', description: 'Include Binary - includes a raw binary file.', signature: 'incbin "<filename>"' }],
    ['dl24', { name: 'dl24', description: 'Define Long 24-bit - allocates and initializes 24-bit values.', signature: 'dl24 <expr> [, <expr>...]' }],
    ['ds24', { name: 'ds24', description: 'Define Space 24-bit - allocates 24-bit space.', signature: 'ds24 <count> [, <value>]' }],
    
    // asMSX specific directives
    ['megas', { name: 'megas', description: 'MegaROM Size - sets the MegaROM size/mapper type.', signature: 'megas <KONAMI | KONAMI_SCC | ASCII8 | ASCII16>' }],
    ['bios', { name: 'bios', description: 'BIOS call - specific to asMSX. Defines all standard MSX BIOS routines as labels.', signature: 'bios' }],
    ['biosvars', { name: 'biosvars', description: 'BIOS variables - specific to asMSX. Defines all standard MSX system variables as labels.', signature: 'biosvars' }],
    ['fpos', { name: 'fpos', description: 'File Position - sets the output file position.', signature: 'fpos <offset>' }],
    ['rb', { name: 'rb', description: 'Reserve Byte - reserves bytes in memory without emitting data.', signature: '<label> rb <count>' }],
    ['rw', { name: 'rw', description: 'Reserve Word - reserves words (16-bit) in memory without emitting data.', signature: '<label> rw <count>' }],
    ['rl', { name: 'rl', description: 'Reserve Long - reserves longs (24/32-bit) in memory without emitting data.', signature: '<label> rl <count>' }],
    ['rs', { name: 'rs', description: 'Reserve Space - reserves space in memory without emitting data.', signature: '<label> rs <count>' }],
    ['insert', { name: 'insert', description: 'Insert - inserts a binary file (same as incbin).', signature: 'insert "<filename>"' }],
    ['phase', { name: 'phase', description: 'Phase - defines a block of code relocated to a different address.', signature: 'phase <address>' }],
    ['dephase', { name: 'dephase', description: 'Dephase - ends a phase block.', signature: 'dephase' }]
]);

export const INSTRUCTIONS = new Map<string, InstructionMetadata>();

function addInst(mnemonic: string, description: string, signature: string, dialects?: CpuDialect[]) {
    const supportedDialects = dialects || [CpuDialect.Z80, CpuDialect.EZ80];
    const isDialectSpecific = supportedDialects.length < 2;
    INSTRUCTIONS.set(mnemonic, {
        mnemonic,
        isDialectSpecific,
        supportedDialects,
        description,
        signature
    });
}

// Common Z80 instructions
addInst('adc', 'Add with Carry', 'ADC A, s | ADC HL, ss');
addInst('add', 'Add without Carry', 'ADD A, s | ADD HL, ss | ADD IX, pp | ADD IY, rr');
addInst('and', 'Logical AND', 'AND s');
addInst('bit', 'Test Bit', 'BIT b, m');
addInst('call', 'Call Subroutine', 'CALL cc, nn | CALL nn');
addInst('ccf', 'Complement Carry Flag', 'CCF');
addInst('cp', 'Compare with Accumulator', 'CP s');
addInst('cpd', 'Compare and Decrement', 'CPD');
addInst('cpdr', 'Compare, Decrement and Repeat', 'CPDR');
addInst('cpi', 'Compare and Increment', 'CPI');
addInst('cpir', 'Compare, Increment and Repeat', 'CPIR');
addInst('cpl', 'Complement Accumulator', 'CPL');
addInst('daa', 'Decimal Adjust Accumulator', 'DAA');
addInst('dec', 'Decrement', 'DEC m | DEC ss | DEC IX | DEC IY');
addInst('di', 'Disable Interrupts', 'DI');
addInst('djnz', 'Decrement Jump Non-Zero', 'DJNZ e');
addInst('ei', 'Enable Interrupts', 'EI');
addInst('ex', 'Exchange Registers', 'EX DE, HL | EX AF, AF\' | EX (SP), HL | EX (SP), IX | EX (SP), IY');
addInst('exx', 'Exchange Alternate Registers', 'EXX');
addInst('halt', 'Halt CPU', 'HALT');
addInst('im', 'Interrupt Mode', 'IM 0|1|2');
addInst('in', 'Input from Port', 'IN A, (n) | IN r, (C)');
addInst('inc', 'Increment', 'INC m | INC ss | INC IX | INC IY');
addInst('ind', 'Input and Decrement', 'IND');
addInst('indr', 'Input, Decrement and Repeat', 'INDR');
addInst('ini', 'Input and Increment', 'INI');
addInst('inir', 'Input, Increment and Repeat', 'INIR');
addInst('jp', 'Jump', 'JP cc, nn | JP nn | JP (HL) | JP (IX) | JP (IY)');
addInst('jr', 'Jump Relative', 'JR cc, e | JR e');
addInst('ld', 'Load', 'LD r, r\' | LD r, n | LD r, (HL) | LD (HL), r/n | LD r, (IX/IY+d) | LD (IX/IY+d), r/n | LD A, (BC/DE/nn) | LD (BC/DE/nn), A | LD rr, nn | LD rr, (nn) | LD (nn), rr | LD SP, HL/IX/IY');
addInst('ldd', 'Load and Decrement', 'LDD');
addInst('lddr', 'Load, Decrement and Repeat', 'LDDR');
addInst('ldi', 'Load and Increment', 'LDI');
addInst('ldir', 'Load, Increment and Repeat', 'LDIR');
addInst('neg', 'Negate Accumulator', 'NEG');
addInst('nop', 'No Operation', 'NOP');
addInst('or', 'Logical OR', 'OR s');
addInst('otdr', 'Output, Decrement and Repeat', 'OTDR');
addInst('otir', 'Output, Increment and Repeat', 'OTIR');
addInst('out', 'Output to Port', 'OUT (n), A | OUT (C), r');
addInst('outd', 'Output and Decrement', 'OUTD');
addInst('outi', 'Output and Increment', 'OUTI');
addInst('pop', 'Pop from Stack', 'POP qq');
addInst('push', 'Push to Stack', 'PUSH qq');
addInst('res', 'Reset Bit', 'RES b, m');
addInst('ret', 'Return from Subroutine', 'RET | RET cc');
addInst('reti', 'Return from Interrupt', 'RETI');
addInst('retn', 'Return from Non-Maskable Interrupt', 'RETN');
addInst('rl', 'Rotate Left through Carry', 'RL m');
addInst('rla', 'Rotate Accumulator Left through Carry', 'RLA');
addInst('rlc', 'Rotate Left Circular', 'RLC m');
addInst('rlca', 'Rotate Accumulator Left Circular', 'RLCA');
addInst('rld', 'Rotate Left Decimal', 'RLD');
addInst('rr', 'Rotate Right through Carry', 'RR m');
addInst('rra', 'Rotate Accumulator Right through Carry', 'RRA');
addInst('rrc', 'Rotate Right Circular', 'RRC m');
addInst('rrca', 'Rotate Accumulator Right Circular', 'RRCA');
addInst('rrd', 'Rotate Right Decimal', 'RRD');
addInst('rst', 'Restart', 'RST p');
addInst('sbc', 'Subtract with Carry', 'SBC A, s | SBC HL, ss');
addInst('scf', 'Set Carry Flag', 'SCF');
addInst('set', 'Set Bit', 'SET b, m');
addInst('sla', 'Shift Left Arithmetic', 'SLA m');
addInst('sra', 'Shift Right Arithmetic', 'SRA m');
addInst('srl', 'Shift Right Logical', 'SRL m');
addInst('sub', 'Subtract without Carry', 'SUB s');
addInst('xor', 'Logical Exclusive OR', 'XOR s');

// eZ80 specific instructions
addInst('in0', 'Input from Port (page 0)', 'IN0 r, (n)', [CpuDialect.EZ80]);
addInst('out0', 'Output to Port (page 0)', 'OUT0 (n), r', [CpuDialect.EZ80]);
addInst('lea', 'Load Effective Address', 'LEA rr, IX+d | LEA rr, IY+d', [CpuDialect.EZ80]);
addInst('pea', 'Push Effective Address', 'PEA IX+d | PEA IY+d', [CpuDialect.EZ80]);
addInst('rsmix', 'Reset Mixed Memory Mode Flag', 'RSMIX', [CpuDialect.EZ80]);
addInst('stmix', 'Set Mixed Memory Mode Flag', 'STMIX', [CpuDialect.EZ80]);
addInst('slp', 'Sleep', 'SLP', [CpuDialect.EZ80]);
addInst('mlt', 'Multiply', 'MLT rr', [CpuDialect.EZ80]);
addInst('tst', 'Test Accumulator', 'TST A, s', [CpuDialect.EZ80]);
addInst('tstio', 'Test I/O Port', 'TSTIO n', [CpuDialect.EZ80]);
addInst('ini2', 'Input and Increment 2', 'INI2', [CpuDialect.EZ80]);
addInst('ind2', 'Input and Decrement 2', 'IND2', [CpuDialect.EZ80]);
addInst('inir2', 'Input, Increment and Repeat 2', 'INIR2', [CpuDialect.EZ80]);
addInst('indr2', 'Input, Decrement and Repeat 2', 'INDR2', [CpuDialect.EZ80]);
addInst('outi2', 'Output and Increment 2', 'OUTI2', [CpuDialect.EZ80]);
addInst('outd2', 'Output and Decrement 2', 'OUTD2', [CpuDialect.EZ80]);
addInst('otir2', 'Output, Increment and Repeat 2', 'OTIR2', [CpuDialect.EZ80]);
addInst('otdr2', 'Output, Decrement and Repeat 2', 'OTDR2', [CpuDialect.EZ80]);

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

export function getEz80SuffixMetadata(suffix: string): SuffixMetadata | undefined {
    return EZ80_SUFFIXES.get(suffix.toLowerCase());
}

export function getInstructionMetadata(mnemonic: string): InstructionMetadata | undefined {
    return INSTRUCTIONS.get(mnemonic.toLowerCase());
}

export function getDirectiveMetadata(name: string): DirectiveMetadata | undefined {
    const lower = name.toLowerCase();
    if (lower.startsWith('.')) {
        return DIRECTIVES.get(lower.substring(1));
    }
    return DIRECTIVES.get(lower);
}

export const BIOS_ROUTINES = new Set([
    'CHKRAM', 'SYNCHR', 'RDSLT', 'CHRGTR', 'WRSLT', 'OUTDO', 'CALSLT', 'DCOMPR', 'ENASLT', 'GETYPR', 'CALLF', 'KEYINT', 'INITIO', 'INIFNK', 'DISSCR', 'ENASCR', 'WRTVDP', 'RDVRM', 'WRTVRM', 'SETRD', 'SETWRT', 'FILVRM', 'LDIRMV', 'LDIRVM', 'CHGMOD', 'CHGCLR', 'NMI', 'CLRSPR', 'INITXT', 'INIT32', 'INIGRP', 'INIMLT', 'SETTXT', 'SETT32', 'SETGRP', 'SETMLT', 'CALPAT', 'CALATR', 'GSPSIZ', 'GRPPRT', 'GICINI', 'WRTPSG', 'RDPSG', 'STRTMS', 'CHSNS', 'CHGET', 'CHPUT', 'LPTOUT', 'LPTSTT', 'CNVCHR', 'PINLIN', 'INLIN', 'QINLIN', 'BREAKX', 'ISCNTC', 'CKCNTC', 'BEEP', 'CLS', 'POSIT', 'FNKSB', 'ERAFNK', 'DSPFNK', 'TOTEXT', 'GTSTCK', 'GTTRIG', 'GTPAD', 'GTPDL', 'TAPION', 'TAPIN', 'TAPIOF', 'TAPOON', 'TAPOUT', 'TAPOOF', 'STMOTR', 'LFTQ', 'PUTQ', 'RIGHTC', 'LEFTC', 'UPC', 'TUPC', 'DOWNC', 'TDOWNC', 'SCALXY', 'MAPXYC', 'FETCHC', 'STOREC', 'SETATR', 'READC', 'SETC', 'NSETCX', 'GTASPC', 'PNTINI', 'SCANR', 'SCANL', 'CHGCAP', 'CHGSND', 'RSLREG', 'WSLREG', 'RDVDP', 'SNSMAT', 'PHYDIO', 'FORMAT', 'ISFLIO', 'OUTDLP', 'GETVCP', 'GETVC2', 'KILBUF', 'CALBAS', 'SUBROM', 'EXTROM', 'CHKSLZ', 'CHKNEW', 'EOL', 'BIGFIL', 'NSETRD', 'NSTWRT', 'NRDVRM', 'NWRVRM', 'RDBTST', 'WRBTST', 'CHGCPU', 'GETCPU', 'PCMPLY', 'PCMREC'
]);

export const BIOS_VARS = new Set([
    'CGTABL', 'VDP_DR', 'VDP_DW', 'MSXID1', 'MSXID2', 'MSXID3', 'RDPRIM',
    'WRPRIM', 'CLPRIM', 'LINL40', 'LINL32', 'LINLEN', 'CRTCNT', 'CLMLST',
    'TXTNAM', 'TXTCOL', 'TXTCGP', 'TXTATR', 'TXTPAT', 'T32NAM', 'T32COL',
    'T32CGP', 'T32ATR', 'T32PAT', 'GRPNAM', 'GRPCOL', 'GRPCGP', 'GRPATR',
    'GRPPAT', 'MLTNAM', 'MLTCOL', 'MLTCGP', 'MLTATR', 'MLTPAT', 'CLIKSW',
    'CSRY', 'CSRX', 'CNSDFG', 'RG0SAV', 'RG1SAV', 'RG2SAV', 'RG3SAV',
    'RG4SAV', 'RG5SAV', 'RG6SAV', 'RG7SAV', 'STATFL', 'TRGFLG', 'FORCLR',
    'BAKCLR', 'BDRCLR', 'MAXUPD', 'MINUPD', 'ATRBYT', 'QUEUES', 'FRCNEW',
    'SCNCNT', 'REPCNT', 'PUTPNT', 'GETPNT', 'CS120', 'CS240', 'LOW', 'HIGH',
    'HEADER', 'ASPCT1', 'ASPCT2', 'ENDPRG', 'ERRFLG', 'LPTPOS', 'PRTFLG',
    'NTMSXP', 'RAWPRT', 'VLZADR', 'VLZDAT', 'CURLIN', 'EXBRSA', 'PRSCNT',
    'SAVSP', 'VOICEN', 'SAVVOL', 'MCLLEN', 'MCLPTR', 'QUEUEN', 'MUSICF',
    'PLYCNT', 'VCBA', 'VCBB', 'VCBC', 'ENSTOP', 'BASROM', 'LINTTB', 'FSTPOS',
    'CODSAV', 'FNKSWI', 'FNKFLG', 'ONGSBF', 'CLIKFL', 'OLDKEY', 'NEWKEY',
    'KEYBUF', 'BUFEND', 'LINWRK', 'PATWRK', 'BOTTOM', 'HIMEM', 'TRPTBL',
    'RTYCNT', 'INTFLG', 'PADY', 'PADX', 'JIFFY', 'INTVAL', 'INTCNT',
    'LOWLIM', 'WINWID', 'GRPHED', 'ESCCNT', 'INSFLG', 'CSRSW', 'CSTYLE',
    'CAPST', 'KANAST', 'KANAMD', 'FLBMEM', 'SCRMOD', 'OLDSCR', 'CASPRV',
    'BRDATR', 'GXPOS', 'GYPOS', 'GRPACX', 'GRPACY', 'DRWFLG', 'DRWSCL',
    'DRWANG', 'RUNBNF', 'SAVENT', 'EXPTBL', 'SLTTBL', 'SLTATR', 'SLTWRK',
    'PROCNM', 'DEVICE'
]);
