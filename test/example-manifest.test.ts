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

const range = (start: number, end: number): readonly [number, number] => [start, end];

const EXAMPLE_MANIFEST: Readonly<Record<string, ExampleManifestEntry>> = {
    'bios.z80': { dialect: CpuDialect.Z80, isAsmsx: true, expectedDiagnosticLines: [] },
    'bios_error_1.z80': { dialect: CpuDialect.Z80, isAsmsx: true, expectedDiagnosticLines: [1, range(3, 126)] },
    'bios_error_2.z80': { dialect: CpuDialect.Z80, isAsmsx: true, expectedDiagnosticLines: [range(3, 126)] },
    'biosvars.z80': { dialect: CpuDialect.Z80, isAsmsx: true, expectedDiagnosticLines: [] },
    'biosvars_error_1.z80': { dialect: CpuDialect.Z80, isAsmsx: true, expectedDiagnosticLines: [1, range(3, 146)] },
    'biosvars_error_2.z80': { dialect: CpuDialect.Z80, isAsmsx: true, expectedDiagnosticLines: [range(3, 146)] },
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

describe("Example Manifest", () => {
    const examplesDir = path.resolve('examples');
    const exampleFiles = fs.readdirSync(examplesDir)
        .filter((file) => /\.(?:z80|ez80)$/.test(file))
        .sort();

    it("covers every assembly example", () => {
        assert.deepStrictEqual(Object.keys(EXAMPLE_MANIFEST).sort(), exampleFiles);
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
            const actualDiagnosticLines = collectDiagnostics(workspace, fixturePath)
                .map((diagnostic) => diagnostic.line + 1);

            assert.deepStrictEqual(
                normalizeDiagnosticLines(actualDiagnosticLines),
                normalizeDiagnosticLines(expandDiagnosticLines(fixture.expectedDiagnosticLines)),
                `Unexpected diagnostic lines for ${file}`
            );
        }
    });
});
