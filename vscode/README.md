# Zaets

Z80 and eZ80 assembly language support for Visual Studio Code, powered by the [zils](https://codeberg.org/razdolbai/zils) language server.

## Features

- **Dual Dialect Support**: Automatically provides language support for `asMSX Z80 assembly` (`.z80`) and `Agon-ez80asm eZ80 assembly` (`.ez80`).
- **Language Server Integration**: Full integration with the `zils` language server, bundling advanced editor features like:
  - Real-time diagnostics and error reporting
  - Signature help and inlay hints
  - Code actions and code lens
  - Document links and call hierarchy
  - Code navigation and workspace indexing
  - Automatic symbol completion while typing assembly operands

## Extension Settings

This extension contributes the following settings:

* `zaets-z80.trace.server`: Traces the communication between VS Code and the Z80 language server. Options are `off`, `messages`, or `verbose`.
* `zaets-ez80.trace.server`: Traces the communication between VS Code and the eZ80 language server. Options are `off`, `messages`, or `verbose`.

## Repository

The source code for this extension and the underlying language server is available at [https://codeberg.org/razdolbai/zils](https://codeberg.org/razdolbai/zils).

## License

[MIT License](https://codeberg.org/razdolbai/zils/src/branch/main/LICENSE)
