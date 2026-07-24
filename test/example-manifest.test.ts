import { describe, it } from 'node:test';
import * as assert from 'node:assert';
import * as fs from 'fs';
import * as path from 'path';
import { collectDiagnostics } from '../src/asm/diagnostics';
import { AsmDocument } from '../src/asm/document';
import { CpuDialect } from '../src/asm/metadata';
import { indexWorkspace } from '../src/asm/workspace';

type DiagnosticLine = number | readonly [number, number];

interface ExampleManifestEntry {
    dialect: CpuDialect;
    isAsmsx: boolean;
    expectedDiagnosticLines: readonly DiagnosticLine[];
}

interface DiagnosticExpectation {
    line: number;
    startCharacter: number;
    length: number;
    message: string;
}

const range = (start: number, end: number): readonly [number, number] => [start, end];

const EXAMPLE_MANIFEST: Readonly<Record<string, ExampleManifestEntry>> = {
    'bios.z80': { dialect: CpuDialect.Z80, isAsmsx: true, expectedDiagnosticLines: [] },
    'bios_error_1.z80': { dialect: CpuDialect.Z80, isAsmsx: true, expectedDiagnosticLines: [1, range(3, 126)] },
    'bios_error_2.z80': { dialect: CpuDialect.Z80, isAsmsx: true, expectedDiagnosticLines: [range(3, 126)] },
    'biosvars.z80': { dialect: CpuDialect.Z80, isAsmsx: true, expectedDiagnosticLines: [] },
    'biosvars_error_1.z80': { dialect: CpuDialect.Z80, isAsmsx: true, expectedDiagnosticLines: [1, range(3, 146)] },
    'biosvars_error_2.z80': { dialect: CpuDialect.Z80, isAsmsx: true, expectedDiagnosticLines: [range(3, 146)] },
    'directives.ez80': { dialect: CpuDialect.EZ80, isAsmsx: false, expectedDiagnosticLines: [] },
    'directives-errors.z80': { dialect: CpuDialect.Z80, isAsmsx: true, expectedDiagnosticLines: [range(1, 100)] },
    'directives.z80': { dialect: CpuDialect.Z80, isAsmsx: true, expectedDiagnosticLines: [] },
    'example.ez80': { dialect: CpuDialect.EZ80, isAsmsx: false, expectedDiagnosticLines: [47, range(52, 57), range(60, 62), range(65, 72)] },
    'example.z80': { dialect: CpuDialect.Z80, isAsmsx: true, expectedDiagnosticLines: [24, 25, 36, range(41, 42), range(45, 50), range(53, 55)] },
    'instruction-errors-1.ez80': { dialect: CpuDialect.EZ80, isAsmsx: false, expectedDiagnosticLines: [range(1, 300)] },
    'instruction-errors-1.z80': { dialect: CpuDialect.Z80, isAsmsx: true, expectedDiagnosticLines: [range(1, 191), range(193, 251)] },
    'instruction-errors-10.ez80': { dialect: CpuDialect.EZ80, isAsmsx: false, expectedDiagnosticLines: [range(1, 153), range(155, 300)] },
    'instruction-errors-11.ez80': { dialect: CpuDialect.EZ80, isAsmsx: false, expectedDiagnosticLines: [range(1, 300)] },
    'instruction-errors-12.ez80': { dialect: CpuDialect.EZ80, isAsmsx: false, expectedDiagnosticLines: [range(1, 213)] },
    'instruction-errors-2.ez80': { dialect: CpuDialect.EZ80, isAsmsx: false, expectedDiagnosticLines: [range(1, 300)] },
    'instruction-errors-2.z80': { dialect: CpuDialect.Z80, isAsmsx: true, expectedDiagnosticLines: [range(1, 75), range(77, 177), range(179, 252)] },
    'instruction-errors-3.ez80': { dialect: CpuDialect.EZ80, isAsmsx: false, expectedDiagnosticLines: [range(1, 58), range(60, 300)] },
    'instruction-errors-3.z80': { dialect: CpuDialect.Z80, isAsmsx: true, expectedDiagnosticLines: [range(1, 43), range(45, 85), range(87, 102), 104, 107, 109, range(111, 115), 117, 120, 122, range(124, 215), range(217, 273)] },
    'instruction-errors-4.ez80': { dialect: CpuDialect.EZ80, isAsmsx: false, expectedDiagnosticLines: [range(1, 304)] },
    'instruction-errors-4.z80': { dialect: CpuDialect.Z80, isAsmsx: true, expectedDiagnosticLines: [range(1, 20), range(22, 255)] },
    'instruction-errors-5.ez80': { dialect: CpuDialect.EZ80, isAsmsx: false, expectedDiagnosticLines: [range(3, 300)] },
    'instruction-errors-5.z80': { dialect: CpuDialect.Z80, isAsmsx: true, expectedDiagnosticLines: [range(1, 250)] },
    'instruction-errors-6.ez80': { dialect: CpuDialect.EZ80, isAsmsx: false, expectedDiagnosticLines: [range(1, 275), range(277, 300)] },
    'instruction-errors-6.z80': { dialect: CpuDialect.Z80, isAsmsx: true, expectedDiagnosticLines: [range(1, 118), range(121, 126), range(130, 141)] },
    'instruction-errors-7.ez80': { dialect: CpuDialect.EZ80, isAsmsx: false, expectedDiagnosticLines: [range(1, 300)] },
    'instruction-errors-8.ez80': { dialect: CpuDialect.EZ80, isAsmsx: false, expectedDiagnosticLines: [range(1, 300)] },
    'instruction-errors-9.ez80': { dialect: CpuDialect.EZ80, isAsmsx: false, expectedDiagnosticLines: [range(1, 300)] },
    'instructions.ez80': { dialect: CpuDialect.EZ80, isAsmsx: false, expectedDiagnosticLines: [range(807, 810), range(815, 818), range(844, 845), range(848, 849)] },
    'instructions.z80': { dialect: CpuDialect.Z80, isAsmsx: true, expectedDiagnosticLines: [range(485, 494)] },
    'syntax-errors.ez80': { dialect: CpuDialect.EZ80, isAsmsx: false, expectedDiagnosticLines: [range(3, 14)] },
    'syntax-errors.z80': { dialect: CpuDialect.Z80, isAsmsx: true, expectedDiagnosticLines: [range(3, 7), range(9, 13)] },
    'syntax-forms.ez80': { dialect: CpuDialect.EZ80, isAsmsx: false, expectedDiagnosticLines: [] },
    'syntax-forms.z80': { dialect: CpuDialect.Z80, isAsmsx: true, expectedDiagnosticLines: [] },
    'zilog.z80': { dialect: CpuDialect.Z80, isAsmsx: true, expectedDiagnosticLines: [2, 4] }
};

function expandDiagnosticLines(lineSpecs: readonly DiagnosticLine[]): number[] {
    return lineSpecs.flatMap((lineSpec) => {
        if (typeof lineSpec === 'number') return [lineSpec];

        const [start, end] = lineSpec;
        return Array.from({ length: end - start + 1 }, (_, offset) => start + offset);
    });
}

function normalizeDiagnosticLines(lines: readonly number[]): number[] {
    return Array.from(new Set(lines)).sort((left, right) => left - right);
}

function readDiagnosticAnnotations(source: string): DiagnosticExpectation[] {
    return source.split(/\r?\n/).flatMap((sourceLine, line) => {
        const marker = '; EXPECTED-DIAGNOSTIC ';
        const markerIndex = sourceLine.indexOf(marker);
        if (markerIndex === -1) return [];

        return sourceLine.slice(markerIndex + marker.length).split(' || ').map((annotation) => {
            const match = annotation.match(/^(\d+):(\d+): (.+)$/);
            if (!match) throw new Error(`Invalid diagnostic annotation on line ${line + 1}`);

            return {
                line,
                startCharacter: Number(match[1]),
                length: Number(match[2]),
                message: match[3]
            };
        });
    });
}

function normalizeDiagnosticExpectations(diagnostics: readonly DiagnosticExpectation[]): DiagnosticExpectation[] {
    return [...diagnostics].sort((left, right) =>
        left.line - right.line ||
        left.startCharacter - right.startCharacter ||
        left.length - right.length ||
        left.message.localeCompare(right.message)
    );
}

const ANNOTATED_OVERVIEW_FILES = new Set(['example.ez80', 'example.z80']);

const REQUIRED_EZ80_DIRECTIVES = [
    'db', 'defb', 'defl', 'defs', 'defw', 'ds', 'dw',
    'endm', 'equ', 'incbin', 'include', 'maclib', 'macro'
].sort();

const REQUIRED_ASMSX_DIRECTIVES = [
    'db', 'defb', 'defs', 'defw', 'ds', 'dw', 'endm', 'macro', 'rs'
].sort();

const SYNTAX_EXAMPLE_FILES = [
    'syntax-errors.ez80', 'syntax-errors.z80',
    'syntax-forms.ez80', 'syntax-forms.z80'
].sort();

const COMMON_SYNTAX_FORM_MARKERS = [
    'numeric_decimal', 'numeric_dollar', 'numeric_hex_prefix', 'numeric_hex_suffix',
    'numeric_binary_prefix', 'numeric_binary_suffix', 'numeric_agon_hex', 'numeric_agon_binary',
    'numeric_octal_prefix', 'numeric_octal_suffix', 'numeric_float', 'character_escape',
    'op_unary_plus', 'op_unary_minus', 'op_bitwise_not', 'op_logical_not',
    'op_add', 'op_subtract', 'op_multiply', 'op_divide', 'op_modulo',
    'op_bitwise_or', 'op_bitwise_and', 'op_bitwise_xor', 'op_shift_left', 'op_shift_right',
    'op_equal', 'op_equal_single', 'op_not_equal', 'op_not_equal_alt',
    'op_less', 'op_greater', 'op_less_equal', 'op_greater_equal',
    'op_logical_and', 'op_logical_or', 'op_named_and', 'op_named_or', 'op_named_xor',
    'op_named_not', 'op_named_mod', 'op_named_shl', 'op_named_shr',
    'op_named_eq', 'op_named_ne', 'op_named_lt', 'op_named_le', 'op_named_gt', 'op_named_ge',
    'op_parentheses', 'op_current_location', 'global_label', 'colonless_label', 'assignment_label'
];

const DIALECT_SYNTAX_FORM_MARKERS: Readonly<Record<string, readonly string[]>> = {
    'syntax-forms.ez80': [
        ...COMMON_SYNTAX_FORM_MARKERS, 'string_escapes', '@local_label:', '@@:',
        '; Semicolon comments are supported in eZ80 mode', 'macro emit_value', 'if 1', 'else', 'endif'
    ],
    'syntax-forms.z80': [
        ...COMMON_SYNTAX_FORM_MARKERS, 'string_raw', '.local_label:', '@@:',
        '; Semicolon comment', '// Slash comment', '-- Dash comment', '/* Block comment */', '{ Brace comment }',
        'emit_value: macro #value', '.IF 1', '.ELSE', '.ENDIF'
    ],
    'syntax-errors.ez80': [
        'bad_hash', 'bad_hex', 'bad_binary', 'bad_binary_digit', 'bad_escape',
        'label_exceeding_the_ez80_thirty_two_character_limit', 'ld:', '// asMSX-only comment form',
        'bad_expression', 'macro', 'endm', 'endif'
    ],
    'syntax-errors.z80': [
        'bad_octal', 'bad_suffix', 'bad_float', 'bad_escape', '@ez80_local_label:',
        'bad_expression', '.MACRO', '.ENDM', '.ENDIF', '/* Unterminated block comment'
    ]
};

describe("Example Manifest", () => {
    const examplesDir = path.resolve('examples');
    const exampleFiles = fs.readdirSync(examplesDir)
        .filter((file) => /\.(?:z80|ez80)$/.test(file))
        .sort();

    it("covers every assembly example", () => {
        assert.deepStrictEqual(Object.keys(EXAMPLE_MANIFEST).sort(), exampleFiles);
    });

    it("covers each unrepresented supported eZ80 directive", () => {
        const source = fs.readFileSync(path.join(examplesDir, 'directives.ez80'), 'utf8');
        const document = new AsmDocument(source, CpuDialect.EZ80);
        const documentedDirectives = Array.from(new Set(
            document.lines
                .filter((line) => line.isDirective && line.mnemonic !== undefined)
                .map((line) => line.mnemonic!)
        )).sort();

        assert.deepStrictEqual(documentedDirectives, REQUIRED_EZ80_DIRECTIVES);
    });

    it("covers each unrepresented supported asMSX directive", () => {
        const source = fs.readFileSync(path.join(examplesDir, 'directives.z80'), 'utf8');
        const document = new AsmDocument(source, CpuDialect.Z80, true);
        const documentedDirectives = new Set(
            document.lines
                .filter((line) => line.isDirective && line.mnemonic !== undefined)
                .map((line) => line.mnemonic!)
        );

        assert.deepStrictEqual(
            REQUIRED_ASMSX_DIRECTIVES.filter((directive) => !documentedDirectives.has(directive)),
            []
        );
    });

    it("includes every documented syntax form in both dialects", () => {
        assert.deepStrictEqual(Object.keys(DIALECT_SYNTAX_FORM_MARKERS).sort(), SYNTAX_EXAMPLE_FILES);
        for (const [file, markers] of Object.entries(DIALECT_SYNTAX_FORM_MARKERS)) {
            const source = fs.readFileSync(path.join(examplesDir, file), 'utf8');
            for (const marker of markers) {
                assert.ok(source.includes(marker), `Missing syntax form "${marker}" in ${file}`);
            }
        }
    });

    it("matches diagnostics for every assembly example", async () => {
        for (const file of exampleFiles) {
            const fixture = EXAMPLE_MANIFEST[file];
            const fixturePath = path.join(examplesDir, file);
            const source = fs.readFileSync(fixturePath, 'utf8');
            const document = new AsmDocument(source, fixture.dialect, fixture.isAsmsx);
            const workspace = await indexWorkspace(
                fixturePath,
                new Map([[fixturePath, document]]),
                fixture.dialect,
                fixture.isAsmsx
            );
            const diagnostics = collectDiagnostics(workspace, fixturePath);
            const actualDiagnosticLines = diagnostics.map((diagnostic) => diagnostic.line + 1);

            assert.deepStrictEqual(
                normalizeDiagnosticLines(actualDiagnosticLines),
                normalizeDiagnosticLines(expandDiagnosticLines(fixture.expectedDiagnosticLines)),
                `Unexpected diagnostic lines for ${file}`
            );

            if (ANNOTATED_OVERVIEW_FILES.has(file)) {
                const actualDiagnostics: DiagnosticExpectation[] = diagnostics.map((diagnostic) => ({
                    line: diagnostic.line,
                    startCharacter: diagnostic.startCharacter ?? -1,
                    length: diagnostic.length ?? -1,
                    message: diagnostic.message
                }));

                assert.deepStrictEqual(
                    normalizeDiagnosticExpectations(actualDiagnostics),
                    normalizeDiagnosticExpectations(readDiagnosticAnnotations(source))
                );
            }
        }
    });
});
