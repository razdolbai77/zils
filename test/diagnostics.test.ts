import { describe, it } from "node:test";
import assert from "node:assert";
import path from "node:path";
import { indexWorkspace } from "../src/asm/workspace";
import { collectDiagnostics } from "../src/asm/diagnostics";
import { AsmDocument, Diagnostic } from "../src/asm/document";
import { CpuDialect } from "../src/asm/metadata";

describe("Diagnostics", () => {
    it("reports malformed syntax", async () => {
        const overrides = new Map();
        overrides.set(path.resolve("/main.asm"), new AsmDocument("ld a, , b", CpuDialect.Z80));
        const workspace = await indexWorkspace(path.resolve("/main.asm"), overrides);
        
        const diags = collectDiagnostics(workspace, path.resolve("/main.asm"));
        assert.ok(diags.some((d: Diagnostic) => d.message.includes("Wrong operand form")), "Expected malformed syntax diagnostic");
    });

    it("reports unknown instructions", async () => {
        const overrides = new Map();
        overrides.set(path.resolve("/main.asm"), new AsmDocument("fakeinst a, b", CpuDialect.Z80));
        const workspace = await indexWorkspace(path.resolve("/main.asm"), overrides);
        
        const diags = collectDiagnostics(workspace, path.resolve("/main.asm"));
        assert.ok(diags.some((d: Diagnostic) => d.message.includes("Unknown instruction: fakeinst")), "Expected unknown instruction diagnostic");
    });

    it("reports eZ80 instruction in Z80 mode", async () => {
        const overrides = new Map();
        overrides.set(path.resolve("/main.asm"), new AsmDocument("lea hl, ix+1", CpuDialect.Z80));
        const workspace = await indexWorkspace(path.resolve("/main.asm"), overrides);
        
        const diags = collectDiagnostics(workspace, path.resolve("/main.asm"));
        assert.ok(diags.some((d: Diagnostic) => d.message.includes("is not supported in dialect z80")), "Expected dialect diagnostic");
    });

    it("allows eZ80 instruction in eZ80 mode", async () => {
        const overrides = new Map();
        overrides.set(path.resolve("/main.asm"), new AsmDocument("lea hl, ix+1", CpuDialect.EZ80));
        const workspace = await indexWorkspace(path.resolve("/main.asm"), overrides);
        
        const diags = collectDiagnostics(workspace, path.resolve("/main.asm"));
        assert.ok(!diags.some((d: Diagnostic) => d.message.includes("is not supported")), "Should not report dialect diagnostic");
    });

    it("reports unresolved symbols", async () => {
        const overrides = new Map();
        overrides.set(path.resolve("/main.asm"), new AsmDocument("ld a, undefined_sym", CpuDialect.Z80));
        const workspace = await indexWorkspace(path.resolve("/main.asm"), overrides);
        
        const diags = collectDiagnostics(workspace, path.resolve("/main.asm"));
        assert.ok(diags.some((d: Diagnostic) => d.message.includes("Unresolved symbol: undefined_sym")), "Expected unresolved symbol diagnostic");
    });

    it("qualifies local label references for unresolved-symbol diagnostics", async () => {
        const cases = [
            {
                name: "resolved eZ80 local label",
                source: "main:\n  jr @present\n@present:\n  ret",
                dialect: CpuDialect.EZ80,
                isAsmsx: false,
                expectedMessage: null
            },
            {
                name: "missing eZ80 local label",
                source: "main:\n  jr @missing",
                dialect: CpuDialect.EZ80,
                isAsmsx: false,
                expectedMessage: "Unresolved symbol: main@missing"
            },
            {
                name: "resolved asMSX local label",
                source: "main:\n  jp nz,.present\n.present:\n  ret",
                dialect: CpuDialect.Z80,
                isAsmsx: true,
                expectedMessage: null
            },
            {
                name: "missing asMSX local label",
                source: "main:\n  jp nz,.missing",
                dialect: CpuDialect.Z80,
                isAsmsx: true,
                expectedMessage: "Unresolved symbol: main.missing"
            }
        ];

        for (const testCase of cases) {
            const filePath = path.resolve(`/${testCase.name.replace(/\s+/g, "-")}.asm`);
            const overrides = new Map([[filePath, new AsmDocument(testCase.source, testCase.dialect, testCase.isAsmsx)]]);
            const workspace = await indexWorkspace(filePath, overrides, testCase.dialect, testCase.isAsmsx);
            const diagnostics = collectDiagnostics(workspace, filePath);

            if (testCase.expectedMessage === null) {
                assert.ok(!diagnostics.some((d: Diagnostic) => d.message.includes("Unresolved symbol")), `Expected no unresolved-symbol diagnostics for ${testCase.name}`);
                continue;
            }

            assert.ok(diagnostics.some((d: Diagnostic) => d.message.includes(testCase.expectedMessage)), `Expected unresolved-symbol diagnostic for ${testCase.name}`);
        }
    });

    it("enforces agon-ez80asm label lengths and reserved names", async () => {
        const filePath = path.resolve("/agon-labels.ez80");
        const source = [
            `${"g".repeat(32)}:`,
            `@${"l".repeat(31)}:`,
            `${"g".repeat(33)}:`,
            `@${"l".repeat(32)}:`,
            "ld:",
            "db:",
            "nz:"
        ].join("\n");
        const overrides = new Map([[filePath, new AsmDocument(source, CpuDialect.EZ80)]]);
        const workspace = await indexWorkspace(filePath, overrides, CpuDialect.EZ80);
        const diagnostics = collectDiagnostics(workspace, filePath);

        assert.deepEqual(diagnostics.map((diagnostic) => diagnostic.line), [2, 3, 4, 5, 6]);
        assert.match(diagnostics[0].message, /32-character/);
        assert.match(diagnostics[1].message, /32-character/);
        assert.match(diagnostics[2].message, /mnemonic/);
        assert.match(diagnostics[3].message, /directive/);
        assert.match(diagnostics[4].message, /condition/);
    });

    it("reports duplicate symbols", async () => {
        const overrides = new Map();
        overrides.set(path.resolve("/main.asm"), new AsmDocument("dup:\n  nop\ndup:\n  ret", CpuDialect.Z80));
        const workspace = await indexWorkspace(path.resolve("/main.asm"), overrides);
        
        const diags = collectDiagnostics(workspace, path.resolve("/main.asm"));
        assert.ok(diags.some((d: Diagnostic) => d.message.includes("Duplicate symbol definition: dup")), "Expected duplicate symbol diagnostic");
    });

    it("allows assume adl=0 and adl=1 in eZ80 mode", async () => {
        for (const src of ["  assume adl=0", "  assume adl=1"]) {
            const overrides = new Map();
            overrides.set(path.resolve("/main.asm"), new AsmDocument(src, CpuDialect.EZ80));
            const workspace = await indexWorkspace(path.resolve("/main.asm"), overrides);
            const diags = collectDiagnostics(workspace, path.resolve("/main.asm"));
            assert.equal(diags.length, 0, `Expected no diagnostics for '${src}'`);
        }
    });

    it("rejects assume adl=2 (invalid value)", async () => {
        const overrides = new Map();
        overrides.set(path.resolve("/main.asm"), new AsmDocument("  assume adl=2", CpuDialect.EZ80));
        const workspace = await indexWorkspace(path.resolve("/main.asm"), overrides);
        const diags = collectDiagnostics(workspace, path.resolve("/main.asm"));
        assert.ok(diags.some((d: Diagnostic) => d.message.includes("Invalid value for assume 'adl'")), "Expected invalid value diagnostic");
    });

    it("rejects assume with unknown key", async () => {
        const overrides = new Map();
        overrides.set(path.resolve("/main.asm"), new AsmDocument("  assume xyz=1", CpuDialect.EZ80));
        const workspace = await indexWorkspace(path.resolve("/main.asm"), overrides);
        const diags = collectDiagnostics(workspace, path.resolve("/main.asm"));
        assert.ok(diags.some((d: Diagnostic) => d.message.includes("Unknown assume key")), "Expected unknown key diagnostic");
    });

    it("reports unresolved symbol in org operand", async () => {
        const overrides = new Map();
        overrides.set(path.resolve("/main.asm"), new AsmDocument("  org blah", CpuDialect.EZ80));
        const workspace = await indexWorkspace(path.resolve("/main.asm"), overrides);
        const diags = collectDiagnostics(workspace, path.resolve("/main.asm"));
        assert.ok(diags.some((d: Diagnostic) => d.message.includes("Unresolved symbol: blah")), "Expected unresolved symbol diagnostic for org");
    });

    it("reports [register] as wrong indirect syntax in eZ80 mode", async () => {
        const overrides = new Map();
        overrides.set(path.resolve("/main.asm"), new AsmDocument("ld a,[hl]", CpuDialect.EZ80, false));
        const workspace = await indexWorkspace(path.resolve("/main.asm"), overrides);
        const diags = collectDiagnostics(workspace, path.resolve("/main.asm"));
        assert.ok(diags.some((d: Diagnostic) => d.message.includes("Square brackets")), "Expected bracket diagnostic in eZ80 mode");
    });

    it("allows [expression] grouping in eZ80 mode", async () => {
        const overrides = new Map();
        // [val+1] where val is a symbol - no register inside, so this is expression grouping
        overrides.set(path.resolve("/main.asm"), new AsmDocument("MY_SYM equ 5\nld hl,[MY_SYM+1]", CpuDialect.EZ80, false));
        const workspace = await indexWorkspace(path.resolve("/main.asm"), overrides);
        const diags = collectDiagnostics(workspace, path.resolve("/main.asm"));
        assert.ok(!diags.some((d: Diagnostic) => d.message.includes("Square brackets")), "Should not flag [symbol+offset] as wrong indirect syntax");
    });

    it("allows (register-pair) as correct indirect syntax in eZ80 mode", async () => {
        const overrides = new Map();
        overrides.set(path.resolve("/main.asm"), new AsmDocument("ld a,(hl)", CpuDialect.EZ80, false));
        const workspace = await indexWorkspace(path.resolve("/main.asm"), overrides);
        const diags = collectDiagnostics(workspace, path.resolve("/main.asm"));
        assert.equal(diags.length, 0, "Expected no diagnostics for (hl) in eZ80 mode");
    });

    it("reports (8-bit-register) as invalid indirect in eZ80 mode", async () => {
        const overrides = new Map();
        overrides.set(path.resolve("/main.asm"), new AsmDocument("ld a,(h)", CpuDialect.EZ80, false));
        const workspace = await indexWorkspace(path.resolve("/main.asm"), overrides);
        const diags = collectDiagnostics(workspace, path.resolve("/main.asm"));
        assert.ok(diags.some((d: Diagnostic) => d.message.includes("cannot be used for indirect")), "Expected invalid-indirect diagnostic for (h) in eZ80 mode");
    });

    it("reports [8-bit-register] as invalid indirect in eZ80 mode (not a bracket-type error)", async () => {
        const overrides = new Map();
        overrides.set(path.resolve("/main.asm"), new AsmDocument("ld a,[h]", CpuDialect.EZ80, false));
        const workspace = await indexWorkspace(path.resolve("/main.asm"), overrides);
        const diags = collectDiagnostics(workspace, path.resolve("/main.asm"));
        assert.ok(diags.some((d: Diagnostic) => d.message.includes("cannot be used for indirect")), "Expected invalid-indirect diagnostic for [h] in eZ80 mode");
        assert.ok(!diags.some((d: Diagnostic) => d.message.includes("use parentheses")), "Should not suggest fixing brackets when register itself is invalid");
    });

    it("reports (8-bit-register) as invalid indirect in asMSX mode (not a bracket-type error)", async () => {
        const overrides = new Map();
        overrides.set(path.resolve("/main.asm"), new AsmDocument("ld a,(h)", CpuDialect.Z80, true));
        const workspace = await indexWorkspace(path.resolve("/main.asm"), overrides);
        const diags = collectDiagnostics(workspace, path.resolve("/main.asm"));
        assert.ok(diags.some((d: Diagnostic) => d.message.includes("cannot be used for indirect")), "Expected invalid-indirect diagnostic for (h) in asMSX mode");
        assert.ok(!diags.some((d: Diagnostic) => d.message.includes("use square brackets")), "Should not suggest fixing brackets when register itself is invalid");
    });

    it("reports [8-bit-register] as invalid indirect in asMSX mode", async () => {
        const overrides = new Map();
        overrides.set(path.resolve("/main.asm"), new AsmDocument("ld a,[h]", CpuDialect.Z80, true));
        const workspace = await indexWorkspace(path.resolve("/main.asm"), overrides);
        const diags = collectDiagnostics(workspace, path.resolve("/main.asm"));
        assert.ok(diags.some((d: Diagnostic) => d.message.includes("cannot be used for indirect")), "Expected invalid-indirect diagnostic for [h] in asMSX mode");
    });

    it("reports (register) as wrong indirect syntax in asMSX mode", async () => {
        const overrides = new Map();
        overrides.set(path.resolve("/main.asm"), new AsmDocument("ld a,(hl)", CpuDialect.Z80, true));
        const workspace = await indexWorkspace(path.resolve("/main.asm"), overrides);
        const diags = collectDiagnostics(workspace, path.resolve("/main.asm"));
        assert.ok(diags.some((d: Diagnostic) => d.message.includes("Parentheses")), "Expected parentheses diagnostic in asMSX mode");
    });

    it("allows (expression) grouping in asMSX mode", async () => {
        const overrides = new Map();
        overrides.set(path.resolve("/main.asm"), new AsmDocument("MY_SYM equ 5\nld hl,(MY_SYM+1)", CpuDialect.Z80, true));
        const workspace = await indexWorkspace(path.resolve("/main.asm"), overrides);
        const diags = collectDiagnostics(workspace, path.resolve("/main.asm"));
        assert.ok(!diags.some((d: Diagnostic) => d.message.includes("Parentheses")), "Should not flag (symbol+offset) as wrong indirect syntax");
    });

    it("allows [register-pair] as correct indirect syntax in asMSX mode", async () => {
        const filePath = path.resolve("/main.asm");
        const doc = new AsmDocument("  ld a, [hl]", CpuDialect.Z80, true);
        const ws = await indexWorkspace(filePath, new Map([[filePath, doc]]));
        const diags = collectDiagnostics(ws, filePath);
        assert.ok(diags.length === 0, "Should allow [hl] for indirect in asMSX mode");
    });

    it("respects .zilog directive in asMSX mode", async () => {
        const filePath = path.resolve("/main.asm");
        const doc = new AsmDocument("  ld a, [hl]\n.zilog\n  ld a, (hl)\n  ld a, [hl]", CpuDialect.Z80, true);
        const ws = await indexWorkspace(filePath, new Map([[filePath, doc]]));
        const diags = collectDiagnostics(ws, filePath);
        
        // Line 0: [hl] is allowed.
        // Line 1: .zilog
        // Line 2: (hl) is allowed.
        // Line 3: [hl] is an error (Square brackets around a register indicate indirect addressing; use parentheses instead)
        
        const line3Errors = diags.filter((d: Diagnostic) => d.line === 3);
        assert.ok(line3Errors.some((d: Diagnostic) => d.message.includes("use parentheses instead")), "Expected error for [hl] after .zilog directive");
        
        const line2Errors = diags.filter((d: Diagnostic) => d.line === 2);
        assert.ok(line2Errors.length === 0, "Should allow (hl) after .zilog directive");
    });

    it("reports invalid rotate operands in asMSX mode", async () => {
        const filePath = path.resolve("/main.asm");
        const doc = new AsmDocument("rl de", CpuDialect.Z80, true);
        const ws = await indexWorkspace(filePath, new Map([[filePath, doc]]), CpuDialect.Z80, true);
        const diags = collectDiagnostics(ws, filePath);

        assert.ok(diags.some((d: Diagnostic) => d.message.includes("Operand 1 of 'rl'")), "Expected invalid rotate operand diagnostic in asMSX mode");
    });

    it("reports unknown dotted directives with the dotted range", async () => {
        const filePath = path.resolve("/main.asm");
        const doc = new AsmDocument(".ogr 100", CpuDialect.Z80, true);
        const ws = await indexWorkspace(filePath, new Map([[filePath, doc]]), CpuDialect.Z80, true);
        const diags = collectDiagnostics(ws, filePath);

        assert.deepEqual(diags, [
            {
                line: 0,
                message: "Unknown directive: .ogr",
                startCharacter: 0,
                length: 4
            }
        ]);
    });

    it("reports invalid offset addressing (e.g. de+4) in eZ80 mode", async () => {
        const overrides = new Map();
        overrides.set(path.resolve("/main.asm"), new AsmDocument("ld a,(de+4)", CpuDialect.EZ80, false));
        const workspace = await indexWorkspace(path.resolve("/main.asm"), overrides);
        const diags = collectDiagnostics(workspace, path.resolve("/main.asm"));
        assert.ok(diags.some((d: Diagnostic) => d.message.includes("offset")), "Expected diagnostic for (de+4) in eZ80 mode");
    });

    it("reports invalid offset addressing (e.g. [bc-1]) in asMSX mode", async () => {
        const overrides = new Map();
        overrides.set(path.resolve("/main.asm"), new AsmDocument("ld a,[bc-1]", CpuDialect.Z80, true));
        const workspace = await indexWorkspace(path.resolve("/main.asm"), overrides);
        const diags = collectDiagnostics(workspace, path.resolve("/main.asm"));
        assert.ok(diags.some((d: Diagnostic) => d.message.includes("offset")), "Expected diagnostic for [bc-1] in asMSX mode");
    });

    it("does not range-check absolute jr targets without a program counter", async () => {
        const filePath = path.resolve("/main.asm");
        const doc = new AsmDocument("org $8000\njr $8010", CpuDialect.Z80, true);
        const ws = await indexWorkspace(filePath, new Map([[filePath, doc]]), CpuDialect.Z80, true);
        const diags = collectDiagnostics(ws, filePath);

        assert.ok(!diags.some((d: Diagnostic) => d.message.includes("Relative offset")), "Expected no false relative-range diagnostic for absolute jr target");
    });

    it("rejects unsupported jr condition codes in asMSX mode", async () => {
        const filePath = path.resolve("/main.asm");
        const doc = new AsmDocument("jr p, somewhere", CpuDialect.Z80, true);
        const ws = await indexWorkspace(filePath, new Map([[filePath, doc]]), CpuDialect.Z80, true);
        const diags = collectDiagnostics(ws, filePath);

        assert.ok(diags.some((d: Diagnostic) => d.message.includes("Operand 1 of 'jr' must be NZ/Z/NC/C")), "Expected invalid jr condition code diagnostic");
    });
    it("allows the supported jr condition codes in asMSX mode", async () => {
        const filePath = path.resolve("/main.asm");
        const doc = new AsmDocument("jr c, somewhere", CpuDialect.Z80, true);
        const ws = await indexWorkspace(filePath, new Map([[filePath, doc]]), CpuDialect.Z80, true);
        const diags = collectDiagnostics(ws, filePath);

        assert.ok(!diags.some((d: Diagnostic) => d.message.includes("Operand 1 of 'jr'")), "Expected c to be a valid jr condition code");
    });


    it("allows ix/iy offset addressing (e.g. (ix+5)) in eZ80 mode", async () => {
        const overrides = new Map();
        overrides.set(path.resolve("/main.asm"), new AsmDocument("ld a,(ix+5)", CpuDialect.EZ80, false));
        const workspace = await indexWorkspace(path.resolve("/main.asm"), overrides);
        const diags = collectDiagnostics(workspace, path.resolve("/main.asm"));
        assert.equal(diags.length, 0, "Expected no diagnostics for (ix+5) in eZ80 mode");
    });

    it("allows ix/iy offset addressing (e.g. [iy-3]) in asMSX mode", async () => {
        const overrides = new Map();
        overrides.set(path.resolve("/main.asm"), new AsmDocument("ld a,[iy-3]", CpuDialect.Z80, true));
        const workspace = await indexWorkspace(path.resolve("/main.asm"), overrides);
        const diags = collectDiagnostics(workspace, path.resolve("/main.asm"));
        assert.equal(diags.length, 0, "Expected no diagnostics for [iy-3] in asMSX mode");
    });

    it("reports invalid operands when multiple indirect operands are used inappropriately in eZ80 mode", async () => {
        const overrides = new Map();
        overrides.set(path.resolve("/main.asm"), new AsmDocument("ld (iy+4),(de)", CpuDialect.EZ80, false));
        const workspace = await indexWorkspace(path.resolve("/main.asm"), overrides);
        const diags = collectDiagnostics(workspace, path.resolve("/main.asm"));
        assert.ok(diags.length > 0, "Expected diagnostic for invalid multiple indirect operands");
    });

    it("reports invalid operands when multiple indirect operands are used inappropriately in asMSX mode", async () => {
        const overrides = new Map();
        overrides.set(path.resolve("/main.asm"), new AsmDocument("ld [iy+4],[de]", CpuDialect.Z80, true));
        const workspace = await indexWorkspace(path.resolve("/main.asm"), overrides);
        const diags = collectDiagnostics(workspace, path.resolve("/main.asm"));
        assert.ok(diags.length > 0, "Expected diagnostic for invalid multiple indirect operands");
    });

    it("allows valid syntax", async () => {
        const overrides = new Map();
        overrides.set(path.resolve("/main.asm"), new AsmDocument("start:\n  ld a, b\n  ret\n", CpuDialect.Z80));
        const workspace = await indexWorkspace(path.resolve("/main.asm"), overrides);
        
        const diags = collectDiagnostics(workspace, path.resolve("/main.asm"));
        assert.equal(diags.length, 0, "Expected no diagnostics for valid syntax");
    });

    it("evaluates skip and size expressions for incbin/insert and respects boundaries", async () => {
        const overrides = new Map();
        overrides.set(path.resolve("/main.asm"), new AsmDocument(`
            incbin "file1.bin" skip -1 size 10
            incbin "file2.bin" skip 0 size 0
            insert "file3.bin" skip 5+5 size 10*2
        `, CpuDialect.Z80, true));
        const workspace = await indexWorkspace(path.resolve("/main.asm"), overrides);
        const diags = collectDiagnostics(workspace, path.resolve("/main.asm"));
        
        assert.ok(diags.some((d: Diagnostic) => d.message.includes("SKIP parameter cannot be negative")), "Expected diagnostic for skip < 0");
        assert.ok(diags.some((d: Diagnostic) => d.message.includes("SIZE parameter must be strictly positive")), "Expected diagnostic for size <= 0");
        assert.equal(diags.filter((d: Diagnostic) => d.line === 3).length, 0, "Expected no diagnostics for valid expressions");
    });

    it("reports empty operands for directives instead of throwing", async () => {
        const cases = [
            "include ,",
            "cas ,",
            "megarom ,",
            "incbin ,"
        ];

        for (const [index, source] of cases.entries()) {
            const filePath = path.resolve(`/case-${index}.asm`);
            const overrides = new Map([[filePath, new AsmDocument(source, CpuDialect.Z80, true)]]);
            const workspace = await indexWorkspace(filePath, overrides);

            assert.doesNotThrow(() => collectDiagnostics(workspace, filePath), `Expected diagnostics for "${source}" without throwing`);

            const diagnostics = collectDiagnostics(workspace, filePath);
            assert.equal(diagnostics.length, 1, `Expected exactly one diagnostic for "${source}"`);
            assert.match(diagnostics[0].message, /empty operand/i, `Expected empty-operand diagnostic for "${source}"`);
            assert.notEqual(diagnostics[0].startCharacter, undefined, `Expected bounded diagnostic start for "${source}"`);
            assert.notEqual(diagnostics[0].length, undefined, `Expected bounded diagnostic length for "${source}"`);
        }
    });

    it("rejects strings as numeric instruction operands while allowing string directives", async () => {
        const filePath = path.resolve("/string-operands.asm");
        const source = [
            'ld a, "x"',
            'jp "x"',
            'bit "x", a',
            'db "x"',
            'include "x.asm"'
        ].join("\n");
        const overrides = new Map([[filePath, new AsmDocument(source, CpuDialect.Z80, true)]]);
        const workspace = await indexWorkspace(filePath, overrides);

        const diagnostics = collectDiagnostics(workspace, filePath);

        assert.ok(diagnostics.some((d: Diagnostic) => d.line === 0), "Expected instruction diagnostic for ld a, string");
        assert.ok(diagnostics.some((d: Diagnostic) => d.line === 1), "Expected instruction diagnostic for jp string");
        assert.ok(diagnostics.some((d: Diagnostic) => d.line === 2), "Expected instruction diagnostic for bit string, a");
        assert.equal(diagnostics.filter((d: Diagnostic) => d.line === 3).length, 0, "Expected db string operand to remain valid");
        assert.equal(diagnostics.filter((d: Diagnostic) => d.line === 4).length, 0, "Expected include string operand to remain valid");
    });
    it("rejects invalid escapes in eZ80 strings while allowing documented escapes", async () => {
        const filePath = path.resolve("/string-escapes.ez80");
        const source = [
            String.raw`  db "valid\n\t\"\\\?"`,
            String.raw`  db "invalid\q"`,
            String.raw`  include "dir\data.asm"`
        ].join("\n");
        const overrides = new Map([[filePath, new AsmDocument(source, CpuDialect.EZ80)]]);
        const workspace = await indexWorkspace(filePath, overrides, CpuDialect.EZ80);
        const diagnostics = collectDiagnostics(workspace, filePath);

        assert.deepEqual(diagnostics.map((diagnostic) => diagnostic.line), [1]);
        assert.match(diagnostics[0].message, /Invalid escape sequence/);
    });
    it("rejects invalid asMSX character-literal escapes", async () => {
        const filePath = path.resolve("/asmsx-character-escape.z80");
        const overrides = new Map([[filePath, new AsmDocument(String.raw`db '\q'`, CpuDialect.Z80, true)]]);
        const workspace = await indexWorkspace(filePath, overrides, CpuDialect.Z80, true);
        const diagnostics = collectDiagnostics(workspace, filePath);

        assert.deepEqual(diagnostics.map((diagnostic) => diagnostic.line), [0]);
        assert.match(diagnostics[0].message, /Invalid escape sequence/);
    });
    it("reports unterminated asMSX block comments", async () => {
        const filePath = path.resolve("/unterminated-comment.z80");
        const overrides = new Map([[filePath, new AsmDocument("/* missing end", CpuDialect.Z80, true)]]);
        const workspace = await indexWorkspace(filePath, overrides, CpuDialect.Z80, true);
        const diagnostics = collectDiagnostics(workspace, filePath);

        assert.deepEqual(diagnostics.map((diagnostic) => diagnostic.line), [0]);
        assert.deepEqual(diagnostics[0], {
            line: 0,
            message: "Unterminated block comment",
            startCharacter: 0,
            length: 14
        });
    });
    it("allows single-quoted character literals as 8-bit instruction operands", async () => {
        const filePath = path.resolve("/character-operands.asm");
        const overrides = new Map([[filePath, new AsmDocument("ld a, 'A'", CpuDialect.Z80, true)]]);
        const workspace = await indexWorkspace(filePath, overrides);

        const diagnostics = collectDiagnostics(workspace, filePath);

        assert.equal(diagnostics.length, 0, "Expected character literal to be accepted as an 8-bit constant");
    });
    it("allows ez80 character escape literals as 8-bit operands", async () => {
        const filePath = path.resolve("/ez80-character-operands.asm");
        const source = String.raw`ld a, '\n'`;
        const overrides = new Map([[filePath, new AsmDocument(source, CpuDialect.EZ80)]]);
        const workspace = await indexWorkspace(filePath, overrides);

        const diagnostics = collectDiagnostics(workspace, filePath);

        assert.equal(diagnostics.length, 0, "Expected escaped character literal to be accepted");
    });
    it("validates eZ80 LEA destination and index register operands", async () => {
        const filePath = path.resolve("/lea-operands.ez80");
        const source = [
            "lea bc, ix+5",
            "lea de, iy-2",
            "lea hl, ix+0",
            "lea a, ix+1",
            "lea ix, iy+1",
            "lea sp, ix+1",
            "lea hl, hl+1"
        ].join("\n");
        const overrides = new Map([[filePath, new AsmDocument(source, CpuDialect.EZ80)]]);
        const workspace = await indexWorkspace(filePath, overrides, CpuDialect.EZ80);

        const diagnostics = collectDiagnostics(workspace, filePath);

        assert.deepEqual(diagnostics.map((diagnostic) => diagnostic.line), [3, 4, 5, 6]);
    });
    it("allows eZ80 anonymous next and previous aliases", async () => {
        const filePath = path.resolve("/anonymous-aliases.ez80");
        const source = ["@@:", "  jr @n", "@@:", "  jr @p"].join("\n");
        const overrides = new Map([[filePath, new AsmDocument(source, CpuDialect.EZ80)]]);
        const workspace = await indexWorkspace(filePath, overrides, CpuDialect.EZ80);

        assert.deepEqual(collectDiagnostics(workspace, filePath), []);
    });
    it("enforces eZ80 CPU directive state across dotted and undotted forms", async () => {
        const filePath = path.resolve("/cpu-state.ez80");
        const source = [
            ".cpu z80",
            "in0 a,(1)",
            "  cpu z180",
            "in0 a,(1)",
            ".cpu ez80",
            "lea hl,ix+1",
            "  cpu z180",
            "lea hl,ix+1"
        ].join("\n");
        const overrides = new Map([[filePath, new AsmDocument(source, CpuDialect.EZ80)]]);
        const workspace = await indexWorkspace(filePath, overrides, CpuDialect.EZ80);

        const diagnostics = collectDiagnostics(workspace, filePath);

        assert.deepEqual(diagnostics.map((diagnostic) => diagnostic.line), [1, 7]);
        assert.ok(diagnostics.every((diagnostic) => diagnostic.message.includes("CPU")));
    });
    it("accepts undocumented Z80 SLL and index-byte register forms only under CPU Z80", async () => {
        const filePath = path.resolve("/undocumented-z80-opcodes.ez80");
        const source = [
            "  cpu z80",
            "sll b",
            "sll (ix+1)",
            "ld ixh,b",
            "ld a,ixl",
            "ld iyh,$42",
            "ld e,iyl",
            "add a,ixh",
            "adc a,iyl",
            "sub ixl",
            "sbc a,iyh",
            "and ixh",
            "xor ixl",
            "or iyh",
            "cp iyl",
            "inc ixh",
            "dec iyl",
            "  cpu z180",
            "sll b",
            "ld ixh,b",
            "  cpu ez80",
            "sll (iy+1)",
            "add a,iyh"
        ].join("\n");
        const overrides = new Map([[filePath, new AsmDocument(source, CpuDialect.EZ80)]]);
        const workspace = await indexWorkspace(filePath, overrides, CpuDialect.EZ80);

        const diagnostics = collectDiagnostics(workspace, filePath);

        assert.deepEqual(diagnostics.map((diagnostic) => diagnostic.line), [18, 19, 21, 22]);
        assert.ok(diagnostics.every((diagnostic) => diagnostic.message.includes("CPU")));
    });
    it("accepts Z180 block I/O only under CPU Z180 or EZ80 and rejects operands", async () => {
        const filePath = path.resolve("/z180-block-io.ez80");
        const source = [
            "  cpu z80",
            "otim",
            "otimr",
            "otdm",
            "otdmr",
            "  cpu z180",
            "otim",
            "otimr",
            "otdm",
            "otdmr",
            "  cpu ez80",
            "otim",
            "otimr",
            "otdm",
            "otdmr",
            "otim a"
        ].join("\n");
        const overrides = new Map([[filePath, new AsmDocument(source, CpuDialect.EZ80)]]);
        const workspace = await indexWorkspace(filePath, overrides, CpuDialect.EZ80);

        const diagnostics = collectDiagnostics(workspace, filePath);

        assert.deepEqual(diagnostics.map((diagnostic) => diagnostic.line), [1, 2, 3, 4, 15]);
        assert.ok(diagnostics.slice(0, 4).every((diagnostic) => diagnostic.message.includes("CPU")));
        assert.match(diagnostics[4].message, /expects 0 operands/);
    });
    it("accepts eZ80 memory-addressed block I/O while retaining shared Z180 output forms", async () => {
        const filePath = path.resolve("/ez80-memory-block-io.ez80");
        const source = [
            "  cpu z80",
            "inim",
            "inimr",
            "indm",
            "indmr",
            "otim",
            "otimr",
            "otdm",
            "otdmr",
            "  cpu z180",
            "inim",
            "inimr",
            "indm",
            "indmr",
            "otim",
            "otimr",
            "otdm",
            "otdmr",
            "  cpu ez80",
            "inim",
            "inimr",
            "indm",
            "indmr",
            "otim",
            "otimr",
            "otdm",
            "otdmr",
            "inim a"
        ].join("\n");
        const overrides = new Map([[filePath, new AsmDocument(source, CpuDialect.EZ80)]]);
        const workspace = await indexWorkspace(filePath, overrides, CpuDialect.EZ80);

        const diagnostics = collectDiagnostics(workspace, filePath);

        assert.deepEqual(diagnostics.map((diagnostic) => diagnostic.line), [1, 2, 3, 4, 5, 6, 7, 8, 10, 11, 12, 13, 27]);
        assert.ok(diagnostics.slice(0, 12).every((diagnostic) => diagnostic.message.includes("CPU")));
        assert.match(diagnostics[12].message, /expects 0 operands/);
    });
    it("accepts eZ80 extended block I/O only under CPU EZ80 and removes invalid permutations", async () => {
        const filePath = path.resolve("/ez80-extended-block-io.ez80");
        const mnemonics = ["ini2r", "ind2r", "oti2r", "otd2r", "inirx", "indrx", "otirx", "otdrx"];
        const source = [
            "  cpu z80",
            ...mnemonics,
            "  cpu z180",
            ...mnemonics,
            "  cpu ez80",
            ...mnemonics,
            "ini2r a",
            "inir2",
            "indr2",
            "otir2",
            "otdr2"
        ].join("\n");
        const overrides = new Map([[filePath, new AsmDocument(source, CpuDialect.EZ80)]]);
        const workspace = await indexWorkspace(filePath, overrides, CpuDialect.EZ80);

        const diagnostics = collectDiagnostics(workspace, filePath);

        assert.deepEqual(diagnostics.map((diagnostic) => diagnostic.line), [
            1, 2, 3, 4, 5, 6, 7, 8,
            10, 11, 12, 13, 14, 15, 16, 17,
            27, 28, 29, 30, 31
        ]);
        assert.ok(diagnostics.slice(0, 16).every((diagnostic) => diagnostic.message.includes("CPU")));
        assert.match(diagnostics[16].message, /expects 0 operands/);
        assert.ok(diagnostics.slice(17).every((diagnostic) => diagnostic.message.includes("Unknown instruction")));
    });
    it("accepts documented agon-ez80asm data directives", async () => {
        const filePath = path.resolve("/agon-data-directives.ez80");
        const source = [
            "  ascii \"text\"",
            "  asciz \"text\",0",
            "  byte 'A'",
            "  blkb 16",
            "  blkw 16,0",
            "  blkp 16,$ffffff",
            "  blkl 16,0",
            "  dw24 $123456",
            "  dw32 $12345678",
            "  fillbyte $ff"
        ].join("\n");
        const overrides = new Map([[filePath, new AsmDocument(source, CpuDialect.EZ80)]]);
        const workspace = await indexWorkspace(filePath, overrides, CpuDialect.EZ80);
        assert.deepEqual(collectDiagnostics(workspace, filePath), []);
    });

    it("validates eZ80 data, reservation, alignment, macro, and terminator operands", async () => {
        const filePath = path.resolve("/ez80-directive-operands.ez80");
        const source = [
            "  db",
            "  db 256",
            "  dw 65536",
            "  dl $1000000",
            "  ds 1,256",
            "  align 0",
            "  align 4,256",
            "  fillbyte 256",
            "  blkb",
            "  blkw 1,65536",
            "  macro",
            "good: macro",
            "  endm 1",
            "other: macro",
            "  endmacro 1"
        ].join("\n");
        const overrides = new Map([[filePath, new AsmDocument(source, CpuDialect.EZ80)]]);
        const workspace = await indexWorkspace(filePath, overrides, CpuDialect.EZ80);
        const diagnostics = collectDiagnostics(workspace, filePath);

        assert.deepEqual(diagnostics.map((diagnostic) => diagnostic.line), [
            0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 14
        ]);
    });

    it("validates asMSX FPOS and reservation directive operands", async () => {
        const filePath = path.resolve("/asmsx-reservation-operands.z80");
        const source = [
            "  fpos -1",
            "rb 1",
            "field rb",
            "word rw -1",
            "long rl 1,2",
            "space rs \"x\""
        ].join("\n");
        const overrides = new Map([[filePath, new AsmDocument(source, CpuDialect.Z80, true)]]);
        const workspace = await indexWorkspace(filePath, overrides, CpuDialect.Z80, true);
        const diagnostics = collectDiagnostics(workspace, filePath);

        assert.deepEqual(diagnostics.map((diagnostic) => diagnostic.line), [0, 1, 2, 3, 4, 5]);
    });

    it("accepts documented asMSX data aliases and validates reservation and random syntax", async () => {
        const filePath = path.resolve("/asmsx-data-directives.z80");
        const source = [
            '  dt "text"',
            '  deft "more"',
            "  .byte",
            "  .word",
            "  db .random(8)",
            "  .byte 1",
            "  .word 1",
            "  db .random()"
        ].join("\n");
        const overrides = new Map([[filePath, new AsmDocument(source, CpuDialect.Z80, true)]]);
        const workspace = await indexWorkspace(filePath, overrides, CpuDialect.Z80, true);
        const diagnostics = collectDiagnostics(workspace, filePath);

        assert.deepEqual(diagnostics.map((diagnostic) => diagnostic.line), [5, 6, 7]);
        assert.ok(diagnostics[0].message.includes("does not take any operands"));
        assert.ok(diagnostics[1].message.includes("does not take any operands"));
        assert.ok(diagnostics[2].message.includes("arity"));
    });

    it("rejects removed non-spec agon data aliases", async () => {
        const filePath = path.resolve("/agon-data-aliases.ez80");
        const source = "  dl24 1\n  ds24 1";
        const overrides = new Map([[filePath, new AsmDocument(source, CpuDialect.EZ80)]]);
        const workspace = await indexWorkspace(filePath, overrides, CpuDialect.EZ80);

        assert.deepEqual(collectDiagnostics(workspace, filePath).map((diagnostic) => diagnostic.line), [0, 1]);
    });

    it("recognizes relocate/endrelocate blocks in eZ80 mode", async () => {
        const filePath = path.resolve("/relocate-block.ez80");
        const source = [
            "  relocate",
            "  ld a,1",
            "  endrelocate",
        ].join("\n");
        const overrides = new Map([[filePath, new AsmDocument(source, CpuDialect.EZ80)]]);
        const workspace = await indexWorkspace(filePath, overrides, CpuDialect.EZ80);

        assert.deepEqual(collectDiagnostics(workspace, filePath), []);
    });

    it("diagnoses unmatched endrelocate", async () => {
        const filePath = path.resolve("/unmatched-endrelocate.ez80");
        const source = "  endrelocate";
        const overrides = new Map([[filePath, new AsmDocument(source, CpuDialect.EZ80)]]);
        const workspace = await indexWorkspace(filePath, overrides, CpuDialect.EZ80);

        const diagnostics = collectDiagnostics(workspace, filePath);
        assert.equal(diagnostics.length, 1);
        assert.ok(diagnostics[0].message.includes("ENDRELOCATE"));
    });

    it("diagnoses unmatched relocate", async () => {
        const filePath = path.resolve("/unmatched-relocate.ez80");
        const source = "  relocate\n  ld a,1";
        const overrides = new Map([[filePath, new AsmDocument(source, CpuDialect.EZ80)]]);
        const workspace = await indexWorkspace(filePath, overrides, CpuDialect.EZ80);

        const diagnostics = collectDiagnostics(workspace, filePath);
        assert.equal(diagnostics.length, 1);
        assert.ok(diagnostics[0].message.includes("RELOCATE"));
    });

    it("diagnoses nested relocate blocks", async () => {
        const filePath = path.resolve("/nested-relocate.ez80");
        const source = [
            "  relocate",
            "  relocate",
            "  endrelocate",
            "  endrelocate"
        ].join("\n");
        const overrides = new Map([[filePath, new AsmDocument(source, CpuDialect.EZ80)]]);
        const workspace = await indexWorkspace(filePath, overrides, CpuDialect.EZ80);

        const diagnostics = collectDiagnostics(workspace, filePath);
        assert.equal(diagnostics.length, 1);
        assert.ok(diagnostics[0].message.toLowerCase().includes("nest"));
    });

    it("suppresses diagnostics inside inactive IF/ELSE/ENDIF blocks", async () => {
        const filePath = path.resolve("/if-block.ez80");
        const source = [
            "  if 0",
            "  totally_fake_instruction",
            "  ld a,nonexistent_label",
            "  else",
            "  another_fake_instr", // This is active, so it should error
            "  endif"
        ].join("\n");
        const overrides = new Map([[filePath, new AsmDocument(source, CpuDialect.EZ80)]]);
        const workspace = await indexWorkspace(filePath, overrides, CpuDialect.EZ80);

        const diagnostics = collectDiagnostics(workspace, filePath);
        assert.equal(diagnostics.length, 1);
        assert.ok(diagnostics[0].message.includes("another_fake_instr"));
    });

    it("diagnoses unmatched ENDIF", async () => {
        const filePath = path.resolve("/unmatched-endif.ez80");
        const source = "  endif";
        const overrides = new Map([[filePath, new AsmDocument(source, CpuDialect.EZ80)]]);
        const workspace = await indexWorkspace(filePath, overrides, CpuDialect.EZ80);

        const diagnostics = collectDiagnostics(workspace, filePath);
        assert.equal(diagnostics.length, 1);
        assert.ok(diagnostics[0].message.includes("ENDIF"));
    });

    it("diagnoses unmatched IF", async () => {
        const filePath = path.resolve("/unmatched-if.ez80");
        const source = "  if 1\n  ld a,1";
        const overrides = new Map([[filePath, new AsmDocument(source, CpuDialect.EZ80)]]);
        const workspace = await indexWorkspace(filePath, overrides, CpuDialect.EZ80);

        const diagnostics = collectDiagnostics(workspace, filePath);
        assert.equal(diagnostics.length, 1);
        assert.ok(diagnostics[0].message.includes("IF"));
    });

    it("diagnoses unmatched ELSE", async () => {
        const filePath = path.resolve("/unmatched-else.ez80");
        const source = "  else";
        const overrides = new Map([[filePath, new AsmDocument(source, CpuDialect.EZ80)]]);
        const workspace = await indexWorkspace(filePath, overrides, CpuDialect.EZ80);

        const diagnostics = collectDiagnostics(workspace, filePath);
        assert.equal(diagnostics.length, 1);
        assert.ok(diagnostics[0].message.includes("ELSE"));
    });

    it("recognizes ENDMACRO as macro terminator", async () => {
        const filePath = path.resolve("/endmacro.ez80");
        const source = [
            "my_macro: macro",
            "  ld a,1",
            "  endmacro"
        ].join("\n");
        const overrides = new Map([[filePath, new AsmDocument(source, CpuDialect.EZ80)]]);
        const workspace = await indexWorkspace(filePath, overrides, CpuDialect.EZ80);

        assert.deepEqual(collectDiagnostics(workspace, filePath), []);
    });

    it("suppresses diagnostics inside macro body", async () => {
        const filePath = path.resolve("/macro-body.ez80");
        const source = [
            "my_macro: macro",
            "  totally_fake_instruction",
            "  nonexistent_label",
            "  endm"
        ].join("\n");
        const overrides = new Map([[filePath, new AsmDocument(source, CpuDialect.EZ80)]]);
        const workspace = await indexWorkspace(filePath, overrides, CpuDialect.EZ80);

        assert.deepEqual(collectDiagnostics(workspace, filePath), []);
    });

    it("does not report macro calls as unknown instructions", async () => {
        const filePath = path.resolve("/macro-call.ez80");
        const source = [
            "my_macro: macro",
            "  ld a,1",
            "  endm",
            "  my_macro"
        ].join("\n");
        const overrides = new Map([[filePath, new AsmDocument(source, CpuDialect.EZ80)]]);
        const workspace = await indexWorkspace(filePath, overrides, CpuDialect.EZ80);

        assert.deepEqual(collectDiagnostics(workspace, filePath), []);
    });

    it("recognizes asMSX macro declarations and #parameters", async () => {
        const filePath = path.resolve("/asmsx-macro.asm");
        const source = [
            "my_macro: macro #arg1, #arg2",
            "  ld a, #arg1",
            "  ld b, #arg2",
            "  endm"
        ].join("\n");
        const overrides = new Map([[filePath, new AsmDocument(source, CpuDialect.Z80)]]);
        const workspace = await indexWorkspace(filePath, overrides, CpuDialect.Z80);

        assert.deepEqual(collectDiagnostics(workspace, filePath), []);
    });

    it("requires # prefixes for asMSX macro parameters", async () => {
        const filePath = path.resolve("/asmsx-macro-parameters.asm");
        const source = [
            "my_macro: macro arg, #valid",
            "  endm"
        ].join("\n");
        const overrides = new Map([[filePath, new AsmDocument(source, CpuDialect.Z80, true)]]);
        const workspace = await indexWorkspace(filePath, overrides, CpuDialect.Z80, true);
        const diagnostics = collectDiagnostics(workspace, filePath);

        assert.deepEqual(diagnostics, [{
            line: 0,
            message: "asMSX MACRO parameter must start with '#'",
            startCharacter: 16,
            length: 3
        }]);
    });

    it("does not report macro calls as unknown instructions in asMSX mode", async () => {
        const filePath = path.resolve("/asmsx-macro-call.asm");
        const source = [
            "my_macro: macro #arg",
            "  ld a, #arg",
            "  endm",
            "  my_macro 1"
        ].join("\n");
        const overrides = new Map([[filePath, new AsmDocument(source, CpuDialect.Z80)]]);
        const workspace = await indexWorkspace(filePath, overrides, CpuDialect.Z80);

        assert.deepEqual(collectDiagnostics(workspace, filePath), []);
    });

    it("rejects mixed-case asMSX macro calls", async () => {
        const filePath = path.resolve("/asmsx-mixed-case-macro-call.asm");
        const source = [
            "OneMacro: macro #arg",
            "  ld a, #arg",
            "  endm",
            "  oneMacro 1"
        ].join("\n");
        const overrides = new Map([[filePath, new AsmDocument(source, CpuDialect.Z80, true)]]);
        const workspace = await indexWorkspace(filePath, overrides, CpuDialect.Z80, true);

        assert.deepEqual(collectDiagnostics(workspace, filePath), [{
            line: 3,
            message: "Unknown instruction: onemacro",
            startCharacter: 2,
            length: 8
        }]);
    });

    it("recognizes macro-local labels starting with ..", async () => {
        const filePath = path.resolve("/macro-local-labels.asm");
        const source = [
            "my_macro: macro",
            "..local_label:",
            "  jr ..local_label",
            "  endm",
            "  my_macro"
        ].join("\n");
        const overrides = new Map([[filePath, new AsmDocument(source, CpuDialect.Z80)]]);
        const workspace = await indexWorkspace(filePath, overrides, CpuDialect.Z80);

        assert.deepEqual(collectDiagnostics(workspace, filePath), []);
    });

    it("diagnoses unmatched ENDMACRO", async () => {
        const filePath = path.resolve("/unmatched-endmacro.ez80");
        const source = "  endmacro";
        const overrides = new Map([[filePath, new AsmDocument(source, CpuDialect.EZ80)]]);
        const workspace = await indexWorkspace(filePath, overrides, CpuDialect.EZ80);

        const diagnostics = collectDiagnostics(workspace, filePath);
        assert.equal(diagnostics.length, 1);
        assert.ok(diagnostics[0].message.includes("ENDMACRO"));
    });

    it("does not report unknown instructions for asMSX integer assignments", async () => {
        const filePath = path.resolve("/assignments.asm");
        const source = [
            "Value1=5",
            ".Value2 = Value1+1"
        ].join("\n");
        const overrides = new Map([[filePath, new AsmDocument(source, CpuDialect.Z80)]]);
        const workspace = await indexWorkspace(filePath, overrides, CpuDialect.Z80);

        assert.deepEqual(collectDiagnostics(workspace, filePath), []);
    });

    it("evaluates asMSX IFDEF/IF/ELSE/ENDIF conditionals and suppresses inactive branches", async () => {
        const filePath = path.resolve("/conditionals.asm");
        const source = [
            "DEFINED_SYM = 1",
            "  ifdef DEFINED_SYM",
            "ACTIVE_1:",
            "  else",
            "ACTIVE_1:", // duplicate in inactive branch should be ignored
            "  endif",
            "  ifdef UNDEFINED_SYM",
            "INACTIVE_1:",
            "  else",
            "INACTIVE_1:",
            "  endif",
            "  if DEFINED_SYM = 1",
            "ACTIVE_2:",
            "  else",
            "ACTIVE_2:",
            "  endif",
            "  if 0",
            "INACTIVE_2:",
            "  else",
            "INACTIVE_2:",
            "  endif",
        ].join("\n");
        const overrides = new Map([[filePath, new AsmDocument(source, CpuDialect.Z80, true)]]);
        const workspace = await indexWorkspace(filePath, overrides, CpuDialect.Z80);

        assert.deepEqual(collectDiagnostics(workspace, filePath), []);
    });
});
