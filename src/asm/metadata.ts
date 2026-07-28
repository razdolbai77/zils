export const MAX_ADDR_Z80 = 65535;
export const MAX_ADDR_EZ80 = 16777215;

export enum CpuDialect {
    Z80 = 'z80',
    EZ80 = 'ez80'
}

export enum CpuTarget {
    Z80 = 'z80',
    Z180 = 'z180',
    EZ80 = 'ez80'
}

export interface InstructionMetadata {
    mnemonic: string;
    isDialectSpecific: boolean;
    supportedDialects: CpuDialect[];
    supportedCpus: CpuTarget[];
    description: string;
    signature: string;
    z80OnlyRegisters: readonly string[];
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

const ALL_CONDITION_CODES = ['z', 'nz', 'c', 'nc', 'po', 'pe', 'p', 'm'] as const;

export const CONDITION_CODES = new Set<string>(ALL_CONDITION_CODES);

export interface ConditionalInstructionMetadata {
    conditionCodes: readonly string[];
    requiresTargetOperand: boolean;
}

export const CONDITIONAL_INSTRUCTIONS: Record<string, ConditionalInstructionMetadata> = {
    call: { conditionCodes: ALL_CONDITION_CODES, requiresTargetOperand: true },
    jp: { conditionCodes: ALL_CONDITION_CODES, requiresTargetOperand: true },
    jr: { conditionCodes: ['z', 'nz', 'c', 'nc'], requiresTargetOperand: true },
    ret: { conditionCodes: ALL_CONDITION_CODES, requiresTargetOperand: false }
};

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
    supportedDialects: readonly CpuDialect[];
}

const ALL_DIRECTIVE_DIALECTS: readonly CpuDialect[] = [CpuDialect.Z80, CpuDialect.EZ80];
const EZ80_DIRECTIVE_DIALECTS: readonly CpuDialect[] = [CpuDialect.EZ80];
const ASMSX_DIRECTIVE_DIALECTS: readonly CpuDialect[] = [CpuDialect.Z80];

function directive(
    name: string,
    description: string,
    signature: string,
    supportedDialects: readonly CpuDialect[] = ALL_DIRECTIVE_DIALECTS
): [string, DirectiveMetadata] {
    return [name, { name, description, signature, supportedDialects }];
}

export const DIRECTIVES = new Map<string, DirectiveMetadata>([
    directive('equ', 'Equate - defines a symbol with a constant value.', '<label> equ <expr>'),
    directive('db', 'Define Byte - allocates and initializes one or more bytes of memory.', 'db <expr> [, <expr>...]'),
    directive('defb', 'Define Byte - allocates and initializes one or more bytes of memory.', 'defb <expr> [, <expr>...]'),
    directive('dw', 'Define Word - allocates and initializes one or more words (16-bit) of memory.', 'dw <expr> [, <expr>...]'),
    directive('defw', 'Define Word - allocates and initializes one or more words (16-bit) of memory.', 'defw <expr> [, <expr>...]'),
    directive('ds', 'Define Space - allocates a block of memory, optionally initializing it.', 'ds <count> [, <value>]'),
    directive('defs', 'Define Space - allocates a block of memory, optionally initializing it.', 'defs <count> [, <value>]'),
    directive('org', 'Origin - sets the program counter to a specific address.', 'org <address>'),
    directive('include', 'Include - includes another source file.', 'include "<filename>"'),
    directive('macro', 'Macro - defines a macro.', '<name>: macro [<param1> [, <param2>...]]'),
    directive('endm', 'End Macro - ends a macro definition.', 'endm', ASMSX_DIRECTIVE_DIALECTS),
    directive('if', 'IF - begins a conditional assembly block. Code until ELSE or ENDIF is assembled only when the condition is true.', 'if <expr>'),
    directive('else', 'ELSE - begins the alternate branch of a conditional assembly block.', 'else'),
    directive('endif', 'ENDIF - ends a conditional assembly block.', 'endif'),
    directive('ifdef', 'IFDEF - begins a conditional assembly block that evaluates to true if the specified symbol is defined.', 'ifdef <symbol>'),
    directive('ifndef', 'IFNDEF - begins a conditional assembly block that evaluates to true if the specified symbol is defined.', 'ifndef <symbol>'),
    directive('incbin', 'Include Binary - includes a raw binary file.', 'incbin "<filename>"'),
    directive('byte', 'BYTE - eZ80 defines bytes from values or strings; asMSX reserves one byte.', 'byte <value|string> [, ...] (eZ80) | byte (asMSX)'),

    directive('dl', 'Define Long - allocates and initializes one or more longs (24-bit) of memory.', 'dl <expr> [, <expr>...]', EZ80_DIRECTIVE_DIALECTS),
    directive('align', 'Align - aligns the program counter to a specified boundary.', 'align <boundary> [, <fill>]', EZ80_DIRECTIVE_DIALECTS),
    directive('assume', 'Assume - tells the assembler to assume a specific ADL mode.', 'assume adl = <0|1>', EZ80_DIRECTIVE_DIALECTS),
    directive('endmacro', 'End Macro - ends a macro definition (agon-ez80asm alternative to ENDM).', 'endmacro', EZ80_DIRECTIVE_DIALECTS),
    directive('maclib', 'Macro Library - includes a macro library file.', 'maclib "<filename>"', EZ80_DIRECTIVE_DIALECTS),
    directive('ascii', 'ASCII - defines bytes from numeric values or strings.', 'ascii <value|string> [, ...]', EZ80_DIRECTIVE_DIALECTS),
    directive('asciz', 'ASCIZ - defines bytes from numeric values or strings, terminated with zero.', 'asciz <value|string> [, ...]', EZ80_DIRECTIVE_DIALECTS),
    directive('blkb', 'BLKB - allocates a block of bytes.', 'blkb <count> [, value]', EZ80_DIRECTIVE_DIALECTS),
    directive('blkw', 'BLKW - allocates a block of 16-bit words.', 'blkw <count> [, value]', EZ80_DIRECTIVE_DIALECTS),
    directive('blkp', 'BLKP - allocates a block of 24-bit pointers.', 'blkp <count> [, value]', EZ80_DIRECTIVE_DIALECTS),
    directive('blkl', 'BLKL - allocates a block of 32-bit words.', 'blkl <count> [, value]', EZ80_DIRECTIVE_DIALECTS),
    directive('dw24', 'DW24 - defines 24-bit words.', 'dw24 <expr> [, <expr>...]', EZ80_DIRECTIVE_DIALECTS),
    directive('dw32', 'DW32 - defines 32-bit words.', 'dw32 <expr> [, <expr>...]', EZ80_DIRECTIVE_DIALECTS),
    directive('fillbyte', 'FILLBYTE - sets value used for filled output bytes.', 'fillbyte <value>', EZ80_DIRECTIVE_DIALECTS),
    directive('cpu', 'CPU - limits following instructions to Z80, Z180, or eZ80 support.', 'cpu <Z80|Z180|EZ80>', EZ80_DIRECTIVE_DIALECTS),
    directive('relocate', 'RELOCATE - begins a block of relocatable code.', 'relocate', EZ80_DIRECTIVE_DIALECTS),
    directive('endrelocate', 'ENDRELOCATE - ends a relocatable code block.', 'endrelocate', EZ80_DIRECTIVE_DIALECTS),

    directive('dt', 'Define Text - asMSX alias for DB that defines bytes from data or strings.', 'dt <expr|string> [, <expr|string>...]', ASMSX_DIRECTIVE_DIALECTS),
    directive('deft', 'Define Text - asMSX alias for DB that defines bytes from data or strings.', 'deft <expr|string> [, <expr|string>...]', ASMSX_DIRECTIVE_DIALECTS),
    directive('word', 'WORD - asMSX directive that reserves one 16-bit word.', 'word', ASMSX_DIRECTIVE_DIALECTS),
    directive('megas', 'MegaROM Size - sets the MegaROM size/mapper type.', 'megas <KONAMI | KONAMI_SCC | ASCII8 | ASCII16>', ASMSX_DIRECTIVE_DIALECTS),
    directive('bios', 'BIOS call - specific to asMSX. Defines all standard MSX BIOS routines as labels.', 'bios', ASMSX_DIRECTIVE_DIALECTS),
    directive('biosvars', 'BIOS variables - specific to asMSX. Defines all standard MSX system variables as labels.', 'biosvars', ASMSX_DIRECTIVE_DIALECTS),
    directive('fpos', 'File Position - sets the output file position.', 'fpos <offset>', ASMSX_DIRECTIVE_DIALECTS),
    directive('rb', 'Reserve Byte - reserves bytes in memory without emitting data.', '<label> rb <count>', ASMSX_DIRECTIVE_DIALECTS),
    directive('rw', 'Reserve Word - reserves words (16-bit) in memory without emitting data.', '<label> rw <count>', ASMSX_DIRECTIVE_DIALECTS),
    directive('rl', 'Reserve Long - reserves longs (24/32-bit) in memory without emitting data.', '<label> rl <count>', ASMSX_DIRECTIVE_DIALECTS),
    directive('rs', 'Reserve Space - reserves space in memory without emitting data.', '<label> rs <count>', ASMSX_DIRECTIVE_DIALECTS),
    directive('insert', 'Insert - inserts a binary file (same as incbin).', 'insert "<filename>"', ASMSX_DIRECTIVE_DIALECTS),
    directive('phase', 'Phase - defines a block of code relocated to a different address.', 'phase <address>', ASMSX_DIRECTIVE_DIALECTS),
    directive('dephase', 'Dephase - ends a phase block.', 'dephase', ASMSX_DIRECTIVE_DIALECTS),
    directive('zilog', 'Zilog - switches the use of square brackets and parentheses from the point it is defined on.', 'zilog', ASMSX_DIRECTIVE_DIALECTS),
    directive('page', 'Page - sets the program counter to a specific 16KB page boundary.\n\n`0` = `0000h`\n`1` = `4000h`\n`2` = `8000h`\n`3` = `0C000h`', 'page <page_number>', ASMSX_DIRECTIVE_DIALECTS),
    directive('rom', 'ROM - generates a ROM header.', 'rom', ASMSX_DIRECTIVE_DIALECTS),
    directive('megarom', 'MegaROM - generates header for specified MegaROM mapper. Supported mappers: KONAMI, KONAMI_SCC, ASCII8, ASCII16.', 'megarom <mapper>', ASMSX_DIRECTIVE_DIALECTS),
    directive('basic', 'BASIC - generates header for a loadable binary MSX-BASIC file.', 'basic', ASMSX_DIRECTIVE_DIALECTS),
    directive('msxdos', 'MSXDOS - produces a COM executable for MSX-DOS.', 'msxdos', ASMSX_DIRECTIVE_DIALECTS),
    directive('start', 'Start - indicates the starting execution address for ROM, MegaROM and BIN files.', 'start <address>', ASMSX_DIRECTIVE_DIALECTS),
    directive('search', 'Search - finds and sets slot and subslot on page 2 for ROMs.', 'search', ASMSX_DIRECTIVE_DIALECTS),
    directive('subpage', 'Subpage - defines different sub-pages in a MegaROM.', 'subpage <n> at <address>', ASMSX_DIRECTIVE_DIALECTS),
    directive('select', 'Select - selects the sub-page n with execution entry point at x.', 'select <n> at <address>', ASMSX_DIRECTIVE_DIALECTS),
    directive('callbios', 'Call BIOS - calls a BIOS routine from MSX-DOS program.', 'callbios <address>', ASMSX_DIRECTIVE_DIALECTS),
    directive('calldos', 'Call DOS - calls MSX-DOS function.', 'calldos <function>', ASMSX_DIRECTIVE_DIALECTS),
    directive('size', 'Size - sets the output file size in Kilobytes.', 'size <kilobytes>', ASMSX_DIRECTIVE_DIALECTS),
    directive('debug', 'Debug - adds text to assembled program visible during debugging.', 'debug "<text>"', ASMSX_DIRECTIVE_DIALECTS),
    directive('break', 'Break - defines a breakpoint for BlueMSX debugger.', 'break [<address>]', ASMSX_DIRECTIVE_DIALECTS),
    directive('breakpoint', 'Breakpoint - defines a breakpoint for BlueMSX debugger.', 'breakpoint [<address>]', ASMSX_DIRECTIVE_DIALECTS),
    directive('rept', 'Repeat - repeats a block given number of times.', 'rept <count>', ASMSX_DIRECTIVE_DIALECTS),
    directive('endr', 'End repeat - ends a rept block.', 'endr', ASMSX_DIRECTIVE_DIALECTS),
    directive('printtext', 'Print Text - prints a text in the output text file.', 'printtext "<text>"', ASMSX_DIRECTIVE_DIALECTS),
    directive('printstring', 'Print String - prints a text in the output text file.', 'printstring "<text>"', ASMSX_DIRECTIVE_DIALECTS),
    directive('print', 'Print - prints a numeric expression in decimal format.', 'print <expr>', ASMSX_DIRECTIVE_DIALECTS),
    directive('printdec', 'Print Decimal - prints a numeric expression in decimal format.', 'printdec <expr>', ASMSX_DIRECTIVE_DIALECTS),
    directive('printhex', 'Print Hex - prints a numeric expression in hexadecimal format.', 'printhex <expr>', ASMSX_DIRECTIVE_DIALECTS),
    directive('printfix', 'Print Fix - prints a fixed-point numeric value.', 'printfix <expr>', ASMSX_DIRECTIVE_DIALECTS),
    directive('cas', 'Cas - generates a tape file name in output file.', 'cas ["<name>"]', ASMSX_DIRECTIVE_DIALECTS),
    directive('cassette', 'Cassette - generates a tape file name in output file.', 'cassette ["<name>"]', ASMSX_DIRECTIVE_DIALECTS),
    directive('wav', 'Wav - generates a WAV audio file.', 'wav ["<name>"]', ASMSX_DIRECTIVE_DIALECTS),
    directive('filename', 'Filename - sets the name of the output file.', 'filename ["<name>"]', ASMSX_DIRECTIVE_DIALECTS),
    directive('sinclair', 'Sinclair - sets the output file type to TAP format (broken).', 'sinclair', ASMSX_DIRECTIVE_DIALECTS)
]);

export const INSTRUCTIONS = new Map<string, InstructionMetadata>();

function addInst(
    mnemonic: string,
    description: string,
    signature: string,
    dialects?: CpuDialect[],
    supportedCpus: CpuTarget[] = [CpuTarget.Z80, CpuTarget.Z180, CpuTarget.EZ80],
    z80OnlyRegisters: readonly string[] = []
): void {
    const supportedDialects = dialects || [CpuDialect.Z80, CpuDialect.EZ80];
    const isDialectSpecific = supportedDialects.length < 2;
    INSTRUCTIONS.set(mnemonic, {
        mnemonic,
        isDialectSpecific,
        supportedDialects,
        supportedCpus,
        description,
        signature,
        z80OnlyRegisters
    });
}

// Common Z80 instructions
addInst('adc', 'Add with Carry', 'ADC A, s | ADC HL, ss', undefined, undefined, ['ixh', 'ixl', 'iyh', 'iyl']);
addInst('add', 'Add without Carry', 'ADD A, s | ADD HL, ss | ADD IX, pp | ADD IY, rr', undefined, undefined, ['ixh', 'ixl', 'iyh', 'iyl']);
addInst('and', 'Logical AND', 'AND s', undefined, undefined, ['ixh', 'ixl', 'iyh', 'iyl']);
addInst('bit', 'Test Bit', 'BIT b, m');
addInst('call', 'Call Subroutine', 'CALL cc, nn | CALL nn');
addInst('ccf', 'Complement Carry Flag', 'CCF');
addInst('cp', 'Compare with Accumulator', 'CP s', undefined, undefined, ['ixh', 'ixl', 'iyh', 'iyl']);
addInst('cpd', 'Compare and Decrement', 'CPD');
addInst('cpdr', 'Compare, Decrement and Repeat', 'CPDR');
addInst('cpi', 'Compare and Increment', 'CPI');
addInst('cpir', 'Compare, Increment and Repeat', 'CPIR');
addInst('cpl', 'Complement Accumulator', 'CPL');
addInst('daa', 'Decimal Adjust Accumulator', 'DAA');
addInst('dec', 'Decrement', 'DEC m | DEC dd/pp/rr | DEC x | DEC y', undefined, undefined, ['ixh', 'ixl', 'iyh', 'iyl']);
addInst('di', 'Disable Interrupts', 'DI');
addInst('djnz', 'Decrement Jump Non-Zero', 'DJNZ e');
addInst('ei', 'Enable Interrupts', 'EI');
addInst('ex', 'Exchange Registers', 'EX DE, HL | EX AF, AF\' | EX (SP), HL | EX (SP), IX | EX (SP), IY');
addInst('exx', 'Exchange Alternate Registers', 'EXX');
addInst('halt', 'Halt CPU', 'HALT');
addInst('im', 'Interrupt Mode', 'IM 0 | IM 1 | IM 2');
addInst('in', 'Input from Port', 'IN A, (n) | IN r, (C)');
addInst('inc', 'Increment', 'INC m | INC dd/pp/rr | INC x | INC y', undefined, undefined, ['ixh', 'ixl', 'iyh', 'iyl']);
addInst('ind', 'Input and Decrement', 'IND');
addInst('indr', 'Input, Decrement and Repeat', 'INDR');
addInst('ini', 'Input and Increment', 'INI');
addInst('inir', 'Input, Increment and Repeat', 'INIR');
addInst('jp', 'Jump', 'JP cc, nn | JP nn | JP (HL) | JP (IX) | JP (IY)');
addInst('jr', 'Jump Relative', 'JR NZ/Z/NC/C, e | JR e');
addInst('ld', 'Load', 'LD x,x\' | LD y,y\' | LD x,r | LD r,x | LD y,r | LD r,y | LD x,n | LD y,n | LD r, r\' | LD r, n | LD r, (HL) | LD (HL), r/n | LD r, (IX/IY+d) | LD (IX/IY+d), r/n | LD A, (BC/DE/nn) | LD (BC/DE/nn), A | LD A, I | LD A, R | LD I, A | LD R, A | LD dd/pp/rr, nn | LD dd/pp/rr, (nn) | LD (nn), dd/pp/rr | LD SP, HL/IX/IY', undefined, undefined, ['ixh', 'ixl', 'iyh', 'iyl']);
addInst('ldd', 'Load and Decrement', 'LDD');
addInst('lddr', 'Load, Decrement and Repeat', 'LDDR');
addInst('ldi', 'Load and Increment', 'LDI');
addInst('ldir', 'Load, Increment and Repeat', 'LDIR');
addInst('neg', 'Negate Accumulator', 'NEG');
addInst('nop', 'No Operation', 'NOP');
addInst('or', 'Logical OR', 'OR s', undefined, undefined, ['ixh', 'ixl', 'iyh', 'iyl']);
addInst('otdr', 'Output, Decrement and Repeat', 'OTDR');
addInst('otir', 'Output, Increment and Repeat', 'OTIR');
addInst('out', 'Output to Port', 'OUT (n), A | OUT (C), r');
addInst('outd', 'Output and Decrement', 'OUTD');
addInst('outi', 'Output and Increment', 'OUTI');
addInst('pop', 'Pop from Stack', 'POP qq | POP IX | POP IY');
addInst('push', 'Push to Stack', 'PUSH qq | PUSH IX | PUSH IY');
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
addInst('sbc', 'Subtract with Carry', 'SBC A, s | SBC HL, ss', undefined, undefined, ['ixh', 'ixl', 'iyh', 'iyl']);
addInst('scf', 'Set Carry Flag', 'SCF');
addInst('set', 'Set Bit', 'SET b, m');
addInst('sla', 'Shift Left Arithmetic', 'SLA m');
addInst('sra', 'Shift Right Arithmetic', 'SRA m');
addInst('srl', 'Shift Right Logical', 'SRL m');
addInst('sll', 'Shift Left Logical (undocumented Z80)', 'SLL m', undefined, [CpuTarget.Z80]);
addInst('sub', 'Subtract without Carry', 'SUB s', undefined, undefined, ['ixh', 'ixl', 'iyh', 'iyl']);
addInst('xor', 'Logical Exclusive OR', 'XOR s', undefined, undefined, ['ixh', 'ixl', 'iyh', 'iyl']);

// eZ80 specific instructions
addInst('in0', 'Input from Port (page 0)', 'IN0 r, (n)', [CpuDialect.EZ80], [CpuTarget.Z180, CpuTarget.EZ80]);
addInst('out0', 'Output to Port (page 0)', 'OUT0 (n), r', [CpuDialect.EZ80], [CpuTarget.Z180, CpuTarget.EZ80]);
addInst('inim', 'Input and Increment', 'INIM', [CpuDialect.EZ80], [CpuTarget.EZ80]);
addInst('inimr', 'Input, Increment and Repeat', 'INIMR', [CpuDialect.EZ80], [CpuTarget.EZ80]);
addInst('indm', 'Input and Decrement', 'INDM', [CpuDialect.EZ80], [CpuTarget.EZ80]);
addInst('indmr', 'Input, Decrement and Repeat', 'INDMR', [CpuDialect.EZ80], [CpuTarget.EZ80]);
addInst('otim', 'Output and Increment', 'OTIM', [CpuDialect.EZ80], [CpuTarget.Z180, CpuTarget.EZ80]);
addInst('otimr', 'Output, Increment and Repeat', 'OTIMR', [CpuDialect.EZ80], [CpuTarget.Z180, CpuTarget.EZ80]);
addInst('otdm', 'Output and Decrement', 'OTDM', [CpuDialect.EZ80], [CpuTarget.Z180, CpuTarget.EZ80]);
addInst('otdmr', 'Output, Decrement and Repeat', 'OTDMR', [CpuDialect.EZ80], [CpuTarget.Z180, CpuTarget.EZ80]);
addInst('lea', 'Load Effective Address', 'LEA kk, IX+d | LEA kk, IY+d', [CpuDialect.EZ80], [CpuTarget.EZ80]);
addInst('pea', 'Push Effective Address', 'PEA IX+d | PEA IY+d', [CpuDialect.EZ80], [CpuTarget.EZ80]);
addInst('rsmix', 'Reset Mixed Memory Mode Flag', 'RSMIX', [CpuDialect.EZ80], [CpuTarget.EZ80]);
addInst('stmix', 'Set Mixed Memory Mode Flag', 'STMIX', [CpuDialect.EZ80], [CpuTarget.EZ80]);
addInst('slp', 'Sleep', 'SLP', [CpuDialect.EZ80], [CpuTarget.Z180, CpuTarget.EZ80]);
addInst('mlt', 'Multiply', 'MLT rr', [CpuDialect.EZ80], [CpuTarget.Z180, CpuTarget.EZ80]);
addInst('tst', 'Test Accumulator', 'TST A, s', [CpuDialect.EZ80], [CpuTarget.Z180, CpuTarget.EZ80]);
addInst('tstio', 'Test I/O Port', 'TSTIO n', [CpuDialect.EZ80], [CpuTarget.Z180, CpuTarget.EZ80]);
addInst('ini2', 'Input and Increment 2', 'INI2', [CpuDialect.EZ80], [CpuTarget.EZ80]);
addInst('ind2', 'Input and Decrement 2', 'IND2', [CpuDialect.EZ80], [CpuTarget.EZ80]);
addInst('ini2r', 'Input, Increment and Repeat 2', 'INI2R', [CpuDialect.EZ80], [CpuTarget.EZ80]);
addInst('ind2r', 'Input, Decrement and Repeat 2', 'IND2R', [CpuDialect.EZ80], [CpuTarget.EZ80]);
addInst('outi2', 'Output and Increment 2', 'OUTI2', [CpuDialect.EZ80], [CpuTarget.EZ80]);
addInst('outd2', 'Output and Decrement 2', 'OUTD2', [CpuDialect.EZ80], [CpuTarget.EZ80]);
addInst('oti2r', 'Output, Increment and Repeat 2', 'OTI2R', [CpuDialect.EZ80], [CpuTarget.EZ80]);
addInst('otd2r', 'Output, Decrement and Repeat 2', 'OTD2R', [CpuDialect.EZ80], [CpuTarget.EZ80]);
addInst('inirx', 'Input, Increment with Stationary I/O Address', 'INIRX', [CpuDialect.EZ80], [CpuTarget.EZ80]);
addInst('indrx', 'Input, Decrement with Stationary I/O Address', 'INDRX', [CpuDialect.EZ80], [CpuTarget.EZ80]);
addInst('otirx', 'Output, Increment with Stationary I/O Address', 'OTIRX', [CpuDialect.EZ80], [CpuTarget.EZ80]);
addInst('otdrx', 'Output, Decrement with Stationary I/O Address', 'OTDRX', [CpuDialect.EZ80], [CpuTarget.EZ80]);

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
