# Repository Guidelines

## Project Structure & Module Organization

This repository is planned as a Node.js and TypeScript workspace modeled after `../merls`, but for Z80 and eZ80 assembly.

**CRITICAL RULE:** This project MUST be as aligned as possible with `../merls` -- including dependencies, architecture, features, and messages' format. Every architectural and dependency choice should perfectly mirror `merls`.

Keep the implementation structure aligned with these paths:

- `src/asm/`: lexer, syntax metadata, parser, expressions, document model, symbols, diagnostics, workspace indexing, and dialect metadata.
- `src/lsp/`: LSP feature handlers.
- `src/server.ts`: LSP server wiring.
- `src/cli.ts`: packaged CLI entrypoint, compiled to `dist/src/cli.js`.
- `test/`: unit, integration, and fixture-driven tests.
- `test/fixtures/valid/`: supported Z80 and eZ80 syntax samples.
- `test/fixtures/invalid/`: unsupported or malformed syntax samples with expected diagnostics.
- `examples/`: editor integration examples such as `examples/coc-settings.json`.
- `vscode/`: VS Code extension that bundles the language server.

Prefer small modules with explicit types and single-purpose exports. Keep parsing, semantic analysis, and LSP wiring separate.

## Build, Test, and Development Commands

Once the workspace is scaffolded, keep the baseline command set aligned with `../merls`:

- `npm install`: install dependencies.
- `npm run lint`: run ESLint with zero warnings allowed.
- `npm run build`: compile TypeScript into `dist/`.
- `npm test`: run linting, build, and the full test suite.
- `npm run dev`: TypeScript watch mode for iterative development.
- `cd vscode && npm test`: compile and run VS Code extension tests.

The primary stdio launch contract should be `zils --stdio` which defaults to eZ80 assembly. Z80 assembly (with asMSX directives) is selected by the `--asmsx` flag.

## Coding Style & Naming Conventions

Use TypeScript throughout. Use `camelCase` for functions and variables, `PascalCase` for types and classes, and kebab-case for configuration and example filenames.

Represent dialect differences explicitly in metadata and analysis layers rather than scattering special cases through handlers. Keep Z80 and eZ80 instruction/directive rules data-driven where practical.

## Testing and Linting Guidelines

TDD is mandatory in this repository. Every implementation task must start by adding or extending a failing automated test, then proceed to implementation, then finish with passing tests and linting.

Do not create separate testing-only tasks in `TODO.md`; test work is part of each implementation task.

No task is complete unless all of the following are true:

- `npm run lint` passes with no warnings.
- `npm test` passes completely.
- Any affected documentation is updated, including `README.md` and `AGENTS.md` when repository behavior, workflow, or contributor expectations change.

Prefer focused unit tests for lexer/parser/document-model behavior and integration tests for CLI and LSP requests such as `initialize`, diagnostics, hover, completion, navigation, and rename.

## Commit & Pull Request Guidelines

Use short, imperative commit subjects such as `Add Z80 lexer fixtures`.

Keep changes scoped to one coherent task from `TODO.md`. PRs should summarize user-visible behavior, note tests added or updated, and mention any dialect-specific assumptions or limitations for Z80 versus eZ80.
