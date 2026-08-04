import { describe, it } from "node:test";
import assert from "node:assert";
import path from "node:path";
import { indexWorkspace, IndexedWorkspace, pathKey } from "../src/asm/workspace";
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

    it("reports the same arity error for trailing and leading comma operands", async () => {
        const trailingOverrides = new Map();
        trailingOverrides.set(path.resolve("/main.asm"), new AsmDocument("ld a,", CpuDialect.Z80));
        const trailingWorkspace = await indexWorkspace(path.resolve("/main.asm"), trailingOverrides);
        const trailingDiags = collectDiagnostics(trailingWorkspace, path.resolve("/main.asm"));

        const leadingOverrides = new Map();
        leadingOverrides.set(path.resolve("/main.asm"), new AsmDocument("ld ,b", CpuDialect.Z80));
        const leadingWorkspace = await indexWorkspace(path.resolve("/main.asm"), leadingOverrides);
        const leadingDiags = collectDiagnostics(leadingWorkspace, path.resolve("/main.asm"));

        assert.ok(trailingDiags.length > 0, "Expected diagnostics for trailing comma");
        assert.ok(leadingDiags.length > 0, "Expected diagnostics for leading comma");
        assert.deepEqual(trailingDiags, leadingDiags);
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
    it("allows POP IX and POP IY in both dialects", async () => {
        for (const dialect of [CpuDialect.Z80, CpuDialect.EZ80]) {
            const filePath = path.resolve(`/pop-index-${dialect}.asm`);
            const document = new AsmDocument("  pop ix\n  pop iy", dialect);
            const workspace = await indexWorkspace(filePath, new Map([[filePath, document]]), dialect);

            assert.deepEqual(collectDiagnostics(workspace, filePath), []);
        }
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

    it("allows asMSX local branch targets", async () => {
        const filePath = path.resolve("/asmsx-local-branch.asm");
        const source = [
            "main:",
            ".local_label:",
            "  jr .local_label"
        ].join("\n");
        const overrides = new Map([[filePath, new AsmDocument(source, CpuDialect.Z80, true)]]);
        const workspace = await indexWorkspace(filePath, overrides, CpuDialect.Z80, true);

        assert.deepEqual(collectDiagnostics(workspace, filePath), []);
    });

    it("enforces documented numeric forms for asMSX sources", async () => {
        const validPath = path.resolve("/numeric-formats.z80");
        const validSource = "  db 0, 255, 1.25, 077, 77o, 123O, 0x1A, $1A, 1Ah, 1010b";
        const validDocument = new AsmDocument(validSource, CpuDialect.Z80, true);
        const validWorkspace = await indexWorkspace(validPath, new Map([[validPath, validDocument]]), CpuDialect.Z80, true);

        assert.deepEqual(collectDiagnostics(validWorkspace, validPath), []);

        for (const value of ["#1A", "%1010", "0b1010", "1.5e2"]) {
            const filePath = path.resolve(`/invalid-${value.replace(/[^a-z0-9]/gi, "-")}.z80`);
            const document = new AsmDocument(`  db ${value}`, CpuDialect.Z80, true);
            const workspace = await indexWorkspace(filePath, new Map([[filePath, document]]), CpuDialect.Z80, true);

            assert.ok(collectDiagnostics(workspace, filePath).length > 0, `Expected '${value}' to be rejected`);
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
    it("requires colons on eZ80 labels", async () => {
        const filePath = path.resolve("/ez80-colonless-labels.ez80");
        const source = [
            "entry nop",
            "byte_value db 1",
            "constant equ 1",
            "@increment equ 3611h"
        ].join("\n");
        const overrides = new Map([[filePath, new AsmDocument(source, CpuDialect.EZ80)]]);
        const workspace = await indexWorkspace(filePath, overrides, CpuDialect.EZ80);
        const diagnostics = collectDiagnostics(workspace, filePath);

        assert.deepEqual(diagnostics.map((diagnostic) => diagnostic.line), [0, 1, 2, 3]);
        assert.ok(diagnostics.every((diagnostic) => diagnostic.message.includes("must end with ':'")));
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
        overrides.set(path.resolve("/main.asm"), new AsmDocument("MY_SYM: equ 5\nld hl,[MY_SYM+1]", CpuDialect.EZ80, false));
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

    it("allows an EQU expression in parenthesized indirect addressing", async () => {
        const filePath = path.resolve("/equ-indirect.z80");
        const source = "Foo EQU 8\nld b,(Foo-1)";
        const overrides = new Map([[filePath, new AsmDocument(source, CpuDialect.Z80)]]);
        const workspace = await indexWorkspace(filePath, overrides, CpuDialect.Z80);

        assert.deepEqual(collectDiagnostics(workspace, filePath), []);
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

    it("allows bracketed constant expressions after .zilog", async () => {
        const filePath = path.resolve("/zilog-constant-add.z80");
        const source = "Foo EQU 8\n.ZILOG\nadd a,[Foo-1]";
        const overrides = new Map([[filePath, new AsmDocument(source, CpuDialect.Z80, true)]]);
        const workspace = await indexWorkspace(filePath, overrides, CpuDialect.Z80, true);

        assert.deepEqual(collectDiagnostics(workspace, filePath), []);
    });

    it("keeps asMSX line syntax state after .zilog for byte/word validation", async () => {
        // .zilog flips only bracket/paren indirection (currentIsAsmsxSyntax),
        // not the per-line asMSX parse state (line.isAsmsx) that drives
        // byte/word operand rejection.
        const filePath = path.resolve("/zilog-byte.z80");
        const source = ".zilog\nvalue byte 5";
        const overrides = new Map([[filePath, new AsmDocument(source, CpuDialect.Z80, true)]]);
        const workspace = await indexWorkspace(filePath, overrides, CpuDialect.Z80, true);
        const diagnostics = collectDiagnostics(workspace, filePath);

        assert.ok(
            diagnostics.some((d) => d.line === 1),
            "byte with operands should still be rejected after .zilog in asMSX mode"
        );
    });

    it("keeps asMSX comments active after .zilog", async () => {
        // Reference asMSX (parser3.l) swaps only bracket/paren roles after
        // .zilog; comment styles stay active (lex.l has no zilog state).
        const filePath = path.resolve("/zilog-comments.z80");
        const source = ".zilog\n-- dash comment\n/* block */\n// slash comment\nnop";
        const overrides = new Map([[filePath, new AsmDocument(source, CpuDialect.Z80, true)]]);
        const workspace = await indexWorkspace(filePath, overrides, CpuDialect.Z80, true);

        assert.deepEqual(collectDiagnostics(workspace, filePath), []);
    });

    it("keeps asMSX numeric token classes after .zilog", async () => {
        const filePath = path.resolve("/zilog-numbers.z80");
        const source = ".zilog\nx equ 1Ah\ny equ #1a";
        const overrides = new Map([[filePath, new AsmDocument(source, CpuDialect.Z80, true)]]);
        const workspace = await indexWorkspace(filePath, overrides, CpuDialect.Z80, true);
        const diagnostics = collectDiagnostics(workspace, filePath);

        assert.ok(!diagnostics.some((d) => d.line === 1), "1Ah stays numeric after .zilog");
        assert.ok(diagnostics.some((d) => d.line === 2), "#1a stays an identifier (macro-parameter form) after .zilog");
    });

    it("keeps asMSX double-quote escape rules after .zilog", async () => {
        const filePath = path.resolve("/zilog-escapes.z80");
        const source = '.zilog\n db "a\\nb"';
        const overrides = new Map([[filePath, new AsmDocument(source, CpuDialect.Z80, true)]]);
        const workspace = await indexWorkspace(filePath, overrides, CpuDialect.Z80, true);

        // asMSX double-quoted strings keep escapes literal (lexer mode is
        // fixed for the whole file); \n is not decoded and not an error.
        assert.deepEqual(collectDiagnostics(workspace, filePath), []);
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
    it("rejects non-spec defl directive in eZ80 mode", async () => {
        const filePath = path.resolve("/defl-test.ez80");
        const doc = new AsmDocument("  .defl 10", CpuDialect.EZ80);
        const ws = await indexWorkspace(filePath, new Map([[filePath, doc]]), CpuDialect.EZ80);
        const diags = collectDiagnostics(ws, filePath);

        assert.equal(diags.length, 1);
        assert.equal(diags[0].message, "Unknown directive: .defl");
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
        assert.equal(diagnostics.filter((d: Diagnostic) => d.line === 4 && !d.message.includes("Cannot load included file")).length, 0, "Expected include string operand to remain valid");
        assert.ok(diagnostics.some((d: Diagnostic) => d.line === 4 && d.message.includes("Cannot load included file")), "Expected the missing include file to be reported");
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

        const sortedLines = diagnostics.map((diagnostic) => diagnostic.line).sort((a, b) => a - b);
        assert.deepEqual(sortedLines, [1, 2]);
        assert.ok(diagnostics.some((d) => d.line === 1 && d.message.includes("Invalid escape sequence")));
        assert.ok(diagnostics.some((d) => d.line === 2 && d.message.includes("Cannot load included file")));
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
    it("does not match anonymous labels defined only inside a false conditional", async () => {
        for (const [dialect, isAsmsx, ext] of [
            [CpuDialect.EZ80, false, ".ez80"],
            [CpuDialect.Z80, true, ".z80"]
        ] as const) {
            for (const [direction, ref, refLine] of [["backward", "@b", 3], ["forward", "@f", 0]] as const) {
                const filePath = path.resolve(`/inactive-anon-${direction}${ext}`);
                const source = direction === "backward"
                    ? "  if 0\n@@:\n  endif\n  jr @b"
                    : "  jr @f\n  if 0\n@@:\n  endif";
                const overrides = new Map([[filePath, new AsmDocument(source, dialect, isAsmsx)]]);
                const workspace = await indexWorkspace(filePath, overrides, dialect, isAsmsx);

                const diags = collectDiagnostics(workspace, filePath);
                assert.ok(
                    diags.some((d) => d.line === refLine && d.message.includes(ref)),
                    `${dialect} ${direction}: an inactive @@ must not satisfy ${ref}, got: ${diags.map((d) => d.message).join("; ")}`
                );
            }
        }
    });

    it("still matches an active anonymous label when an inactive one also exists", async () => {
        const filePath = path.resolve("/mixed-active-anon.ez80");
        const source = [
            "@@:",
            "  jr @b",
            "  if 0",
            "@@:",
            "  endif",
            "  jr @f",
            "@@:"
        ].join("\n");
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
            "  endmacro 1",
            "other: macro",
            "  endmacro 1"
        ].join("\n");
        const overrides = new Map([[filePath, new AsmDocument(source, CpuDialect.EZ80)]]);
        const workspace = await indexWorkspace(filePath, overrides, CpuDialect.EZ80);
        const diagnostics = collectDiagnostics(workspace, filePath);
        assert.deepEqual(diagnostics.map((diagnostic) => diagnostic.line), [
            0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 10
        ]);
    });
    it("formats clean operand count diagnostic when maximum is unlimited", async () => {
        const filePath = path.resolve("/ez80-byte-no-operands.ez80");
        const overrides = new Map([[filePath, new AsmDocument("  byte", CpuDialect.EZ80)]]);
        const workspace = await indexWorkspace(filePath, overrides, CpuDialect.EZ80);
        const diagnostics = collectDiagnostics(workspace, filePath);

        assert.equal(diagnostics.length, 1);
        assert.equal(diagnostics[0].message, "Directive 'byte' requires at least 1 operand");
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
    it("shares directive range specs and anchors numeric arity errors on mnemonics", async () => {
        const numericFilePath = path.resolve("/directive-range-specs.ez80");
        const numericWorkspace = await indexWorkspace(
            numericFilePath,
            new Map([[numericFilePath, new AsmDocument("  dl", CpuDialect.EZ80)]]),
            CpuDialect.EZ80
        );
        const numericDiagnostics = collectDiagnostics(numericWorkspace, numericFilePath);
        assert.deepEqual(
            numericDiagnostics.map((diagnostic) => ({
                message: diagnostic.message,
                startCharacter: diagnostic.startCharacter,
                length: diagnostic.length
            })),
            [{
                message: "Directive 'dl' requires at least 1 operand",
                startCharacter: 2,
                length: 2
            }]
        );

        const mapperFilePath = path.resolve("/megarom-mapper.z80");
        const mapperWorkspace = await indexWorkspace(
            mapperFilePath,
            new Map([[mapperFilePath, new AsmDocument("  megarom KONAMI_SCC", CpuDialect.Z80, true)]]),
            CpuDialect.Z80,
            true
        );
        assert.ok(
            !collectDiagnostics(mapperWorkspace, mapperFilePath).some((diagnostic) => diagnostic.message.includes("Invalid mapper type")),
            "KONAMI_SCC must be accepted consistently by MegaROM directives"
        );
    });

    it("enforces the strict subpage/select shape from the reference grammar", async () => {
        // Reference asMSX grammar: PSEUDO_SUBPAGE value PSEUDO_AT value.
        const filePath = path.resolve("/subpage-shape.z80");
        const source = [
            "  subpage at at 0x100",
            "  subpage 1 at at",
            "  select at 1 at",
            "  subpage 1 2 at 0x100",
            "  subpage 1 at 0x100 extra",
            "  select 1 at x",
            "  subpage 1 at 0x100",
            "  subpage 300 at 0x100"
        ].join("\n");
        const overrides = new Map([[filePath, new AsmDocument(source, CpuDialect.Z80, true)]]);
        const workspace = await indexWorkspace(filePath, overrides, CpuDialect.Z80, true);
        const diagnostics = collectDiagnostics(workspace, filePath);

        // Lines 0-4 are malformed shapes; line 5 uses a symbol (resolved at
        // assembly time, legal per the reference grammar); line 6 is valid;
        // line 7 is valid in shape but out of range.
        assert.deepEqual(diagnostics.map((diagnostic) => diagnostic.line), [0, 1, 2, 3, 4, 7]);
        for (const line of [0, 1, 2, 3, 4]) {
            assert.ok(
                diagnostics.some((d) => d.line === line && d.message.includes("requires format")),
                `expected a format diagnostic on line ${line}`
            );
        }
        assert.ok(diagnostics.some((d) => d.line === 7 && d.message.includes("Subpage number")));
    });

    it("reports includes that cannot be loaded", async () => {
        const filePath = path.resolve("/broken-include.z80");
        const source = "  include \"missing.asm\"\n  nop";
        const overrides = new Map([[filePath, new AsmDocument(source, CpuDialect.Z80, true)]]);
        const workspace = await indexWorkspace(filePath, overrides, CpuDialect.Z80, true);
        const diagnostics = collectDiagnostics(workspace, filePath);

        const includeDiags = diagnostics.filter((d) => d.message.includes("Cannot load included file"));
        assert.equal(includeDiags.length, 1);
        assert.equal(includeDiags[0].line, 0);
        assert.equal(includeDiags[0].startCharacter, 10);
        assert.equal(includeDiags[0].length, "\"missing.asm\"".length);
        assert.ok(!diagnostics.some((d) => d.line === 1), "nop line unaffected");
    });

    it("reports every unloadable include in a file", async () => {
        const filePath = path.resolve("/broken-includes.ez80");
        const source = "  include \"a.asm\"\n  maclib \"b.lib\"\n  nop";
        const overrides = new Map([[filePath, new AsmDocument(source, CpuDialect.EZ80)]]);
        const workspace = await indexWorkspace(filePath, overrides, CpuDialect.EZ80);
        const diagnostics = collectDiagnostics(workspace, filePath);

        assert.ok(diagnostics.some((d) => d.line === 0 && d.message.includes("a.asm")));
        assert.ok(diagnostics.some((d) => d.line === 1 && d.message.includes("b.lib")));
    });

    it("range-checks nested offset chains anchored on index registers", async () => {
        const filePath = path.resolve("/index-offset-chains.ez80");
        const source = [
            "  ld a,(ix+200+200)",
            "  ld a,(ix-200-200)",
            "  ld a,(ix+200-80)",
            "  ld a,(iy+5)",
            "  ld a,(5-ix)"
        ].join("\n");
        const overrides = new Map([[filePath, new AsmDocument(source, CpuDialect.EZ80)]]);
        const workspace = await indexWorkspace(filePath, overrides, CpuDialect.EZ80);
        const diags = collectDiagnostics(workspace, filePath);

        assert.ok(
            diags.some((d) => d.line === 0 && d.message.includes("Index offset") && d.message.includes("400")),
            "nested addition chains must be range-checked"
        );
        assert.ok(
            diags.some((d) => d.line === 1 && d.message.includes("Index offset") && d.message.includes("-400")),
            "nested subtraction chains must be range-checked"
        );
        assert.ok(
            !diags.some((d) => d.line === 2),
            "an in-range chain (+200-80 = 120) must stay clean"
        );
        assert.ok(!diags.some((d) => d.line === 3), "simple offsets still validate");
        assert.ok(
            !diags.some((d) => d.line === 4 && d.message.includes("Index offset")),
            "(5-ix) matches the generic address signature, not ix+d, so no offset check applies"
        );
    });

    it("surfaces evaluation errors in constant instruction operands", async () => {
        const filePath = path.resolve("/operand-eval-errors.z80");
        const source = [
            "  ld a,5/0",
            "  ld a,[ix+5/0]",
            "  ld a,5 MOD 0"
        ].join("\n");
        const overrides = new Map([[filePath, new AsmDocument(source, CpuDialect.Z80, true)]]);
        const workspace = await indexWorkspace(filePath, overrides, CpuDialect.Z80, true);
        const diags = collectDiagnostics(workspace, filePath);

        const division = diags.find((d) => d.line === 0 && d.message.includes("Division by zero"));
        assert.ok(division);
        assert.strictEqual(division?.startCharacter, 8, "division-by-zero must anchor on the / token");
        assert.strictEqual(division?.length, 1);
        assert.ok(
            diags.some((d) => d.line === 1 && d.message.includes("Division by zero")),
            "evaluation errors inside index offsets must not be swallowed"
        );
        const modulo = diags.find((d) => d.line === 2 && d.message.includes("Modulo by zero"));
        assert.ok(modulo);
        assert.strictEqual(modulo?.startCharacter, 9, "modulo-by-zero must anchor on the MOD token");
        assert.strictEqual(modulo?.length, 3);
    });

    it("surfaces collector equ-evaluation and local-scope errors", async () => {
        const overrides = new Map();
        overrides.set(path.resolve("/main.asm"), new AsmDocument("@orphan:\n  nop\nBAD: equ 1/0", CpuDialect.Z80, true));
        const workspace = await indexWorkspace(path.resolve("/main.asm"), overrides);
        const diags = collectDiagnostics(workspace, path.resolve("/main.asm"));
        assert.ok(
            diags.some((d) => d.message.includes("Failed to evaluate equate BAD")),
            "equ evaluation failures must surface as diagnostics"
        );
        assert.ok(
            diags.some((d) => d.message.includes("Local label @orphan defined without a preceding global label")),
            "unscoped local labels must surface as diagnostics"
        );
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

    it("suppresses inactive branches for a file never passed through a SymbolCollector", async () => {
        // AsmDocument must compute isInactive at parse time: this workspace
        // is built by hand without running SymbolCollector, and inactive
        // suppression must not depend on call order.
        const filePath = path.resolve("/collector-free-inactive.z80");
        const source = [
            "  if 0",
            "  totally_fake_instruction",
            "  else",
            "  nop",
            "  endif"
        ].join("\n");
        const document = new AsmDocument(source, CpuDialect.Z80);
        const workspace: IndexedWorkspace = {
            documents: new Map([[filePath, document]]),
            symbols: new Map(),
            failedIncludes: [],
            pathIndex: new Map([[pathKey(filePath), filePath]])
        };

        const diagnostics = collectDiagnostics(workspace, filePath);
        assert.deepStrictEqual(diagnostics, []);
    });

    it("does not let an inactive .cpu directive change CPU state", async () => {
        const filePath = path.resolve("/inactive-cpu.ez80");
        const source = [
            "  cpu z80",
            "  if 0",
            "  cpu z180",
            "  endif",
            "  otim"
        ].join("\n");
        const overrides = new Map([[filePath, new AsmDocument(source, CpuDialect.EZ80)]]);
        const workspace = await indexWorkspace(filePath, overrides, CpuDialect.EZ80);

        const diagnostics = collectDiagnostics(workspace, filePath);
        assert.ok(
            diagnostics.some((d) => d.line === 4 && d.message.includes("not supported by CPU Z80")),
            "otim should be rejected under CPU Z80 because the inactive 'cpu z180' must not switch state"
        );
    });

    it("does not let an inactive .zilog directive change bracket syntax", async () => {
        const filePath = path.resolve("/inactive-zilog.z80");
        const source = [
            "  if 0",
            "  zilog",
            "  endif",
            "  ld a,[hl]"
        ].join("\n");
        const overrides = new Map([[filePath, new AsmDocument(source, CpuDialect.Z80, true)]]);
        const workspace = await indexWorkspace(filePath, overrides, CpuDialect.Z80, true);

        assert.deepEqual(collectDiagnostics(workspace, filePath), []);
    });

    it("does not let an inactive macro definition leak macro state", async () => {
        const filePath = path.resolve("/inactive-macro.z80");
        const source = [
            "  if 0",
            "  macro foo",
            "  endif",
            "  foo"
        ].join("\n");
        const overrides = new Map([[filePath, new AsmDocument(source, CpuDialect.Z80, true)]]);
        const workspace = await indexWorkspace(filePath, overrides, CpuDialect.Z80, true);

        const diagnostics = collectDiagnostics(workspace, filePath);
        assert.ok(
            diagnostics.some((d) => d.line === 3 && d.message.includes("Unknown instruction")),
            "the inactive macro definition must not register or open a macro scope"
        );
        assert.ok(!diagnostics.some((d) => d.message.includes("inside a macro body")));
    });

    it("does not let an inactive global label capture local-label scope", async () => {
        const filePath = path.resolve("/inactive-scope.z80");
        const source = [
            "active:",
            "  if 0",
            "inactive_scope:",
            "  endif",
            ".loop:",
            "  jr .loop"
        ].join("\n");
        const overrides = new Map([[filePath, new AsmDocument(source, CpuDialect.Z80, true)]]);
        const workspace = await indexWorkspace(filePath, overrides, CpuDialect.Z80, true);

        assert.deepEqual(collectDiagnostics(workspace, filePath), []);
    });

    it("toggles branch state on repeated ELSE like the reference assemblers", async () => {
        // Reference asMSX (dura.y PSEUDO_ELSE) XOR-toggles the conditional,
        // so a second ELSE reactivates the original branch; symbols.ts
        // implements the same toggle. if/else/else/endif is legal.
        for (const [dialect, isAsmsx] of [[CpuDialect.Z80, true], [CpuDialect.EZ80, false]] as const) {
            const filePath = path.resolve(isAsmsx ? "/double-else.z80" : "/double-else.ez80");
            const source = [
                "  if 0",
                "  fake_one",
                "  else",
                "  fake_two",
                "  else",
                "  fake_three",
                "  endif"
            ].join("\n");
            const overrides = new Map([[filePath, new AsmDocument(source, dialect, isAsmsx)]]);
            const workspace = await indexWorkspace(filePath, overrides, dialect, isAsmsx);

            const diagnostics = collectDiagnostics(workspace, filePath);
            assert.equal(diagnostics.length, 1, `${dialect}: only the toggled-active branch reports`);
            assert.ok(diagnostics[0].message.includes("fake_two"));
            assert.equal(diagnostics[0].line, 3);
        }
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
    it("diagnoses no unresolved symbol for exact user screenshot macro", async () => {
        const filePath = path.resolve("/user-screenshot-macro.ez80");
        const source = [
            "MACRO emit_bytes arg",
            ";",
            ";",
            "        ld      a,arg",
            "        nop",
            "ENDMACRO"
        ].join("\n");
        const overrides = new Map([[filePath, new AsmDocument(source, CpuDialect.EZ80)]]);
        const workspace = await indexWorkspace(filePath, overrides, CpuDialect.EZ80);
        const diags = collectDiagnostics(workspace, filePath);

        assert.deepEqual(diags, []);
    });
    it("rejects invocation of macro without matching terminator", async () => {
        const filePath = path.resolve("/unterminated-macro-invocation.ez80");
        const source = [
            "        no_terminator",
            "",
            "no_terminator: MACRO",
            "        nop"
        ].join("\n");
        const overrides = new Map([[filePath, new AsmDocument(source, CpuDialect.EZ80)]]);
        const workspace = await indexWorkspace(filePath, overrides, CpuDialect.EZ80);
        const diags = collectDiagnostics(workspace, filePath);

        assert.ok(diags.some((d) => d.line === 0 && d.message.includes("Cannot invoke macro 'no_terminator'")), "Expected no_terminator call to be rejected");
    });
    it("rejects invocation of outside_local macro when body contains local label errors", async () => {
        const filePath = path.resolve("/outside-local-call-rejection.ez80");
        const source = [
            "@outside: nop",
            "@@: nop",
            "",
            "MACRO outside_local",
            "        jr      @b",
            "        jr      @outside",
            "ENDMACRO",
            "",
            "        outside_local"
        ].join("\n");
        const overrides = new Map([[filePath, new AsmDocument(source, CpuDialect.EZ80)]]);
        const workspace = await indexWorkspace(filePath, overrides, CpuDialect.EZ80);
        const diags = collectDiagnostics(workspace, filePath);

        assert.ok(diags.some((d) => d.line === 8 && d.message.includes("outside_local")), "Expected outside_local call to be rejected");
    });
    it("rejects outer local label reference inside eZ80 MACRO", async () => {
        const filePath = path.resolve("/ez80-outer-local-in-macro.ez80");
        const source = [
            "@outside: nop",
            "",
            "MACRO outside_local",
            "        jr      @outside_local",
            "ENDMACRO"
        ].join("\n");
        const overrides = new Map([[filePath, new AsmDocument(source, CpuDialect.EZ80)]]);
        const workspace = await indexWorkspace(filePath, overrides, CpuDialect.EZ80);
        const diags = collectDiagnostics(workspace, filePath);

        assert.equal(diags.length, 2);
        assert.ok(diags[0].message.includes("Local label @outside defined without a preceding global label"));
        assert.ok(diags[1].message.includes("@outside_local"));
    });

    it("allows inner local label reference inside eZ80 MACRO", async () => {
        const filePath = path.resolve("/ez80-inner-local-in-macro.ez80");
        const source = [
            "MACRO inside_local",
            "@local:",
            "        jr      @local",
            "ENDMACRO"
        ].join("\n");
        const overrides = new Map([[filePath, new AsmDocument(source, CpuDialect.EZ80)]]);
        const workspace = await indexWorkspace(filePath, overrides, CpuDialect.EZ80);
        const diags = collectDiagnostics(workspace, filePath);

        assert.deepEqual(diags, []);
    });
    it("allows forward references to eZ80 macro-local labels", async () => {
        const filePath = path.resolve("/ez80-forward-local-in-macro.ez80");
        const source = [
            "MACRO fwd_local",
            "        jr      @loop",
            "@loop:",
            "ENDMACRO"
        ].join("\n");
        const overrides = new Map([[filePath, new AsmDocument(source, CpuDialect.EZ80)]]);
        const workspace = await indexWorkspace(filePath, overrides, CpuDialect.EZ80);

        assert.deepEqual(collectDiagnostics(workspace, filePath), []);
    });

    it("keeps forward-referenced macros invocable", async () => {
        const filePath = path.resolve("/ez80-forward-local-invocation.ez80");
        const source = [
            "MACRO fwd_local",
            "        jr      @loop",
            "@loop:",
            "ENDMACRO",
            "        fwd_local"
        ].join("\n");
        const overrides = new Map([[filePath, new AsmDocument(source, CpuDialect.EZ80)]]);
        const workspace = await indexWorkspace(filePath, overrides, CpuDialect.EZ80);

        assert.deepEqual(collectDiagnostics(workspace, filePath), []);
    });

    it("still rejects eZ80 macro-local labels that are never defined", async () => {
        const filePath = path.resolve("/ez80-missing-forward-local.ez80");
        const source = [
            "MACRO fwd_local",
            "        jr      @loop",
            "ENDMACRO"
        ].join("\n");
        const overrides = new Map([[filePath, new AsmDocument(source, CpuDialect.EZ80)]]);
        const workspace = await indexWorkspace(filePath, overrides, CpuDialect.EZ80);
        const diags = collectDiagnostics(workspace, filePath);

        assert.equal(diags.length, 1);
        assert.equal(diags[0].line, 1);
        assert.ok(diags[0].message.includes("@loop"));
    });
    it("rejects jr @b inside macro when @@ is outside macro", async () => {
        const filePath = path.resolve("/ez80-anon-outside-macro.ez80");
        const source = [
            "@@: nop",
            "",
            "MACRO outside_anon",
            "        jr      @b",
            "ENDMACRO"
        ].join("\n");
        const overrides = new Map([[filePath, new AsmDocument(source, CpuDialect.EZ80)]]);
        const workspace = await indexWorkspace(filePath, overrides, CpuDialect.EZ80);
        const diags = collectDiagnostics(workspace, filePath);

        assert.equal(diags.length, 1);
        assert.equal(diags[0].line, 3);
        assert.ok(diags[0].message.includes("@b"));
    });

    it("allows jr @b inside macro when @@ is inside macro", async () => {
        const filePath = path.resolve("/ez80-anon-inside-macro.ez80");
        const source = [
            "MACRO inside_anon",
            "@@:",
            "        jr      @b",
            "ENDMACRO"
        ].join("\n");
        const overrides = new Map([[filePath, new AsmDocument(source, CpuDialect.EZ80)]]);
        const workspace = await indexWorkspace(filePath, overrides, CpuDialect.EZ80);
        const diags = collectDiagnostics(workspace, filePath);

        assert.deepEqual(diags, []);
    });
    it("allows jr @b in macro when @@ is defined inside macro with preceding global label", async () => {
        const filePath = path.resolve("/ez80-anon-in-macro-with-global.ez80");
        const source = [
            "constant: EQU 42",
            "",
            "MACRO emit_bytes arg1, arg2",
            "        ld a, arg1",
            "        ld a, arg2",
            "@@:",
            "        jr @b",
            "@macro_local:",
            "        jr @macro_local",
            "        nop",
            "ENDMACRO"
        ].join("\n");
        const overrides = new Map([[filePath, new AsmDocument(source, CpuDialect.EZ80)]]);
        const workspace = await indexWorkspace(filePath, overrides, CpuDialect.EZ80);
        const diags = collectDiagnostics(workspace, filePath);

        assert.deepEqual(diags, []);
    });
    it("rejects nested macro definitions", async () => {
        const filePath = path.resolve("/nested-macro-definition.ez80");
        const source = [
            "OuterMacro: MACRO",
            "InnerMacro: MACRO",
            "ENDMACRO",
            "ENDMACRO"
        ].join("\n");
        const overrides = new Map([[filePath, new AsmDocument(source, CpuDialect.EZ80)]]);
        const workspace = await indexWorkspace(filePath, overrides, CpuDialect.EZ80);
        const diags = collectDiagnostics(workspace, filePath);

        assert.equal(diags.length, 1);
        assert.equal(diags[0].line, 1);
        assert.equal(diags[0].message, "Nested macro definitions are not allowed");
    });
    it("rejects outer local label @outside referenced inside eZ80 MACRO even if defined outside", async () => {
        const filePath = path.resolve("/ez80-outer-defined-local-in-macro.ez80");
        const source = [
            "@outside: nop",
            "",
            "MACRO outside_local",
            "        jr      @outside",
            "ENDMACRO"
        ].join("\n");
        const overrides = new Map([[filePath, new AsmDocument(source, CpuDialect.EZ80)]]);
        const workspace = await indexWorkspace(filePath, overrides, CpuDialect.EZ80);
        const diags = collectDiagnostics(workspace, filePath);

        assert.equal(diags.length, 2);
        assert.equal(diags[0].line, 0);
        assert.ok(diags[0].message.includes("Local label @outside defined without a preceding global label"));
        assert.equal(diags[1].line, 3);
        assert.ok(diags[1].message.includes("@outside"));
    });

    it("rejects invocation of outer macro when inner macro definition is nested", async () => {
        const filePath = path.resolve("/ez80-nested-macro-invocation.ez80");
        const source = [
            "MACRO outer",
            "MACRO inner",
            "ENDMACRO",
            "ENDMACRO",
            "",
            "        outer",
            "        inner"
        ].join("\n");
        const overrides = new Map([[filePath, new AsmDocument(source, CpuDialect.EZ80)]]);
        const workspace = await indexWorkspace(filePath, overrides, CpuDialect.EZ80);
        const diags = collectDiagnostics(workspace, filePath);

        assert.ok(diags.some((d) => d.line === 5 && d.message.includes("outer")), "Expected outer call to be rejected");
        assert.ok(diags.some((d) => d.line === 6 && d.message.includes("inner")), "Expected inner call to be rejected");
    });
    it("rejects invocation of macro with definition errors", async () => {
        const filePath = path.resolve("/invalid-macro-invocation.ez80");
        const source = [
            "MACRO bad_macro arg1 arg2",
            "  ld a, arg1",
            "ENDMACRO",
            "",
            "  bad_macro"
        ].join("\n");
        const overrides = new Map([[filePath, new AsmDocument(source, CpuDialect.EZ80)]]);
        const workspace = await indexWorkspace(filePath, overrides, CpuDialect.EZ80);
        const diags = collectDiagnostics(workspace, filePath);

        assert.ok(diags.some((d) => d.line === 4 && d.message.includes("bad_macro")), "Expected diagnostic on calling invalid macro");
    });

    it("allows invocation of valid macro without definition errors", async () => {
        const filePath = path.resolve("/valid-macro-invocation.ez80");
        const source = [
            "MACRO good_macro arg1, arg2",
            "  ld a, arg1",
            "  ld b, arg2",
            "ENDMACRO",
            "",
            "  good_macro 1, 2"
        ].join("\n");
        const overrides = new Map([[filePath, new AsmDocument(source, CpuDialect.EZ80)]]);
        const workspace = await indexWorkspace(filePath, overrides, CpuDialect.EZ80);
        const diags = collectDiagnostics(workspace, filePath);

        assert.deepEqual(diags, []);
    });
    it("rejects ENDM in eZ80 mode", async () => {
        const filePath = path.resolve("/endm-ez80.ez80");
        const source = [
            "my_macro: macro",
            "  ld a,1",
            "  endm"
        ].join("\n");
        const overrides = new Map([[filePath, new AsmDocument(source, CpuDialect.EZ80)]]);
        const workspace = await indexWorkspace(filePath, overrides, CpuDialect.EZ80);
        const diags = collectDiagnostics(workspace, filePath);

        assert.ok(diags.some((d) => d.message.includes("endm")), "Expected diagnostic rejecting endm in eZ80 mode");
    });
    it("rejects un-commad macro parameters in eZ80 mode", async () => {
        const filePath = path.resolve("/ez80-uncommad-macro-params.ez80");
        const source = [
            "MACRO emit_bytes arg1 arg2",
            "  ld a, arg1",
            "ENDMACRO"
        ].join("\n");
        const overrides = new Map([[filePath, new AsmDocument(source, CpuDialect.EZ80)]]);
        const workspace = await indexWorkspace(filePath, overrides, CpuDialect.EZ80);
        const diags = collectDiagnostics(workspace, filePath);

        assert.equal(diags.length, 1);
        assert.equal(diags[0].line, 0);
        assert.equal(diags[0].message, "MACRO parameters must be separated by commas");
    });

    it("accepts comma-separated macro parameters in eZ80 mode", async () => {
        const filePath = path.resolve("/ez80-commad-macro-params.ez80");
        const source = [
            "MACRO emit_bytes arg1, arg2",
            "  ld a, arg1",
            "  ld b, arg2",
            "ENDMACRO"
        ].join("\n");
        const overrides = new Map([[filePath, new AsmDocument(source, CpuDialect.EZ80)]]);
        const workspace = await indexWorkspace(filePath, overrides, CpuDialect.EZ80);
        const diags = collectDiagnostics(workspace, filePath);

        assert.deepEqual(diags, []);
    });

    it("reports instruction and operand diagnostics inside macro bodies", async () => {
        const filePath = path.resolve("/macro-body.ez80");
        const source = [
            "TwoMacro: macro",
            "  whatever",
            "  ld a",
            "  endmacro"
        ].join("\n");
        const overrides = new Map([[filePath, new AsmDocument(source, CpuDialect.EZ80)]]);
        const workspace = await indexWorkspace(filePath, overrides, CpuDialect.EZ80);

        assert.deepEqual(collectDiagnostics(workspace, filePath), [{
            line: 1,
            message: "Unknown instruction: whatever",
            startCharacter: 2,
            length: 8
        }, {
            line: 2,
            message: "Instruction 'ld' expects 2 operands, but got 1",
            startCharacter: 2,
            length: 2
        }]);
    });

    it("does not report macro calls as unknown instructions", async () => {
        const filePath = path.resolve("/macro-call.ez80");
        const source = [
            "my_macro: macro",
            "  ld a,1",
            "  endmacro",
            "  my_macro"
        ].join("\n");
        const overrides = new Map([[filePath, new AsmDocument(source, CpuDialect.EZ80)]]);
        const workspace = await indexWorkspace(filePath, overrides, CpuDialect.EZ80);

        assert.deepEqual(collectDiagnostics(workspace, filePath), []);
    });

    it("rejects macro calls inside macro bodies", async () => {
        const filePath = path.resolve("/nested-macro-call.asm");
        const source = [
            "OneMacro: macro #arg",
            "  endm",
            "NestedMacro: macro",
            "  OneMacro 10",
            "  endm"
        ].join("\n");
        const overrides = new Map([[filePath, new AsmDocument(source, CpuDialect.Z80, true)]]);
        const workspace = await indexWorkspace(filePath, overrides, CpuDialect.Z80, true);

        assert.deepEqual(collectDiagnostics(workspace, filePath), [{
            line: 3,
            message: "Macro invocation 'OneMacro' is not allowed inside a macro body",
            startCharacter: 2,
            length: 8
        }]);
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

    it("reports undeclared asMSX macro parameters", async () => {
        const filePath = path.resolve("/asmsx-undeclared-macro-parameter.asm");
        const source = [
            "TwoMacro: macro #arg",
            "  ld a,#nonexistent",
            "  endm"
        ].join("\n");
        const overrides = new Map([[filePath, new AsmDocument(source, CpuDialect.Z80, true)]]);
        const workspace = await indexWorkspace(filePath, overrides, CpuDialect.Z80, true);

        assert.deepEqual(collectDiagnostics(workspace, filePath), [{
            line: 1,
            message: "Unknown macro parameter: #nonexistent",
            startCharacter: 7,
            length: 12
        }]);
    });

    it("reports unresolved global symbols inside macro bodies", async () => {
        const filePath = path.resolve("/asmsx-unresolved-macro-symbol.asm");
        const source = [
            "TwoMacro: macro #arg",
            "  ld a,missing_label",
            "  endm"
        ].join("\n");
        const overrides = new Map([[filePath, new AsmDocument(source, CpuDialect.Z80, true)]]);
        const workspace = await indexWorkspace(filePath, overrides, CpuDialect.Z80, true);

        assert.deepEqual(collectDiagnostics(workspace, filePath), [{
            line: 1,
            message: "Unresolved symbol: missing_label",
            startCharacter: 7,
            length: 13
        }]);
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

    it("requires commas between asMSX macro parameters", async () => {
        const filePath = path.resolve("/asmsx-macro-parameter-separators.asm");
        const source = [
            "my_macro: macro #first #second",
            "  endm"
        ].join("\n");
        const overrides = new Map([[filePath, new AsmDocument(source, CpuDialect.Z80, true)]]);
        const workspace = await indexWorkspace(filePath, overrides, CpuDialect.Z80, true);

        assert.deepEqual(collectDiagnostics(workspace, filePath), [{
            line: 0,
            message: "asMSX MACRO parameters must be separated by commas",
            startCharacter: 23,
            length: 7
        }]);
    });

    it("requires a colon after asMSX macro names", async () => {
        const filePath = path.resolve("/asmsx-colonless-macro.asm");
        const source = [
            "OneMacro MACRO #arg",
            "  ENDM"
        ].join("\n");
        const overrides = new Map([[filePath, new AsmDocument(source, CpuDialect.Z80, true)]]);
        const workspace = await indexWorkspace(filePath, overrides, CpuDialect.Z80, true);

        assert.deepEqual(collectDiagnostics(workspace, filePath), [{
            line: 0,
            message: "asMSX MACRO name must be followed by ':'",
            startCharacter: 0,
            length: 8
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
            "  OneMacro 1",
            "  oneMacro 1"
        ].join("\n");
        const overrides = new Map([[filePath, new AsmDocument(source, CpuDialect.Z80, true)]]);
        const workspace = await indexWorkspace(filePath, overrides, CpuDialect.Z80, true);

        assert.deepEqual(collectDiagnostics(workspace, filePath), [{
            line: 4,
            message: "Unknown instruction: oneMacro",
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

    it("allows unresolved asMSX local labels inside macro bodies", async () => {
        const filePath = path.resolve("/asmsx-macro-local-label.asm");
        const source = [
            "MyMacro: macro",
            "  jr .call_site_label",
            "  endm"
        ].join("\n");
        const overrides = new Map([[filePath, new AsmDocument(source, CpuDialect.Z80, true)]]);
        const workspace = await indexWorkspace(filePath, overrides, CpuDialect.Z80, true);

        assert.deepEqual(collectDiagnostics(workspace, filePath), []);
    });

    it("diagnoses unmatched ENDMACRO", async () => {
        const filePath = path.resolve("/unmatched-endmacro.ez80");
        const source = "  endmacro";
        const overrides = new Map([[filePath, new AsmDocument(source, CpuDialect.EZ80)]]);
        const workspace = await indexWorkspace(filePath, overrides, CpuDialect.EZ80);
        const diags = collectDiagnostics(workspace, filePath);

        assert.equal(diags.length, 1);
        assert.ok(diags[0].message.includes("ENDMACRO"));
    });

    it("diagnoses unclosed MACRO in eZ80 mode with ENDMACRO message", async () => {
        const filePath = path.resolve("/unclosed-macro.ez80");
        const source = "MACRO emit_bytes arg";
        const overrides = new Map([[filePath, new AsmDocument(source, CpuDialect.EZ80)]]);
        const workspace = await indexWorkspace(filePath, overrides, CpuDialect.EZ80);
        const diags = collectDiagnostics(workspace, filePath);

        assert.equal(diags.length, 1);
        assert.equal(diags[0].message, "MACRO without matching ENDMACRO");
    });

    it("diagnoses unclosed MACRO in Z80 mode with ENDM message", async () => {
        const filePath = path.resolve("/unclosed-macro.z80");
        const source = "my_macro: MACRO #arg";
        const overrides = new Map([[filePath, new AsmDocument(source, CpuDialect.Z80, true)]]);
        const workspace = await indexWorkspace(filePath, overrides, CpuDialect.Z80, true);
        const diags = collectDiagnostics(workspace, filePath);

        assert.equal(diags.length, 1);
        assert.equal(diags[0].message, "MACRO without matching ENDM");
    });

    it("pairs a nameless macro's terminator without cascading", async () => {
        for (const [dialect, isAsmsx, terminator] of [
            [CpuDialect.Z80, true, "endm"],
            [CpuDialect.EZ80, false, "endmacro"]
        ] as const) {
            const filePath = path.resolve(isAsmsx ? "/nameless-macro.z80" : "/nameless-macro.ez80");
            const source = `macro\n nop\n${terminator}`;
            const overrides = new Map([[filePath, new AsmDocument(source, dialect, isAsmsx)]]);
            const workspace = await indexWorkspace(filePath, overrides, dialect, isAsmsx);

            const diags = collectDiagnostics(workspace, filePath);
            assert.equal(diags.length, 1, `${dialect}: only the missing-name error should remain`);
            assert.equal(diags[0].line, 0);
            assert.equal(diags[0].message, "MACRO requires a macro name");
        }
    });

    it("does not let a nameless macro steal the outer terminator", async () => {
        const filePath = path.resolve("/nameless-inner-macro.z80");
        const source = [
            "outer: macro",
            "  macro",
            "  endm",
            "  endm"
        ].join("\n");
        const overrides = new Map([[filePath, new AsmDocument(source, CpuDialect.Z80, true)]]);
        const workspace = await indexWorkspace(filePath, overrides, CpuDialect.Z80, true);

        const diags = collectDiagnostics(workspace, filePath);
        assert.deepEqual(diags.map((d) => d.line), [1, 1]);
        assert.deepEqual(
            new Set(diags.map((d) => d.message)),
            new Set(["Nested macro definitions are not allowed", "MACRO requires a macro name"])
        );
        assert.ok(
            !diags.some((d) => d.message.includes("without matching")),
            "both terminators must pair with their own macro"
        );
    });

    it("keeps a later valid macro usable after a nameless one", async () => {
        const filePath = path.resolve("/macro-after-nameless.z80");
        const source = [
            "macro",
            "endm",
            "good: macro",
            "  nop",
            "  endm",
            "  good"
        ].join("\n");
        const overrides = new Map([[filePath, new AsmDocument(source, CpuDialect.Z80, true)]]);
        const workspace = await indexWorkspace(filePath, overrides, CpuDialect.Z80, true);

        const diags = collectDiagnostics(workspace, filePath);
        assert.equal(diags.length, 1);
        assert.equal(diags[0].line, 0);
        assert.equal(diags[0].message, "MACRO requires a macro name");
    });

    it("reports syntax errors in macro-local operands instead of swallowing them", async () => {
        const filePath = path.resolve("/macro-local-operand-syntax.z80");
        const source = [
            "bad: macro",
            "  ld a,(.loop",
            "  endm",
            "  bad"
        ].join("\n");
        const overrides = new Map([[filePath, new AsmDocument(source, CpuDialect.Z80, true)]]);
        const workspace = await indexWorkspace(filePath, overrides, CpuDialect.Z80, true);

        const diags = collectDiagnostics(workspace, filePath);
        assert.ok(
            diags.some((d) => d.line === 1 && d.message.includes("Wrong operand form")),
            "an unbalanced parenthesis in a .local operand is a real syntax error"
        );
        assert.ok(
            diags.some((d) => d.line === 3 && d.message.includes("because its definition contains errors")),
            "the macro must be marked invalid so invocations are flagged"
        );
    });

    it("reports syntax errors in anonymous-label operands inside macros", async () => {
        const filePath = path.resolve("/macro-anonymous-operand-syntax.z80");
        const source = [
            "bad: macro",
            "  jp @b +",
            "  endm",
            "  bad"
        ].join("\n");
        const overrides = new Map([[filePath, new AsmDocument(source, CpuDialect.Z80, true)]]);
        const workspace = await indexWorkspace(filePath, overrides, CpuDialect.Z80, true);

        const diags = collectDiagnostics(workspace, filePath);
        assert.ok(
            diags.some((d) => d.line === 1 && d.message.includes("Wrong operand form")),
            "a dangling operator after @b is a real syntax error"
        );
        assert.ok(
            diags.some((d) => d.line === 3 && d.message.includes("because its definition contains errors"))
        );
    });

    it("reports syntax errors in malformed #param operands", async () => {
        const filePath = path.resolve("/macro-param-operand-syntax.z80");
        const source = [
            "bad: macro #p",
            "  add a,(#p",
            "  endm",
            "  bad"
        ].join("\n");
        const overrides = new Map([[filePath, new AsmDocument(source, CpuDialect.Z80, true)]]);
        const workspace = await indexWorkspace(filePath, overrides, CpuDialect.Z80, true);

        const diags = collectDiagnostics(workspace, filePath);
        assert.ok(
            diags.some((d) => d.line === 1 && d.message.includes("Wrong operand form")),
            "an unbalanced parenthesis around a macro parameter is a syntax error"
        );
        assert.ok(
            diags.some((d) => d.line === 3 && d.message.includes("because its definition contains errors"))
        );
    });

    it("keeps valid macro-local operand syntax clean", async () => {
        const filePath = path.resolve("/macro-local-operand-valid.z80");
        const source = [
            "ok: macro #p",
            ".loop:",
            "  ld a,(.loop)",
            "@@:",
            "  jp @b",
            "  add a,#p",
            "  endm",
            "  ok"
        ].join("\n");
        const overrides = new Map([[filePath, new AsmDocument(source, CpuDialect.Z80, true)]]);
        const workspace = await indexWorkspace(filePath, overrides, CpuDialect.Z80, true);

        const diags = collectDiagnostics(workspace, filePath);
        assert.ok(
            !diags.some((d) => d.message.includes("Wrong operand form")),
            `valid macro-local operands must stay clean, got: ${diags.map((d) => d.message).join("; ")}`
        );
        assert.ok(
            !diags.some((d) => d.message.includes("because its definition contains errors")),
            "a macro with clean local operands must stay invocable"
        );
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
