import * as fs from 'fs';
import * as path from 'path';
import * as assert from 'assert';

describe("Z80 Fixture Corpora", () => {
    const validDir = path.resolve('test', 'fixtures', 'valid');
    const invalidDir = path.resolve('test', 'fixtures', 'invalid');

    describe("Valid Syntax", () => {
        const files = fs.readdirSync(validDir).filter(f => f.endsWith('.asm'));
        for (const file of files) {
            it(`should contain valid fixture ${file}`, () => {
                const source = fs.readFileSync(path.join(validDir, file), 'utf8');
                assert.ok(source.length > 0, "Fixture must not be empty");
                // TODO: Wire up parser here once implemented
            });
        }
    });

    describe("Invalid Syntax", () => {
        const files = fs.readdirSync(invalidDir).filter(f => f.endsWith('.asm'));
        for (const file of files) {
            it(`should contain invalid fixture ${file}`, () => {
                const source = fs.readFileSync(path.join(invalidDir, file), 'utf8');
                assert.ok(source.length > 0, "Fixture must not be empty");
                // TODO: Wire up parser error assertions here once implemented
            });
        }
    });
});
