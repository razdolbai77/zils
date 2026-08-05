# zils

`zils` is a Language Server for Zilog eZ80 assembly with optional Z80 support. The implementation target is feature parity with `../merls`, adapted from Merlin32-style 6502 assembly to Z80-family assembly defined by the official Zilog manuals:

- [Z80 CPU User Manual (UM0080)](https://www.zilog.com/docs/z80/um0080.pdf)
- [eZ80 CPU User Manual (UM0077)](https://zilog.com/docs/UM0077.pdf)

## Goals

- Provide a standalone LSP server over stdio.
- Default to eZ80 assembly semantics.
- Allow Z80 semantics (and asMSX directives) through an explicit command-line flag (`--asmsx`).
- Work cleanly with `coc.nvim` through standard language-server configuration.
- Provide a bundled VS Code extension in `vscode/`.
- Match the end-user LSP feature set of `../merls`.

## Scope

### In Scope

- eZ80 assembly as the default dialect.
- Z80 assembly as an opt-in dialect selected by CLI flag (`--asmsx`).
- asMSX comment forms: `;`, `//`, `--`, `/* ... */`, and `{ ... }`; unterminated block comments diagnose.
- asMSX `DT`/`DEFT` data aliases, `.BYTE`/`.WORD` reservations, and `.RANDOM(n)` expressions.
- asMSX numeric literals follow [section 2.3.1 of the asMSX manual](https://github.com/Fubukimaru/asMSX/blob/master/doc/asmsx.md#231-numeric-formats): decimal integers and floats, `0`-prefixed or `o`-suffixed octal, `0x`/`$`/`h` hexadecimal, and `b`-suffixed binary.
- `$` in conditional-assembly expressions and equates is the current line index, an assembler-free approximation of the program counter; no instruction sizes are accumulated, and `org`/`phase` do not rebase it.
- asMSX `.BIOS` labels show MSX BIOS routine descriptions in hover.
- asMSX `.BIOSVARS` labels show MSX system-variable descriptions in hover.
- Labels, equates, and macros accept `;! ` doc comments on their definition line or on consecutive lines immediately before the definition; symbol hover appends the documentation at call sites.
- Undocumented Z80 `SLL` and `IXH`/`IXL`/`IYH`/`IYL` forms when source selects `CPU Z80`; diagnostics reject them for `CPU Z180` and `CPU EZ80`.
- Z180 block-I/O `OTIM`, `OTIMR`, `OTDM`, and `OTDMR` under `CPU Z180` or `CPU EZ80`; diagnostics reject them for `CPU Z80`.
- eZ80 memory-addressed `INIM`, `INIMR`, `INDM`, and `INDMR` under `CPU EZ80`; shared `OTIM`/`OTIMR`/`OTDM`/`OTDMR` output opcodes remain valid under `CPU Z180` and `CPU EZ80`.
- eZ80 extended block-I/O `INI2R`, `IND2R`, `OTI2R`, `OTD2R`, `INIRX`, `INDRX`, `OTIRX`, and `OTDRX` under `CPU EZ80`; unsupported `INIR2`, `INDR2`, `OTIR2`, and `OTDR2` forms reject.
- Directive metadata defines Z80/asMSX and eZ80 availability for parsing and completion; `incbin` completes in both modes.
- Local-label completion replaces typed `@` or `@@` prefixes instead of appending a second prefix.
- Formatting preserves macro call spelling; macro calls require exact declaration case.
- Formatting emits `MACRO` without a leading dot and puts `ENDM` at column 0.
- asMSX macro parameters require a leading `#`, comma separators, and declaration; violations diagnose.
- asMSX macro declarations use `<name>: MACRO`; colonless names diagnose.
- eZ80 undotted directives require leading whitespace; dotted directives may begin in column 1.
- eZ80 labels must end with `:` and allow at most 32 characters; mnemonics, directives, and condition names cannot be labels.
- eZ80 double-quoted and both-dialect single-quoted character strings decode escapes; eZ80 quoted include paths resolve decoded escape values, and invalid escapes diagnose.
- Data, reservation, alignment, macro, and terminator directives diagnose invalid arity and numeric ranges.
- Macro bodies diagnose unresolved globals and macro calls while allowing declared parameters and unresolved local labels.
- Parser-based diagnostics.
- Cross-file symbol resolution across project sources.
- The same LSP feature set exposed by `../merls`:
  - diagnostics
  - hover
  - completion
  - go to definition
  - find references
  - document symbols
  - workspace symbols
  - semantic tokens
  - rename
  - formatting
  - folding ranges
  - document highlights
  - inlay hints
  - signature help
  - call hierarchy
  - code lens
  - document links
  - selection ranges
- A standalone npm package usable from `coc.nvim`.
- A VS Code extension in `vscode/` that bundles the language server.
- Automatic symbol completion in the bundled VS Code extension.

## Doc comments

A semicolon comment beginning exactly with `;! ` documents a label, equate, or macro. Hovering over a reference to that symbol appends the documentation to its definition information.

Put a single doc comment at the end of the definition:

```asm
entry: nop ;! Entry-point label.
LIMIT: equ 10 ;! Maximum item count.
```

Or put one or more consecutive doc-comment-only lines immediately before the definition:

```asm
;! Writes one byte to the output.
;! Preserves the accumulator.
write_byte:
```

Blank lines, ordinary comments, and source lines end a preceding doc-comment block. Macro declaration syntax remains mode-specific. Complete label, equate, and macro examples for both forms live in [`examples/doc_comments.z80`](examples/doc_comments.z80) for asMSX and [`examples/doc_comments.ez80`](examples/doc_comments.ez80) for ez80asm.


## Expression precedence

Both dialects use C-like operator precedence. The asMSX manual (section 2.3.2)
specifies "The precedence order is same as in C/C++", and eZ80 expressions
follow the same rules. Operators with equal precedence evaluate left-to-right.

For example, `1 | 2 + 3` evaluates to `5` (`1 | (2 + 3)`) in both modes.

Use parentheses for expression grouping, except after asMSX `.ZILOG`, where brackets group expressions.

### Out of Scope

- Non-Zilog CPU families.
- Assembler backends or binary emission in the initial implementation unless required for extension UX parity.

## Planned Technical Direction

- Runtime: Node.js
- Language: TypeScript
- LSP library: `vscode-languageserver`
- Process model: standalone stdio server plus bundled VS Code client
- Default CLI contract: `zils --stdio` (defaults to ez80)
- CPU selection contract: `zils --stdio --asmsx` (switches to z80 mode and enables asMSX directives).

## coc.nvim Target

The server should be directly usable from `coc.nvim`. The intended configuration shape is:

```json
{
  "semanticTokens.enable": true,
  "languageserver": {
    "zils": {
      "command": "zils",
      "args": [
        "--stdio"
      ],
      "rootPatterns": [
        ".git",
        "package.json"
      ],
      "filetypes": [
        "z80"
      ]
    }
  }
}
```

An example config lives in `examples/coc-settings.json`.

## VS Code Target

The `vscode/` directory should contain an installable Visual Studio Code extension that bundles and launches the server without requiring a separate global install.

## Development Rules

- TDD is required for all implementation work.
- No task is complete until tests and linting pass completely with no warnings.
- If behavior, workflow, or scope changes, documentation must be updated in the same task.
- Do not add separate testing-only tasks to `TODO.md`; tests belong inside each implementation task.
