# Zaets Extension Help

Welcome to the Zaets extension! This extension provides rich support for Z80 and eZ80 assembly languages, powered by the zils language server.

## Features

- **Syntax Highlighting:** Full support for Z80 and eZ80 assembly syntax.
- **Diagnostics:** Real-time syntax checking and semantic validation.
- **Hover Information:** Hover over instructions and directives for signatures and explanations. Hover over symbol references to see definition location plus any `;! ` doc comment attached to label, equate, or macro.
- **Auto-completion:** Context-aware completion for instructions, directives, symbols, and registers.
- **Go to Definition / References:** Navigate through your assembly codebase seamlessly.


### Doc comments

Start an end-of-line or preceding comment with `;! ` to document a label, equate, or macro:

```asm
LIMIT equ 10 ;! Maximum item count.

;! Writes one byte.
;! Preserves accumulator.
write_byte:
```

Preceding doc-comment lines must be consecutive and immediately before definition. Hovering a reference displays documentation.
## Commands

- [Zaets: Signatures' Help](./signatures-help.md): Learn about the signature format used in hover documentation and understand what placeholders like `pp`, `qq`, and `ss` mean.

For more information and source code, please visit the [Zils Repository](https://codeberg.org/razdolbai/zils).
