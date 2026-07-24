import { describe, it } from 'node:test';
import * as fs from 'fs';
import * as path from 'path';
import * as assert from 'assert';
import { indexWorkspace } from '../src/asm/workspace';
import { collectDiagnostics } from '../src/asm/diagnostics';
import { AsmDocument } from '../src/asm/document';
import { CpuDialect } from '../src/asm/metadata';

describe("Z80 Fixture Corpora", () => {
    const validDir = path.resolve('test', 'fixtures', 'valid');
    const invalidDir = path.resolve('test', 'fixtures', 'invalid');

    describe("Valid Syntax", () => {
        const files = fs.readdirSync(validDir).filter(f => f.endsWith('.asm'));
        for (const file of files) {
            it(`produces no diagnostics for valid fixture ${file}`, async () => {
                const fixturePath = path.join(validDir, file);
                const source = fs.readFileSync(fixturePath, 'utf8');
                const document = new AsmDocument(source, CpuDialect.EZ80);
                const workspace = await indexWorkspace(fixturePath, new Map([[fixturePath, document]]), CpuDialect.EZ80);

                assert.deepStrictEqual(collectDiagnostics(workspace, fixturePath), []);
            });
        }
    });

    it("produces no diagnostics for valid directives example", async () => {
        const examplePath = path.resolve('examples', 'directives.z80');
        const source = fs.readFileSync(examplePath, 'utf8');
        const document = new AsmDocument(source, CpuDialect.Z80, true);
        const workspace = await indexWorkspace(examplePath, new Map([[examplePath, document]]), CpuDialect.Z80, true);

        assert.deepStrictEqual(collectDiagnostics(workspace, examplePath), []);
    });

    describe("Invalid Syntax", () => {
        const files = fs.readdirSync(invalidDir).filter(f => f.endsWith('.asm'));
        for (const file of files) {
            it(`produces diagnostics for invalid fixture ${file}`, async () => {
                const fixturePath = path.join(invalidDir, file);
                const source = fs.readFileSync(fixturePath, 'utf8');
                const document = new AsmDocument(source, CpuDialect.EZ80);
                const workspace = await indexWorkspace(fixturePath, new Map([[fixturePath, document]]), CpuDialect.EZ80);

                assert.ok(collectDiagnostics(workspace, fixturePath).length > 0, `Expected diagnostics for ${file}`);
            });
        }
    });
});

