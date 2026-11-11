# Codebase Improvement Plan

## High Priority - Potential Issues

- [x] Add explicit error logging to `catch` blocks resolving file stats in `src/server.ts` to aid debugging
- [x] Centralize and document the `catch` blocks that ignore parse errors during expression evaluation (`src/asm/diagnostics.ts`, `src/asm/document.ts`)

## Medium Priority - Inconsistencies

- [x] Standardize import statement quotes across the project (choose either single `'` or double `"` quotes consistently)
- [x] Add JSDoc comments to public API functions in `src/asm/diagnostics.ts` (e.g., `collectDiagnostics`)
- [x] Add JSDoc comments to public API functions in `src/asm/document.ts` (e.g., `createLineErrorDiagnostic`, `getLineStarts`)
- [x] Add JSDoc comments to public API functions in `src/asm/expressions.ts` (e.g., `evaluate`, `isConstantExpression`)

## Low Priority - Refactoring

- [x] Extract duplicate local label qualification logic out of the main loop in `collectDiagnostics` (`src/asm/diagnostics.ts`)
- [x] Extract the 350+ line `validateGenericDirectiveOperands` function (`src/asm/diagnostics.ts`) into smaller, directive-specific validators
- [x] Break down the 400+ line `collectDiagnostics` function into smaller phases (e.g., local definition collection, state transition, macro processing)
- [x] Refactor deep nesting (4+ levels) in `collectDiagnostics` (`src/asm/diagnostics.ts:253`, `diagnostics.ts:187`)
- [ ] Extract macro transition logic from the 170+ line `advanceStructuralState` function (`src/asm/structural-state.ts`)
- [ ] Extract conditional state logic from `advanceStructuralState` (`src/asm/structural-state.ts`)
- [ ] Simplify region boundary detection logic in `buildFoldingRanges` (`src/lsp/folding-ranges.ts`, currently 110+ lines)
- [ ] Refactor the 90+ line `evaluate` switch statement in `src/asm/expressions.ts` into a cleaner lookup or visitor pattern
- [ ] Simplify `buildSemanticTokens` logic in `src/lsp/semantic-tokens.ts` (currently ~95 lines)
