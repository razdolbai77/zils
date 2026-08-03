# Codebase Improvement Plan

Audit date: 2026-08-03 (full re-audit; previous 2026-07-17 / 2026-07-24 items all completed, see git history). Per repo TDD rule: every task starts with a failing regression test, then implementation, then `npm run lint` + `npm test` green. Token offsets in `LineNode` tokens are DOCUMENT-ABSOLUTE UTF-16 code units; LSP ranges are line-relative — several tasks below fix places that forget the subtraction.

## High Priority - Correctness Bugs

### Core pipeline (document / lexer / parser / expressions)

- [x] Fix multi-line block comment desync: `lexBlockComment` (src/asm/lexer.ts:219-237) swallows interior newlines into one Comment token while `AsmDocument.parse` (src/asm/document.ts:44-57) zips LineNodes 1:1 against physical lines, shifting every later line's diagnostics by (span-1) in asMSX mode; emit Newline tokens for comment-internal newlines (or map lines by token offset) and test a 3-line `/* ... */` with a broken instruction on the following line.
- [x] Fix inverted asMSX Pratt precedence table in `getAsmsxInfixOperator` (src/asm/expressions.ts:92-136): comparisons bind at 7 (tightest) above unary 5/6 and additive at 1 (loosest), so `-a == b` parses as `-(a==b)` and `a + b == c` as `a + (b == c)`; reorder the table to match the eZ80 recursive-descent grammar and add precedence tests for both dialects (`-a == b`, `a + b == c`, `a && b + c`).
- [x] Fix the eZ80 column-0 directive check `identToken.start === 0` (src/asm/line-parser.ts:153) which compares an absolute file offset and can only fire on the first line; compare against the current line start (helper `isAtLineStart` at src/asm/line-parser.ts:42-52 already exists) and test `db 1` on line 2+.
- [x] Resolve the `zilog` contradiction: `LineParser` sets `this.isAsmsx = true` (src/asm/line-parser.ts:159-161) while `collectDiagnostics` sets `currentIsAsmsxSyntax = false` (src/asm/diagnostics.ts:216-218); pick the documented direction (metadata.ts:154 says zilog switches bracket/paren use from that point — tests in test/diagnostics.test.ts:315-331 assume zilog → Zilog/paren mode, i.e. asmsx-bracket syntax OFF) and make both layers agree; extend the existing zilog tests to cover both dialect-state consumers.
- [x] ~~Make `zilog` take effect lexically~~ — premise disproven against the reference assembler (Fubukimaru/asMSX): its `parser3.l` preprocessor swaps only `(`/`[` and `)`/`]` after `.zilog` (strings copied verbatim), and `lex.l` has zero zilog references, so comment styles, `#` handling, and escape decoding are correctly unaffected by `.zilog`. Implemented instead: three pinning tests in test/diagnostics.test.ts asserting comments, numeric token classes, and double-quote escape rules stay in asMSX mode after `.zilog`, plus the task-12 byte/word state test.

### Diagnostics state machine (src/asm/diagnostics.ts)

- [x] Move the `line.isInactive` gate (src/asm/diagnostics.ts:410-412) ahead of the state-changing directive handlers (cpu 255-271, relocate/endrelocate 272-296, if/else/endif 297-326, macro/endm region 327-408, zilog 216-218) so inactive conditional blocks cannot flip `currentCpu`, `currentIsAsmsxSyntax`, or push relocate/macro stacks; keep if/macro nesting balance for the inactive scan; test `.cpu z180` and `zilog` inside a false `if` block.
- [x] ~~Reject double ELSE~~ — premise disproven: reference asMSX (dura.y:766-771) XOR-toggles the conditional on ELSE, so `if/else/else/endif` is legal and flips the branch back on; zils' own inactivity engine (src/asm/symbols.ts:99-105) implements the same toggle, so rejecting would flag code the engine treats as active. Implemented instead: a pinning test asserting repeated ELSE toggles branch state in both dialects (only the toggled-active middle branch reports its error).
- [x] Fix macro stack corruption cascades: a `macro` without a name skips the stack push but a later `endm` reports "ENDM without matching MACRO", and nested-macro push still increments `macroDepth` (src/asm/diagnostics.ts:327-408) corrupting pairing; push a sentinel or suppress downstream cascade, and test the nameless + nested cases end to end.
- [x] Enforce the strict `subpage`/`select` shape from the reference grammar: the literal edge cases (`at` first/last, short operands) already produced "requires format" diagnostics, but probing exposed residual gaps the reference grammar rejects — multiple `at`, boundary `at` with extra tokens, and unparseable sides (`subpage 1 at 0x100 0x200`) all passed silently. Extended the generic validator to require exactly one interior `at` with parseable expressions on both sides (dura.y:470 `PSEUDO_SUBPAGE value PSEUDO_AT value`), and added a shape test covering malformed, symbol-address, valid, and out-of-range lines.
- [x] Stop swallowing operand syntax errors in macro bodies: probing showed `#param` malformed operands already surface, but the `isMacroLocalOperand` catch-continue silently accepted genuine syntax errors in `.local` and `@`-local operands (`ld a,(.loop` → clean). The try block only throws from `ExpressionParser.parse()`, so replaced the blanket swallow with a targeted tolerance for pure dotted-label references (`jr ..local_label`, legal macro labels the expression grammar cannot parse) and surface every other failure via `addDiagnostic`, invalidating the enclosing macro; tests cover `.local`/`@b`/`#param` syntax errors, invocation flagging, and a clean valid-macro control.
- [x] Fix forward references to eZ80 macro-local labels: probing showed the qualification path itself was sound (callers match both stripped and unstripped forms), but `localDefs` accumulated incrementally during the scan, so `jr @loop` before `@loop:` inside a macro body false-errored and marked the macro invalid. Pre-collect the whole macro body's local labels at macro-open (`collectMacroLocalDefs`, two-pass like the reference assembler, skipping inactive lines and nested-macro interiors) and removed the incremental accumulation; outer-local rejection stays as pinned by existing tests. Added forward-ref, invocation, and never-defined regression tests.
- [x] Skip inactive lines in anonymous-label scans: probing showed `@@` defined only inside a false conditional still satisfied `@b`/`@f`/`@n`/`@p` (the label never assembles yet references resolved clean). Added `!l.isInactive` to both the backward and forward scans in `hasMatchingAnonymousLabel`; the `macroStartLine` limit was already present in the backward scan. Tests cover both directions in both dialects plus a control where an active `@@` still matches alongside an inactive one.
- [x] Range-check nested index-offset chains and surface evaluation errors: probing showed `extractIndexOffset` only handled top-level `ix±d`/`d+ix`, so chains (`ix+200+200`, `ix-200-80`) skipped range checks, and the blanket `catch {}` swallowed evaluation errors like division by zero. Rewrote extraction as a recursive `+/-` spine walk counting exactly one `ix`/`iy` anchor (constant subtrees are evaluated, so eval errors propagate), and narrowed the catch to silently ignore only ParseError while emitting evaluation errors; probing also showed `(5-ix)` signature-matches as generic `(nn)` and never reaches the offset gate, pinned with a negative assertion.

### Workspace indexing (src/asm/workspace.ts, src/server.ts)

- [x] Surface broken includes: `indexWorkspace` now records `FailedInclude` entries (includer path, line, operand range, resolved path) whenever a resolved include cannot be read, and `collectDiagnostics` emits "Cannot load included file: <name>" anchored on the include operand; covers `include`/`.include`/`maclib`, missing and unreadable (EISDIR) targets, and multiple failures per file. Created the missing `test/fixtures/valid/somefile.asm` that `advanced.asm` references, and updated two string-tests whose include lines now legitimately report the missing file.
- [x] Make workspace path keying case-insensitive on win32: added an exported `pathKey()` (lowercase on win32, verbatim elsewhere, `untitled:` untouched) and reworked `indexWorkspace`/`visitFile` to look up overrides/diskCache/documents by `pathKey` while keying `documents`/`loadOrder`/`dependencies`/`failedIncludes` by canonical first-seen spelling; a new `pathIndex` maps keys to canonical spellings so display URIs keep their original casing. server.ts override building and diskCache set/delete now use original spellings + `pathKey`; `collectDiagnostics` resolves through `pathIndex`. Tests: override hit with differing case, dedup of same file included twice in different casing, plus updated key assertions and harness stub.
- [ ] Fix stale `diskDocumentCache` (src/server.ts:111,148 with src/asm/workspace.ts:106-112): cached includes never refresh when change events are missed, and `.lib`/`.inc` includes are never watched; add stat/mtime freshness to `visitFile` cache reads (or key by mtime) and extend watchers to include extensions (metadata maclib list), with a test editing a `.lib` include through the watched-file path.
- [ ] Memoize the in-flight index promise in `getIndexedDocuments` (src/server.ts:161-162): the generation-check recursion re-enters and concurrent requests each run a full `indexWorkspace`; store and return the pending Promise, and assert one indexing pass for two overlapping requests.
- [ ] Publish diagnostics over the indexed document set instead of open+watched only (src/server.ts:405-417, src/lsp/diagnostics.ts:13-16), aligning with ../merls/src/server.ts:299-307 while keeping zils' generation guard and version field; test that an include-only file with an error gets published diagnostics.

### LSP handlers

- [ ] Fix call-hierarchy absolute offsets: prepare uses `defLine.labelToken.start` raw (src/lsp/call-hierarchy.ts:48) and outgoing calls use absolute `token.start` for `fromRanges` and target items (src/lsp/call-hierarchy.ts:139,160,167-169); subtract `line.start` as code-lens.ts:33-35 does, and test a call target defined at column 4+ and invoked from an indented line.
- [ ] Replace the rename range-shape heuristic (src/lsp/rename.ts:110-127): filtering `span === tokenLen` misclassifies a definition line whose full width equals the name length (whole line replaced by newName) and drops definition sites whose width differs; have `findReferences` return tagged def-vs-ref locations and test a 2-char label on a 2-char line.
- [ ] Guard full-sync assumption in `onDidChangeTextDocument` (src/server.ts:340-345): `contentChanges.at(-1)?.text` is treated as full text with no check, and state was already invalidated before the early return; assert TextDocumentSyncKind.Full or handle incremental deltas, with a test for an empty `contentChanges` array.
- [ ] Fix close-document diagnostic race (src/server.ts:353-364): the explicit empty `sendDiagnostics` races the follow-up `publishDiagnostics`, and URIs dropping out of `diagnosticsByUri` are never cleared; publish the clear through the same generation-guarded path and skip publishing for closed URIs, with a rapid close/reopen test.
- [ ] Consolidate the four URI↔path conversion variants (src/server.ts:145-147, src/lsp/diagnostics.ts:88-93, src/lsp/symbol-navigation.ts:51-57, src/asm/workspace.ts:28-40) into one `uriToPath`/`pathToUri` pair in src/asm/workspace.ts with try/catch around `fileURLToPath`, and make `normalizeUri` actually lowercase the Windows drive letter as its comment claims (src/asm/workspace.ts:28-39); test `file:///c:/` vs `file:///C:/` equality.

### VS Code extension

- [ ] Handle client start failure in vscode/src/extension.ts:87-88: `z80Client.start(); ez80Client.start();` are unhandled, unlike ../merls which does `.catch(err => window.showErrorMessage(...))`; add catch + `Zaets LSP failed to start:` message and assert it in vscode/src/extension.test.ts.
- [ ] Guard missing server module in vscode/src/extension.ts:16-25: when neither localServerPath nor packagedServerPath exists the fallback makes `start()` fail opaquely; verify existence and `showErrorMessage` + abort activation, with a test.

## Medium Priority - Validation, Error Handling, Consistency

### Parser and expressions

- [ ] Make trailing-comma operands consistent in parseOperands (src/asm/line-parser.ts:172-183): `ld a,` yields `[[a]]` while `ld ,b` yields `[[],[b]]`; push the empty trailing operand (or diagnose it) and assert downstream arity validation sees the same shape for both.
- [ ] Unify malformed-number lexing policy (src/asm/lexer.ts:296-303 vs 318-352): invalid `#xyz`/bare `#` becomes Identifier while `$xyz`/`%abc`/`0b12` become Unknown; pick one fate (Unknown) for all numeric prefixes with tests per prefix.
- [ ] Fix bitwise/division evaluation semantics in `evaluate` (src/asm/expressions.ts:470-477): Int32 coercion makes `0xFFFFFFFF` → -1 and `1 << 33` → 2 while +,-,* stay doubles, and `Math.trunc` breaks asMSX float division (`1.5/2` → 0); mask to a documented word width (or truncate only for integral operands) with tests including asMSX floats.
- [ ] Make `PI` lookup-safe (src/asm/expressions.ts:419): it is intercepted case-insensitively before symbol lookup so a user label `pi` never resolves; gate per dialect or try symbol lookup first, with a conflicting-label test.
- [ ] Unify error reporting: `evaluate` throws plain Error while parsers throw ParseError (src/asm/expressions.ts:421-490) and line-parser.ts:204 loses the token for non-ParseError throws (column-less diagnostics); convert eval failures to token-anchored ParseError at the parse site.

### Symbols and metadata

- [ ] Gate BIOS symbol injection on asMSX: `SymbolCollector` injects ~280 bios/biosvars symbols unconditionally (src/asm/symbols.ts:119-127) while hover already gates on isAsmsx; gate the collector and skip/report user-name collisions, testing a plain eZ80 file with a label named `bios`.
- [ ] Consume or delete `SymbolCollector.getErrors` (src/asm/symbols.ts:224-226): duplicate-symbol (:157), local-without-global (:149), and equ-eval errors (:174) are recorded but never read by workspace.ts:65-66; wire them into `collectDiagnostics` (or remove), and fix `$`-relative equates evaluating against constant `currentLoc = 0` (:61,:74).
- [ ] Remove the implicit `isInactive` side-effect coupling: `SymbolCollector.collect` mutates `LineNode.isInactive` (src/asm/symbols.ts:114-117) and diagnostics.ts only reads it, making correctness depend on call order; compute inactive state explicitly during parse/index and test diagnostics on a file never passed through a collector.
- [ ] Fix workspace symbol shadowing (src/asm/workspace.ts:59-73): the merged map is last-loaded-wins so an included file's symbol shadows the entry file's; store all definitions per name (or give entry precedence) and test go-to-definition landing in the entry file.
- [ ] Derive BIOS name sets from the description maps: `BIOS_ROUTINES`/`BIOS_VARS` in src/asm/metadata.ts:345-371 duplicate the keys of src/asm/bios.ts and src/asm/bios-variables.ts and can drift; build the Sets from `Map.keys()` and assert equality in a test.

### LSP handler robustness

- [ ] Standardize request-parameter validation: selection-ranges fails the WHOLE request on one bad position (src/lsp/selection-ranges.ts:13-18) instead of per-position results; hover/symbol-navigation guard line but not character (src/lsp/hover.ts:47-48, src/lsp/symbol-navigation.ts:15-16); inlay-hints clamps lines not characters (:24-25); formatRange never validates bounds (src/lsp/formatting.ts:39-46); add one shared position/range clamp helper and test out-of-range inputs per handler.
- [ ] Fix document-link URL resolution (src/lsp/document-links.ts:22): `new URL(targetPath, uri)` breaks Windows backslash and absolute paths; resolve via `path.resolve(dirname(fileURLToPath(uri)), value)` + `pathToFileURL` mirroring workspace.ts:144-146, and test `include "sub\file.z80"`.
- [ ] Fix code-lens local reference over-counting (src/lsp/code-lens.ts:29-63): unqualified references to a `.local` from outside its scope are counted; check scope before counting and assert exact counts for out-of-scope references.
- [ ] Cache per-generation symbol tables: six handlers re-run `SymbolCollector` over every indexed document per request (src/lsp/semantic-tokens.ts:50-55, completion.ts:175-181, inlay-hints.ts:18-24, code-lens.ts:29, rename.ts:97, document-highlights); attach symbol tables to the indexed-documents generation and assert one collection pass for repeat requests.
- [ ] Thread `diskDocumentCache` through the per-request `indexWorkspace` calls in src/lsp/symbol-navigation.ts:118,177 and src/lsp/diagnostics.ts:41 (currently only server.ts:148 passes one), and make `collectDiagnosticsByUri`'s sequential per-open-file loop reuse one index; measure with a multi-include fixture.
- [ ] Fix completion operand-context heuristic (src/lsp/completion.ts:113-121): any identifier before the cursor sets hasMnemonic, so `FOO equ 1` with the cursor after FOO suppresses FOO's own completions, and the comment check admits completions at the `;` boundary; classify by mnemonic position and test both cases.
- [ ] Standardize handler "document not found" returns: selection-ranges/signature-help/hover/definition return null while list features return [] for the same failure class; pick [] for list features and document the choice, updating affected tests.

### CLI and packaging

- [ ] Stop silently swallowing unknown CLI flags (src/cli.ts:38-41): `zils --stdio --asmx` (typo) starts the wrong dialect with no warning, and `--help`/`--version` only work as the sole argument (:16,:21) so `zils --stdio --help` starts the server; warn on unrecognized flags (allowlist client-injected ones like `--clientProcessId`) and honor help/version anywhere; extend test/cli.test.ts.
- [ ] Align vscode-languageclient major with ../merls: zils uses ^10.1.0 with engines.vscode ^1.91.0 and pinned '@types/vscode' 1.91.0 (vscode/package.json:14,120,125) while merls uses ^9.0.1/^1.80.0; pick one major for both repos per the alignment rule and update locks.
- [ ] Align root package.json script forms with ../merls (package.json:20-26): build 'tsc' vs 'tsc -p tsconfig.json', dev '--watch' form, lint '--max-warnings=0' vs '--max-warnings 0'; copy merls forms (keep the `clean` step decision documented).
- [ ] Add 'package.json' to examples/coc-settings.json rootPatterns to match ../merls/coc-settings.json (zils lists only '.git').

## Low Priority - Refactoring, Hygiene, Documentation

### Lexer/parser cleanup

- [ ] Delete the dead `af'` pre-check with its confused comment (src/asm/lexer.ts:132-141).
- [ ] Advance astral characters by code point instead of emitting lone-surrogate Unknown tokens one code unit at a time (src/asm/lexer.ts:202-204).
- [ ] Merge `isPunctuation` array and `getPunctuationType` switch into one table (src/asm/lexer.ts:375-400) and table-drive the multi-char operator ifs in `nextToken` (:100-207).
- [ ] Remove quadratic `source.substring(position)` scans (src/asm/lexer.ts:149,293) in favor of `startsWith`/anchored regex; benchmark on a large fixture.
- [ ] Split `parseLine` (~160 lines, depth 5, src/asm/line-parser.ts:60-219) into parseLabel/parseMnemonic/parseOperands, unifying the four dotted/undotted × colon/equals label branches (72-100).
- [ ] Extract the duplicated token-cursor helpers (check/peek/isAtEnd/consume) from src/asm/line-parser.ts:221-256 and src/asm/expressions.ts:367-399 into a shared module; fold `ALLOWED_COLUMN_0_DIRECTIVES` (src/asm/line-parser.ts:4) into directive metadata.
- [ ] Consolidate numeric validity (lexer regexes) with `parseNumberValue` (src/asm/expressions.ts:353-364), removing the dead `includes('e')` path; share `.random`/`zilog` string literals as constants.
- [ ] Replace the silent `{tokens: []} as LineNode` fill for exhausted parser output (src/asm/document.ts:45) with an assertion so future desyncs fail loudly.

### Diagnostics decomposition

- [ ] Extract the structural state machine (cpu/relocate/if/macro/zilog, src/asm/diagnostics.ts:229-455) from `collectDiagnostics` into its own module with an explicit state object; keep the existing tests as the regression net.
- [ ] Derive directive arity sets from metadata DIRECTIVES: noParam/oneParam/stringParam/optStringParam Sets (src/asm/diagnostics.ts:1171-1175) duplicate and drift from metadata.ts:102-183 (`endr` listed but no rept/endr depth counter exists; relocate/else/endif/endm entries are dead); build a directive-spec table and delete the local Sets, adding a REPT depth counter.
- [ ] Extract instruction operand matching (validateInstructionOperands/matchOverload/matchOperand/stripIndirect/extractIndexOffset + REG_8…REG_LEA constants, src/asm/diagnostics.ts:1558-1820) into src/asm/instruction-operands.ts as a pure module.
- [ ] Consolidate the split subpage/select/org/phase/size range checks (inline at src/asm/diagnostics.ts:497-560 vs inside validateGenericDirectiveOperands) into one directive-spec-driven path; unify the `konami_scc`/`konamiscc` mapper constants (:1040 vs :1395) and anchor validateNumericDirectiveOperands arity errors on mnemonicToken (:1093-1097) like every other arity diagnostic.

### LSP handler cleanup

- [ ] Extract a `withPositionalRequest(fn)` helper for the 14 handlers repeating `await getIndexedDocuments(), uri, line, character` (src/server.ts:169-244,266-294,302-324).
- [ ] Deduplicate resolveScope/getGlobalScope/resolveGlobalScope: four identical copies in src/lsp/symbol-navigation.ts:41-49, code-lens.ts:6-14, completion.ts:20-28, rename.ts:13-21; keep one exported from symbol-navigation.ts.
- [ ] Drop the redundant `findDefinition` in document-highlights (src/lsp/document-highlights.ts:18-20): `findReferences(includeDeclaration:true)` already covers it.
- [ ] Move the hardcoded data-directive list in folding-ranges.ts:56 to metadata (it misses dl/dw24/dw32/byte/word present in formatting.ts:11-17).
- [ ] Fix formatting comment-column `originalText.indexOf(';')` false positive when `;` appears in a string earlier on the line (src/lsp/formatting.ts:152-158).
- [ ] Fix hover filename extraction `uri.split('/').pop()` for percent-encoded/Windows paths (src/lsp/hover.ts:93): use fileURLToPath + path.basename.
- [ ] Hoist query normalization and cap the result set in workspace-symbols (src/lsp/workspace-symbols.ts:27-32): normalization is recomputed per symbol and an empty query returns every symbol uncapped.
- [ ] Remove the dead `charOffset < 0` defensive clamp and stale comment (src/lsp/semantic-tokens.ts:126-133), and the no-op completion resolveProvider drift note (src/server.ts:69, keep or drop to match merls deliberately).

### Workspace/CLI/extension hygiene

- [ ] Delete dead workspace exports: the never-matched '.include' entry in includeDirectives (src/asm/workspace.ts:26) and unused `dependencies`/`loadOrder` consumers (:21-22,:78-80) once the include-not-found task lands; skip include resolution for untitled: documents (:137-138) instead of producing garbage cwd-relative paths.
- [ ] Prefer decoded escapes in `readIncludePath` (src/asm/workspace.ts:148-155): use `value` over `rawValue` in eZ80 mode and join multi-token unquoted paths with the original spacing (or diagnose) instead of `join('')`.
- [ ] Fix user-visible metadata text: IFNDEF description is a copy of IFDEF ("is defined" should be "is NOT defined", src/asm/metadata.ts:118).
- [ ] Replace ~20 placeholder bios-variables descriptions ('Description for MCLLEN' etc., src/asm/bios-variables.ts) with documented content.
- [ ] Read editor tab settings from workspace config instead of hardcoding tabSize/indentSize 8 in both vscode/src/editor-options.ts:3-6 and vscode/package.json configurationDefaults; stop force-overriding user settings on every editor switch (vscode/src/extension.ts applyZaetsEditorOptions).
- [ ] Reconcile language/watcher registration: `.asm` is watched (vscode/src/extension.ts:62,69) but never registered as a language, and `.lib`/`.inc` includes are unwatched; register or drop deliberately and update the manifest tests. Remove redundant activationEvents now derived from contributions.

### Test architecture alignment

- [ ] Port ../merls/test/run-tests.ts orchestrator and the missing contract suites (bootstrap, cli-contract, coc-config, server-entrypoint, json-rpc-client) plus a src/index.ts counterpart, or consciously bless bare `node --test` in BOTH repos per the alignment rule; document the decision in AGENTS.md.

## Completed from Previous Audits

All items from the 2026-07-17 and 2026-07-24 audits are complete; see git history for the original checklist. Baseline at this audit: `npm test` green (root + vscode).
