import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { AsmDocument } from '../src/asm/document';
import { BIOS_ROUTINES, BIOS_VARS, CpuDialect } from '../src/asm/metadata';
import { BIOS_ROUTINE_DESCRIPTIONS } from '../src/asm/bios';
import { BIOS_VARIABLE_DESCRIPTIONS } from '../src/asm/bios-variables';
import { buildHover } from '../src/lsp/hover';

test('hover documents asMSX BIOS routine labels', async () => {
    const filePath = path.resolve('examples', 'bios.z80');
    const uri = pathToFileURL(filePath).href;
    const document = new AsmDocument(fs.readFileSync(filePath, 'utf8'), CpuDialect.Z80, true);

    const hover = await buildHover(new Map([[uri, document]]), uri, 2, 16);

    assert.deepEqual(hover, {
        contents: 'MSX BIOS Routine: `CHKRAM`\n\nTests RAM and sets RAM slot for the system'
    });
});

test('documents every asMSX BIOS routine label', () => {
    assert.deepEqual(
        Array.from(BIOS_ROUTINES).filter((routine) => !BIOS_ROUTINE_DESCRIPTIONS.has(routine)),
        []
    );
    assert.deepEqual(
        Array.from(BIOS_ROUTINE_DESCRIPTIONS.keys()).filter((routine) => !BIOS_ROUTINES.has(routine)),
        []
    );
});

test('hover documents asMSX BIOS variable labels', async () => {
    const filePath = path.resolve('examples', 'biosvars.z80');
    const uri = pathToFileURL(filePath).href;
    const source = fs.readFileSync(filePath, 'utf8');
    const document = new AsmDocument(source, CpuDialect.Z80, true);
    const line = source.split(/\r?\n/).findIndex((text) => text.includes('CGTABL'));

    const hover = await buildHover(new Map([[uri, document]]), uri, line, source.split(/\r?\n/)[line].indexOf('CGTABL'));

    assert.deepEqual(hover, {
        contents: 'MSX BIOS Variable: `CGTABL`\n\nBase address of the MSX character set in ROM'
    });
});

test('documents every asMSX BIOS variable label', () => {
    assert.deepEqual(
        Array.from(BIOS_VARS).filter((variable) => !BIOS_VARIABLE_DESCRIPTIONS.has(variable)),
        []
    );
    assert.deepEqual(
        Array.from(BIOS_VARIABLE_DESCRIPTIONS.keys()).filter((variable) => !BIOS_VARS.has(variable)),
        []
    );
});
