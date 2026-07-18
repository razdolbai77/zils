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
