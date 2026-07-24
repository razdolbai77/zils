import { describe, it } from 'node:test';
import * as assert from 'node:assert';
import * as fs from 'fs';
import * as path from 'path';
import { collectDiagnostics } from '../src/asm/diagnostics';
import { AsmDocument, Diagnostic } from '../src/asm/document';
import { CpuDialect } from '../src/asm/metadata';
import { indexWorkspace } from '../src/asm/workspace';

interface ExpectedDiagnostic {
    message: string;
    startCharacter?: number;
    length?: number;
}

type InstructionDiagnosticManifest = Readonly<Record<string, readonly (readonly ExpectedDiagnostic[])[]>>;

function sourceLines(source: string): string[] {
    const lines = source.split(/\r?\n/);
    if (lines.at(-1) === '') lines.pop();
    return lines;
}

function diagnosticExpectation(diagnostic: Diagnostic): ExpectedDiagnostic {
    return {
        message: diagnostic.message,
        ...(diagnostic.startCharacter === undefined ? {} : { startCharacter: diagnostic.startCharacter }),
        ...(diagnostic.length === undefined ? {} : { length: diagnostic.length })
    };
}

function sortDiagnostics(diagnostics: readonly ExpectedDiagnostic[]): ExpectedDiagnostic[] {
    return [...diagnostics].sort((left, right) =>
        (left.startCharacter ?? -1) - (right.startCharacter ?? -1) ||
        (left.length ?? -1) - (right.length ?? -1) ||
        left.message.localeCompare(right.message)
    );
}

describe('Instruction Diagnostic Manifest', () => {
    const examplesDir = path.resolve('examples');
    const manifestPath = path.resolve('test', 'fixtures', 'instruction-diagnostic-manifest.json');
    const files = fs.readdirSync(examplesDir)
        .filter((file) => /^instruction-errors-\d+\.(?:z80|ez80)$/.test(file))
        .sort();

    it('records exact diagnostics and explicit valid lines for every instruction-error example', async () => {
        const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as InstructionDiagnosticManifest;
        assert.deepStrictEqual(Object.keys(manifest).sort(), files);

        for (const file of files) {
            const source = fs.readFileSync(path.join(examplesDir, file), 'utf8');
            const dialect = file.endsWith('.z80') ? CpuDialect.Z80 : CpuDialect.EZ80;
            const isAsmsx = dialect === CpuDialect.Z80;
            const document = new AsmDocument(source, dialect, isAsmsx);
            const workspace = await indexWorkspace(
                path.join(examplesDir, file),
                new Map([[path.join(examplesDir, file), document]]),
                dialect,
                isAsmsx
            );
            const actual = Array.from({ length: sourceLines(source).length }, () => [] as ExpectedDiagnostic[]);
            for (const diagnostic of collectDiagnostics(workspace, path.join(examplesDir, file))) {
                actual[diagnostic.line].push(diagnosticExpectation(diagnostic));
            }

            assert.equal(manifest[file].length, actual.length, `Expected explicit entry for every ${file} line`);
            for (const [line, expected] of manifest[file].entries()) {
                assert.deepStrictEqual(sortDiagnostics(actual[line]), sortDiagnostics(expected), `${file}:${line + 1}`);
            }
        }
    });
});
