# Codebase Improvement Plan

Audit date: 2026-07-17. Add or extend a failing regression test inside each implementation task, then run `npm run lint`, `npm test`, and `npm --prefix vscode test` until the root command includes the extension suite. Current baseline: 167 root tests and 7 VS Code extension tests pass; `npm audit` reports no known vulnerabilities.

## High Priority - Correctness and Broken Public Contracts

- [x] Guard zero-token operands before directive-specific validation in `src/asm/diagnostics.ts:579-874`; start with table-driven regressions for `include ,`, `cas ,`, `megarom ,`, and `incbin ,` that assert diagnostics are returned instead of `collectDiagnostics` throwing.
- [x] Reject `TokenType.String` as a numeric instruction expression in `src/asm/diagnostics.ts:201-203,952-1067`; test that `ld a,"x"`, `jp "x"`, and `bit "x",a` fail while string-bearing data/include directives remain valid.
- [x] Qualify local references with their current global scope in `findUnresolvedSymbols` (`src/asm/diagnostics.ts:43-77,463-487`) instead of suppressing every `.`/`@` name; cover resolved and misspelled eZ80 and asMSX local labels.
- [x] Propagate `dialect` and `isAsmsx` from `startServer` through `collectDiagnosticsByUri` to `indexWorkspace` (`src/server.ts:355-362`, `src/lsp/diagnostics.ts:12-60`) so disk-loaded includes use the entry document's rules; test an asMSX root with a disk-only dependency.
- [x] Add a document-state generation guard around `getIndexedDocuments` (`src/server.ts:105-147`) so an older asynchronous index cannot overwrite the cache after a newer edit; test out-of-order index completion.
- [x] Discard superseded `publishDiagnostics` runs and include the current text-document version in notifications (`src/server.ts:307-362`); test a delayed broken-to-fixed edit sequence with no late stale diagnostic.
- [x] Replace the `**/.clientrc` watchers in `vscode/src/extension.ts:49-61` with supported Z80/eZ80 source and include globs; assert watcher patterns and file/untitled selectors in `vscode/src/extension.test.ts`.
- [x] Make definition/reference indexing tolerate non-file URIs in `src/lsp/symbol-navigation.ts:51-202`; preserve opaque URIs instead of unconditionally calling `fileURLToPath`/`pathToFileURL`, and test requests while an `untitled:` document is open.
- [x] Implement metadata-backed instruction signature help in `src/lsp/signature-help.ts:5-25` and pass `position.character` from `src/server.ts:248-254`; replace the null-result test with signature label and active-operand assertions.
- [x] Convert absolute token offsets to line-relative characters in `src/lsp/document-links.ts:9-28`; add a link on a non-first line and assert the exact quoted-path range.

## Medium Priority - Parser, Analysis, and LSP Correctness

- [x] Honor `ReferenceContext.includeDeclaration` in `src/lsp/symbol-navigation.ts:137-201` by excluding label-definition tokens from the unconditional reference scan; test exact results for both flag values and indented/local definitions.
- [x] Disambiguate asMSX `rl` instruction syntax from the reserve-long directive in `src/asm/line-parser.ts:30-36,75-125`; test `rl c`, `value rl 1`, and an invalid rotate operand.
- [x] Report unknown dotted directives instead of treating every dot-prefixed word as valid in `src/asm/line-parser.ts:86-125`; cover valid `.org` and misspelled `.ogr` ranges.
- [x] Detect unterminated single- and double-quoted strings in `src/asm/lexer.ts:158-169` without dropping the final character; surface a precisely ranged parser diagnostic and retain closed-string behavior.
- [x] Preserve one `LineNode` per physical editor line in `src/asm/document.ts:26-55`, including empty input, trailing blanks, CRLF, and CR-only lines; assert line counts and diagnostic columns for each newline form.
- [x] Reject division/modulo by zero and truncate signed integer division toward zero in `src/asm/expressions.ts:200-243`; cover `5/0`, `5%0`, and `-5/2`.
- [x] Stop validating relative-branch `e` operands as raw displacements in `src/asm/diagnostics.ts:327-329` until per-line program-counter tracking exists; test a valid high-address `org`/`jr` target without a false range error.
- [x] Reconstruct the complete contiguous unquoted include operand, or diagnose that quotes are required, in `src/asm/workspace.ts:139-150`; ensure `include lib.asm` never resolves a truncated `lib` path.
- [x] Parse first-column colonless labels before known instructions in `src/asm/line-parser.ts:65-84` without reclassifying indented mnemonics; cover `loop jr loop` and indented `ld a,b`.
- [x] Preserve explicit `label`, `equate`, `data`, and `macro` symbol kinds across `src/asm/symbols.ts:5-105` and `src/asm/workspace.ts:10-71`; index operation-first macro declarations and test all four kinds.
- [x] Pass and honor the requested range in `buildInlayHints` (`src/server.ts:256-261`, `src/lsp/inlay-hints.ts:5-60`) and subtract each line's absolute start from hint positions; test uses above, inside, and below the range.
- [x] Make selection ranges reject invalid positions and treat both `.` and `@` labels as local in `src/lsp/selection-ranges.ts:16-84`; test dot-local scope nesting and an out-of-range request.
- [x] Advertise assembly-appropriate completion trigger characters in `src/server.ts:64-67`, aligned with `../merls/src/server.ts`; assert representative identifier and local-label triggers during initialize.
- [x] Remove the no-op code-action capability, handler, module, and README claim (`src/lsp/code-actions.ts`, `src/server.ts:84-86,263-269`, `README.md:41`); replace the empty-result subtest with an initialize-capability assertion so coverage is retained.
- [x] Replace synchronous watched-file reads in `src/server.ts:334-353` with batched `fs.promises.readFile` calls and one cache invalidation/diagnostic publication after the batch; test changed, unreadable, and deleted dependencies.

## Medium Priority - Packaging

- [x] Append `npm --prefix vscode test` to the root `test` script in `package.json:15-19` so the canonical verification command covers the shipped extension, matching `../merls/package.json`.
- [x] Align the contributed trace settings in `vscode/package.json:74-87` with the actual `zaets-z80` and `zaets-ez80` client IDs, or explicitly propagate one shared setting; test manifest/client-ID consistency.

## Low Priority - Performance, Consistency, and Publishing Hygiene

- [x] Rework `src/lsp/code-lens.ts:16-38` to count references with one scan of the already indexed workspace instead of re-indexing once per definition; instrument a multi-label test to assert one indexing pass.
- [x] Add a server-owned disk-document cache to `indexWorkspace` (`src/asm/workspace.ts:40-137`) following `../merls/src/asm/workspace.ts`; test dependency-object reuse and invalidation by overrides/watched changes.
- [ ] Generate directive completion entries from the canonical `DIRECTIVES` map instead of the duplicate list in `src/lsp/completion.ts:15-20`; assert each supported directive appears exactly once for the applicable dialect.
- [ ] Align root npm metadata with merls by adding `type`, `repository`, `engines`, and `clean`, removing unused `ts-node`, and refreshing `package-lock.json`.
- [ ] Exclude emitted `out/**/*.test.js` files from the VSIX in `vscode/.vscodeignore:1-7`; verify the package file list retains runtime/docs assets and omits tests, source maps, and dev-only code.

## Completed from Previous Audit

- [x] Make workspace indexing asynchronous instead of using synchronous file reads.
- [x] Cache indexed documents and symbols between LSP requests.
- [x] Rename `line_parser.ts` and its test to kebab-case and update imports.
- [x] Unify anonymous/local-label navigation helpers.
- [x] Split mnemonic/directive validation out of the original monolithic diagnostic flow.
- [x] Simplify `subpage`, `select`, `page`, and `org` directive validation.
- [x] Move Z80/eZ80 maximum address bounds into metadata constants.
