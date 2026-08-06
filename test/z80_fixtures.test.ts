import { describe, it } from 'node:test';
import * as fs from 'fs';
import * as path from 'path';
import * as assert from 'assert';
import { indexWorkspace } from '../src/asm/workspace';
import { collectDiagnostics } from '../src/asm/diagnostics';
import { AsmDocument } from '../src/asm/document';
import { CpuDialect } from '../src/asm/metadata';

describe("Fixture Corpora", () => {
    const validDir = path.resolve('test', 'fixtures', 'valid');
    const invalidDir = path.resolve('test', 'fixtures', 'invalid');

    // .asm fixtures assemble under eZ80 semantics; .z80 fixtures under
    // asMSX. Both directories are exercised in both dialects so directive
    // and macro families stay covered per dialect.
    function dialectFor(file: string): { dialect: CpuDialect; isAsmsx: boolean } {
        return file.endsWith('.z80')
            ? { dialect: CpuDialect.Z80, isAsmsx: true }
            : { dialect: CpuDialect.EZ80, isAsmsx: false };
    }

    describe("Valid Syntax", () => {
        const files = fs.readdirSync(validDir).filter(f => f.endsWith('.asm') || f.endsWith('.z80'));
        for (const file of files) {
            it(`produces no diagnostics for valid fixture ${file}`, async () => {
                const fixturePath = path.join(validDir, file);
                const source = fs.readFileSync(fixturePath, 'utf8');
                const { dialect, isAsmsx } = dialectFor(file);
                const document = new AsmDocument(source, dialect, isAsmsx);
                const workspace = await indexWorkspace(fixturePath, new Map([[fixturePath, document]]), dialect, isAsmsx);

                assert.deepStrictEqual(collectDiagnostics(workspace, fixturePath), []);
            });
        }
    });


    describe("Invalid Syntax", () => {
        const files = fs.readdirSync(invalidDir).filter(f => f.endsWith('.asm') || f.endsWith('.z80'));
        for (const file of files) {
            it(`produces diagnostics for invalid fixture ${file}`, async () => {
                const fixturePath = path.join(invalidDir, file);
                const source = fs.readFileSync(fixturePath, 'utf8');
                const { dialect, isAsmsx } = dialectFor(file);
                const document = new AsmDocument(source, dialect, isAsmsx);
                const workspace = await indexWorkspace(fixturePath, new Map([[fixturePath, document]]), dialect, isAsmsx);

                assert.ok(collectDiagnostics(workspace, fixturePath).length > 0, `Expected diagnostics for ${file}`);
            });
        }
    });
});

