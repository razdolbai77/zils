# Codebase Improvement Plan

## High Priority - Architecture & Performance

- [x] Make `indexWorkspace` asynchronous in `src/asm/workspace.ts` to prevent blocking the LSP event loop with synchronous file reads (`fs.readFileSync`).
- [x] Implement caching for workspace documents and symbols in `src/server.ts` to avoid re-indexing the entire workspace on every LSP request (e.g. `onHover`, `onDefinition`).

## Medium Priority - Inconsistencies

- [x] Rename `src/asm/line_parser.ts` to `src/asm/line-parser.ts` to align with the project's kebab-case file naming convention.
- [x] Rename `test/line_parser.test.ts` to `test/line-parser.test.ts` to align with the project's kebab-case file naming convention.
- [x] Update imports across `src/` to point to the new `line-parser.ts` filename.

## Low Priority - Refactoring

- [x] Unify local label resolution logic (`@@`, `@b`, `@f`) in `src/lsp/symbol-navigation.ts` by extracting it into a shared utility function instead of duplicating it in `findDefinition` and `findReferences`.
- [x] Refactor the massive `collectDiagnostics` function in `src/asm/diagnostics.ts` by extracting logic for specific mnemonics/directives into smaller validation helper functions.
- [x] Simplify nested try-catch blocks and if statements for `subpage`, `select`, `page`, and `org` directives in `collectDiagnostics`.
- [x] Move hardcoded maximum bounds (e.g., 16777215 for 24-bit EZ80 addresses) in `collectDiagnostics` to explicit constants in `src/asm/metadata.ts`.
