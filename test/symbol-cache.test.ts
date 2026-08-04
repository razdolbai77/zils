import { describe, it } from "node:test";
import assert from "node:assert";

import { AsmDocument } from "../src/asm/document";
import { CpuDialect } from "../src/asm/metadata";
import { getSymbolTable } from "../src/asm/symbol-cache";
import { SymbolCollector } from "../src/asm/symbols";

describe("symbol table cache", () => {
    it("returns the same table for the same document instance", () => {
        const document = new AsmDocument("START:\n  jp START\nVALUE equ 3\n", CpuDialect.Z80, true);

        const first = getSymbolTable(document);
        const second = getSymbolTable(document);

        assert.strictEqual(first, second, "repeat lookups must reuse one collection pass");
        assert.deepStrictEqual(first, new SymbolCollector(document).getSymbols());
    });

    it("collects again for a fresh document instance", () => {
        const original = new AsmDocument("OLD_LABEL:\n", CpuDialect.Z80, true);
        const replacement = new AsmDocument("NEW_LABEL:\n", CpuDialect.Z80, true);

        const originalTable = getSymbolTable(original);
        const replacementTable = getSymbolTable(replacement);

        assert.deepStrictEqual(originalTable.map((symbol) => symbol.name), ["OLD_LABEL"]);
        assert.deepStrictEqual(replacementTable.map((symbol) => symbol.name), ["NEW_LABEL"]);
        assert.notStrictEqual(originalTable, replacementTable);
    });
});
