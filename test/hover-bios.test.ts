import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { AsmDocument } from '../src/asm/document';
import { BIOS_ROUTINES, BIOS_VARS, CpuDialect } from '../src/asm/metadata';
import { BIOS_ROUTINE_DESCRIPTIONS } from '../src/asm/bios';
import { BIOS_VARIABLE_DESCRIPTIONS } from '../src/asm/bios-variables';
import { buildHover } from '../src/lsp/hover';

test('hover documents asMSX BIOS routine labels', async () => {
    const uri = pathToFileURL(path.resolve('bios.z80')).href;
    const document = new AsmDocument('.BIOS\n call CHKRAM', CpuDialect.Z80, true);

    const hover = await buildHover(new Map([[uri, document]]), uri, 1, 7);

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
    const uri = pathToFileURL(path.resolve('biosvars.z80')).href;
    const document = new AsmDocument('biosvars\nld hl,CGTABL', CpuDialect.Z80, true);

    const hover = await buildHover(new Map([[uri, document]]), uri, 1, 7);

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
