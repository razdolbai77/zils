import { IndexedWorkspace, pathKey } from "./workspace";
import path from "node:path";
import { Diagnostic, AsmDocument, createLineErrorDiagnostic } from "./document";
import { getInstructionMetadata, getDirectiveMetadata, isRegister, isConditionCode, CpuDialect, CpuTarget, MAX_ADDR_Z80, MAX_ADDR_EZ80, NO_PARAM_DIRECTIVES, ONE_PARAM_DIRECTIVES, STRING_PARAM_DIRECTIVES, OPT_STRING_PARAM_DIRECTIVES, OPT_PARAM_DIRECTIVES } from "./metadata";
import { ExpressionParser, ASTNode, SymbolNode, UnaryOpNode, BinaryOpNode, isConstantExpression, evaluate, tryParseExpression } from "./expressions";
import { Token, TokenType, ParseError } from "./lexer";
import { LineNode } from "./line-parser";
import { getCachedCollector } from "./symbol-cache";
import { createStructuralState, advanceStructuralState, finalizeStructuralState, markOpenMacrosInvalid } from "./structural-state";
import { INDIRECT_CAPABLE_REGISTERS, extractIndexOffset, isIndirectOperand, validateInstructionOperands, ValidationResult } from "./instruction-operands";

function validateConstantExpression(
    tokens: Token[],
    lineIndex: number,
    lineStart: number,
    dialect: CpuDialect,
    validateFn: (val: number) => string | null
): Diagnostic[] {
    const diagnostics: Diagnostic[] = [];
    if (tokens.length === 0) return diagnostics;
    const ast = tryParseExpression(tokens, dialect);
    if (ast && isConstantExpression(ast)) {
        try {
            const val = evaluate(ast, () => undefined, 0);
            const error = validateFn(val);
            if (error) {
                diagnostics.push({
                    line: lineIndex,
                    message: error,
                    startCharacter: tokens[0].start - lineStart,
                    length: tokens[tokens.length - 1].start + tokens[tokens.length - 1].length - tokens[0].start
                });
            }
        } catch {
            // Evaluation failure ignored; non-evaluable expressions cannot be range-validated here.
        }
    }
    return diagnostics;
}


const TEMPORARY_LOCAL_LABELS: Record<string, true> = {
    '@@': true,
    '@b': true,
    '@f': true,
    '@n': true,
    '@p': true
};

function hasMatchingAnonymousLabel(
    document: AsmDocument,
    lineIndex: number,
    target: string,
    macroStartLine?: number
): boolean {
    if (target === '@b' || target === '@p') {
        const limitLine = macroStartLine ?? 0;
        for (let i = lineIndex - 1; i >= limitLine; i--) {
            const l = document.lines[i];
            if (l && l.label === '@@' && !l.isInactive) {
                return true;
            }
        }
        return false;
    }
    if (target === '@f' || target === '@n') {
        const endLimitLine = document.lines.length - 1;
        for (let i = lineIndex + 1; i <= endLimitLine; i++) {
            const l = document.lines[i];
            if (macroStartLine !== undefined && l && l.mnemonic && (l.mnemonic === 'endmacro' || l.mnemonic === 'endm')) {
                break;
            }
            if (l && l.label === '@@' && !l.isInactive) {
                return true;
            }
        }
        return false;
    }
    return true;
}

function usesZ80OnlyRegister(operands: Token[][] | undefined, registers: readonly string[]): boolean {
    if (operands === undefined || registers.length === 0) return false;

    for (const operand of operands) {
        for (const token of operand) {
            if (token.type === TokenType.Identifier && registers.includes(token.value.toLowerCase())) {
                return true;
            }
        }
    }

    return false;
}

function isLocalLabel(name: string): boolean {
    return name.startsWith('@') || name.startsWith('.');
}

function qualifyScopedLabel(name: string, currentGlobalLabel: string): string {
    if (!isLocalLabel(name) || TEMPORARY_LOCAL_LABELS[name] || currentGlobalLabel.length === 0) {
        return name;
    }

    return `${currentGlobalLabel}${name}`;
}

function resolveLabelScope(label: string, currentGlobalLabel: string): { qualifiedName: string; nextGlobalLabel: string } {
    if (isLocalLabel(label)) {
        return {
            qualifiedName: qualifyScopedLabel(label, currentGlobalLabel),
            nextGlobalLabel: currentGlobalLabel
        };
    }
    return {
        qualifiedName: label,
        nextGlobalLabel: label
    };
}

const AGON_LABEL_MAX_LENGTH = 32;

const DATA_WIDTHS: Readonly<Record<string, number>> = {
    db: 255, defb: 255, dw: 65535, defw: 65535,
    dl: MAX_ADDR_EZ80, dw24: MAX_ADDR_EZ80, dw32: 0xffffffff
};
const STRING_DATA_DIRECTIVES = new Set(['db', 'defb', 'byte', 'dt', 'deft', 'ascii', 'asciz']);
const BLOCK_WIDTHS: Readonly<Record<string, number>> = {
    blkb: 255, blkw: 65535, blkp: MAX_ADDR_EZ80, blkl: 0xffffffff
};

function validateAgonLabel(name: string): string | undefined {
    if (name.length > AGON_LABEL_MAX_LENGTH) {
        return `Label '${name}' exceeds the ${AGON_LABEL_MAX_LENGTH}-character limit`;
    }

    if (getInstructionMetadata(name)?.supportedDialects.includes(CpuDialect.EZ80)) {
        return `Label '${name}' conflicts with an eZ80 mnemonic`;
    }

    if (getDirectiveMetadata(name)?.supportedDialects.includes(CpuDialect.EZ80)) {
        return `Label '${name}' conflicts with an eZ80 directive`;
    }

    if (isConditionCode(name)) {
        return `Label '${name}' conflicts with an eZ80 condition code`;
    }
}


/**
 * Collects syntax, semantic, and structural diagnostics for an assembly document
 * within the indexed workspace.
 *
 * @param workspace - The indexed workspace containing all indexed documents and symbols.
 * @param uri - The URI of the document to collect diagnostics for.
 * @returns An array of diagnostics for the specified document.
 */
export function collectDiagnostics(workspace: IndexedWorkspace, uri: string): Diagnostic[] {
    const canonicalPath = workspace.pathIndex.get(pathKey(uri));
    const document = canonicalPath !== undefined ? workspace.documents.get(canonicalPath) : undefined;
    if (!document || canonicalPath === undefined) return [];

    const diagnostics: Diagnostic[] = [];
    const localDefinitions = new Set<string>();

    // Include resolution failures recorded while indexing this document.
    for (const failed of workspace.failedIncludes) {
        if (failed.includerPath !== canonicalPath) continue;
        diagnostics.push({
            line: failed.line,
            message: `Cannot load included file: ${path.basename(failed.resolvedPath)}`,
            startCharacter: failed.startCharacter,
            length: failed.length
        });
    }

    // SymbolCollector records equ-evaluation failures, unscoped local
    // labels, and BIOS-name collisions that no other pass reports.
    for (const error of getCachedCollector(document).getErrors()) {
        diagnostics.push({ line: error.line, message: error.message });
    }

    
    // First pass: collect local definitions and detect duplicates within file
    let currentGlobalLabel = "";
    for (let i = 0; i < document.lines.length; i++) {
        const line = document.lines[i];
        if (line.isInactive) continue;
        if (line.label) {
            let name = line.label;
            if (document.dialect === CpuDialect.EZ80 && !document.isAsmsx) {
                const validationError = validateAgonLabel(name);
                if (validationError) {
                    diagnostics.push({ line: i, message: validationError, startCharacter: line.tokens[0] ? (line.tokens[0].start - line.start!) : undefined, length: line.labelToken ? (line.labelToken.start + line.labelToken.length - line.tokens[0].start) : undefined });
                }
            }
            if (name.startsWith('@') && !name.startsWith('@@') && document.dialect === CpuDialect.Z80) {
                diagnostics.push({ line: i, message: `Local label starting with a single '@' is an ez80asm feature, but file is asMSX (.z80)`, startCharacter: line.tokens[0] ? (line.tokens[0].start - line.start!) : undefined, length: line.labelToken ? (line.labelToken.start + line.labelToken.length - line.tokens[0].start) : undefined });
            } else if (name.startsWith('.') && document.dialect === CpuDialect.EZ80 && !document.isAsmsx) {
                diagnostics.push({ line: i, message: `Local label starting with '.' is an asMSX feature, but file is ez80asm (.ez80)`, startCharacter: line.tokens[0] ? (line.tokens[0].start - line.start!) : undefined, length: line.labelToken ? (line.labelToken.start + line.labelToken.length - line.tokens[0].start) : undefined });
            }

            const resolved = resolveLabelScope(name, currentGlobalLabel);
            name = resolved.qualifiedName;
            currentGlobalLabel = resolved.nextGlobalLabel;

            if (line.label !== '@@') {
                if (localDefinitions.has(name)) {
                    diagnostics.push({ line: i, message: `Duplicate symbol definition: ${line.label}`, startCharacter: line.tokens[0] ? (line.tokens[0].start - line.start!) : undefined, length: line.labelToken ? (line.labelToken.start + line.labelToken.length - line.tokens[0].start) : undefined });
                } else {
                    localDefinitions.add(name);
                }
            }
        }
    }

    const state = createStructuralState(document);
    const emit = (diag: Diagnostic) => {
        diagnostics.push(diag);
    };
    const addDiagnostic = (diag: Diagnostic) => {
        diagnostics.push(diag);
        markOpenMacrosInvalid(state);
    };

    for (let i = 0; i < document.lines.length; i++) {
        let hasBlockingOperandDiagnostic = false;
        const line = document.lines[i];

        if (line.error) {
            diagnostics.push(createLineErrorDiagnostic(line, i));
            continue;
        }
        const unterminatedCommentToken = line.tokens.find(
            (token) => token.type === TokenType.Comment && token.unterminated
        );
        if (unterminatedCommentToken) {
            diagnostics.push({
                line: i,
                message: "Unterminated block comment",
                startCharacter: unterminatedCommentToken.start - line.start!,
                length: unterminatedCommentToken.length
            });
            continue;
        }
        const invalidEscapeToken = line.mnemonic !== 'include'
            ? line.tokens.find((token) => token.type === TokenType.String
                && token.invalidEscape
                && (token.quote === "'" || !state.isAsmsxSyntax && token.quote === '"'))
            : undefined;
        if (invalidEscapeToken) {
            diagnostics.push({
                line: i,
                message: "Invalid escape sequence in string literal",
                startCharacter: invalidEscapeToken.start - line.start!,
                length: invalidEscapeToken.length
            });
            continue;
        }
        // Inactive conditional blocks are not assembled. Control-flow lines
        // (if/else/endif) are never marked inactive, so their nesting balance
        // still tracks while inactive content cannot flip cpu/zilog/macro
        // state or capture label scope. Syntax errors above are still
        // surfaced from inactive lines.
        if (line.isInactive) {
            continue;
        }
        if (advanceStructuralState(state, document, { line, lineIndex: i, emit, emitMarking: addDiagnostic }) === 'continue') {
            continue;
        }
        const macroParameters = state.macroStack.at(-1)?.parameters;
        if (macroParameters !== undefined) {
            for (const token of line.tokens) {
                if (token.type === TokenType.Identifier && token.value.startsWith('#') && !macroParameters.has(token.value)) {
                    diagnostics.push({
                        line: i,
                        message: `Unknown macro parameter: ${token.value}`,
                        startCharacter: token.start - line.start!,
                        length: token.length
                    });
                }
            }
        }
        if (line.mnemonic && !line.isDirective) {
            const mnemonicToken = line.mnemonicToken;
            const hasDirectiveDot = mnemonicToken !== undefined && line.tokens.some((token) =>
                token.type === TokenType.Dot &&
                token.start + token.length === mnemonicToken.start
            );
            const dirMeta = getDirectiveMetadata(line.mnemonic);
            if (hasDirectiveDot && mnemonicToken !== undefined && (!dirMeta || !dirMeta.supportedDialects.includes(document.dialect))) {
                diagnostics.push({
                    line: i,
                    message: `Unknown directive: .${line.mnemonic}`,
                    startCharacter: mnemonicToken.start - line.start! - 1,
                    length: mnemonicToken.length + 1
                });
            } else {
                const meta = getInstructionMetadata(line.mnemonic);
                if (!meta) {
                    const macro = line.mnemonicToken === undefined
                        ? undefined
                        : workspace.symbols.get(line.mnemonicToken.value)?.find((symbol) => symbol.kind === 'macro');
                    if (macro === undefined) {
                        addDiagnostic({ line: i, message: `Unknown instruction: ${line.mnemonicToken?.value ?? line.mnemonic}`, startCharacter: line.mnemonicToken ? (line.mnemonicToken.start - line.start!) : undefined, length: line.mnemonicToken?.length });
                    } else {
                        const macroName = line.mnemonicToken?.value ?? line.mnemonic;
                        if (state.invalidMacros.has(macroName)) {
                            addDiagnostic({
                                line: i,
                                message: `Cannot invoke macro '${macroName}' because its definition contains errors`,
                                startCharacter: line.mnemonicToken ? (line.mnemonicToken.start - line.start!) : undefined,
                                length: line.mnemonicToken?.length
                            });
                        } else if (state.macroDepth > 0) {
                            addDiagnostic({
                                line: i,
                                message: `Macro invocation '${macroName}' is not allowed inside a macro body`,
                                startCharacter: line.mnemonicToken ? (line.mnemonicToken.start - line.start!) : undefined,
                                length: line.mnemonicToken?.length
                            });
                        } else {
                            state.deferredMacroInvocations.push({ line: i, token: line.mnemonicToken, name: macroName });
                        }
                        hasBlockingOperandDiagnostic = true;
                    }
                } else {
                    if (!meta.supportedDialects.includes(document.dialect)) {
                        diagnostics.push({ line: i, message: `Instruction '${line.mnemonic}' is not supported in dialect ${document.dialect}`, startCharacter: line.mnemonicToken ? (line.mnemonicToken.start - line.start!) : undefined, length: line.mnemonicToken?.length });
                    } else if (!meta.supportedCpus.includes(state.cpu) || (state.cpu !== CpuTarget.Z80 && usesZ80OnlyRegister(line.operands, meta.z80OnlyRegisters))) {
                        diagnostics.push({ line: i, message: `Instruction '${line.mnemonic}' is not supported by CPU ${state.cpu.toUpperCase()}`, startCharacter: line.mnemonicToken ? (line.mnemonicToken.start - line.start!) : undefined, length: line.mnemonicToken?.length });
                    }
                }
            }
        }

        if (line.mnemonic === 'assume') {
            for (const diag of validateAssumeOperands(line.operands || [], i, line.start!)) {
                diagnostics.push(diag);
            }
            continue;
        }

        if (line.mnemonic === 'megas') {
            for (const diag of validateMegasOperands(line.operands || [], i, line.start!, line.mnemonicToken)) {
                diagnostics.push(diag);
            }
            continue;
        }

        if (line.isDirective && line.mnemonic) {
            const result = validateGenericDirectiveOperands(line, i, document.dialect);
            if (result.handled) {
                for (const diag of result.diagnostics) {
                    diagnostics.push(diag);
                }
                

                if (!result.expectsExpression || result.diagnostics.length > 0) {
                    continue;
                }
                
            }
        }


        if (line.operands) {

            // In eZ80: [reg] is wrong (indirect needs parens); expression grouping [expr] is fine.
            // In asMSX: (reg) is wrong (indirect needs brackets); expression grouping (expr) is fine.
            const wrongOpen   = state.isAsmsxSyntax ? TokenType.LParen   : TokenType.LBracket;
            const wrongClose  = state.isAsmsxSyntax ? TokenType.RParen   : TokenType.RBracket;
            const correct     = state.isAsmsxSyntax ? 'square brackets' : 'parentheses';
            const wrong       = state.isAsmsxSyntax ? 'parentheses'     : 'square brackets';

            for (const operand of line.operands) {
                // If the operand is purely a string, don't parse it as an expression
                if (operand.length === 1 && operand[0].type === TokenType.String) continue;

                if (isWrongIndirectSyntax(operand, wrongOpen, wrongClose, document.dialect)) {
                    hasBlockingOperandDiagnostic = true;
                    diagnostics.push({
                        line: i,
                        message: `${wrong[0].toUpperCase() + wrong.slice(1)} around a register indicate indirect addressing; use ${correct} instead`,
                        startCharacter: operand[0] ? (operand[0].start - line.start!) : undefined,
                        length: operand.length > 0 ? (operand[operand.length - 1].start + operand[operand.length - 1].length - operand[0].start) : undefined
                    });
                    continue;
                }

                const badReg = invalidIndirectRegister(operand, document.dialect);
                if (badReg !== null) {
                    hasBlockingOperandDiagnostic = true;
                    diagnostics.push({
                        line: i,
                        message: `Register '${badReg}' cannot be used for indirect addressing; expected a register pair such as HL, BC, DE, SP, IX, or IY`,
                        startCharacter: operand[0] ? (operand[0].start - line.start!) : undefined,
                        length: operand.length > 0 ? (operand[operand.length - 1].start + operand[operand.length - 1].length - operand[0].start) : undefined
                    });
                    continue;
                }

                const badOffsetReg = invalidIndirectOffset(operand);
                if (badOffsetReg !== null) {
                    hasBlockingOperandDiagnostic = true;
                    diagnostics.push({
                        line: i,
                        message: `Register '${badOffsetReg}' cannot be used with an offset in indirect addressing; only IX and IY support offsets`,
                        startCharacter: line.mnemonicToken ? (line.mnemonicToken.start - line.start!) : undefined,
                        length: line.mnemonicToken?.length
                    });
                    continue;
                }

                try {
                    const parser = new ExpressionParser(operand, document.dialect);
                    const ast = parser.parse();
                    
                    const unresolved = findUnresolvedSymbols(ast, document, workspace, localDefinitions, state.scopeLabel, state.macroDepth > 0);
                    for (const sym of unresolved) {
                        if (macroParameters?.has(sym)) {
                            continue;
                        }
                        if (sym === '@b' || sym === '@f' || sym === '@n' || sym === '@p') {
                            const macroStartLine = state.macroStack.at(-1)?.line;
                            if (hasMatchingAnonymousLabel(document, i, sym, state.macroDepth > 0 ? macroStartLine : undefined)) {
                                continue;
                            }
                            addDiagnostic({
                                line: i,
                                message: state.macroDepth > 0
                                    ? `Anonymous label target '${sym}' referenced in macro is not defined within the macro`
                                    : `Unresolved symbol: ${sym}`,
                                startCharacter: operand[0] ? (operand[0].start - line.start!) : undefined,
                                length: operand.length > 0 ? (operand[operand.length - 1].start + operand[operand.length - 1].length - operand[0].start) : undefined
                            });
                            continue;
                        }

                        if (state.macroDepth > 0) {
                            const unstripped = sym.includes('@') ? sym.substring(sym.indexOf('@')) : sym;
                            if (state.macroStack.at(-1)?.localDefs.has(sym) || state.macroStack.at(-1)?.localDefs.has(unstripped)) {
                                continue;
                            }

                            if (document.dialect === CpuDialect.EZ80) {
                                const isAtLocal = sym.startsWith('@') || sym.includes('@');
                                if (isAtLocal) {
                                    if (sym === '@@') {
                                        continue;
                                    }
                                    addDiagnostic({
                                        line: i,
                                        message: `Local label '${sym}' referenced in macro is not defined within the macro`,
                                        startCharacter: operand[0] ? (operand[0].start - line.start!) : undefined,
                                        length: operand.length > 0 ? (operand[operand.length - 1].start + operand[operand.length - 1].length - operand[0].start) : undefined
                                    });
                                    continue;
                                }
                            } else {
                                if (sym.startsWith('#')) {
                                    continue;
                                }
                            }
                        }
                        addDiagnostic({ 
                            line: i, 
                            message: `Unresolved symbol: ${sym}`,
                            startCharacter: operand[0] ? (operand[0].start - line.start!) : undefined,
                            length: operand.length > 0 ? (operand[operand.length - 1].start + operand[operand.length - 1].length - operand[0].start) : undefined
                        });
                    }
                } catch (e: unknown) {
                    // The try block only throws from ExpressionParser.parse().
                    // Multi-dot local-label references (jr ..local_label) are
                    // legal macro labels the expression grammar cannot parse,
                    // so tolerate exactly that shape; every other failure is a
                    // genuine syntax error and surfaces even inside macros
                    // (addDiagnostic marks enclosing macros invalid).
                    if (state.macroDepth > 0 && isDottedLabelReference(operand)) {
                        hasBlockingOperandDiagnostic = true;
                        continue;
                    }
                    hasBlockingOperandDiagnostic = true;
                    const diag: Diagnostic = { line: i, message: `Wrong operand form: ${e instanceof Error ? e.message : String(e)}` };
                    if (e instanceof ParseError && e.token) {
                        diag.startCharacter = e.token.start - line.start!;
                        diag.length = e.token.length;
                    } else if (operand.length > 0) {
                        diag.startCharacter = operand[0].start - line.start!;
                        diag.length = operand[operand.length - 1].start + operand[operand.length - 1].length - operand[0].start;
                    }
                    addDiagnostic(diag);
                }
            }
        }

        if (!hasBlockingOperandDiagnostic && line.mnemonic && !line.isDirective) {
            const meta = getInstructionMetadata(line.mnemonic);
            if (meta && meta.supportedDialects.includes(document.dialect)) {
                let result: ValidationResult = { error: null, sigOps: null };
                if (line.operands && line.mnemonicToken) {
                    result = validateInstructionOperands(line.operands, line.mnemonic, meta, document.dialect, state.isAsmsxSyntax);
                } else if (!line.operands && meta.signature.includes(' ') && line.mnemonicToken) {
                    result = validateInstructionOperands([], line.mnemonic, meta, document.dialect, state.isAsmsxSyntax);
                }

                if (result.error && line.mnemonicToken) {
                    let startChar = line.mnemonicToken.start - line.start!;
                    let len = line.mnemonicToken.length;
                    
                    if (result.errorIndex !== undefined && line.operands && line.operands[result.errorIndex] && line.operands[result.errorIndex].length > 0) {
                        const operandTokens = line.operands[result.errorIndex];
                        startChar = operandTokens[0].start - line.start!;
                        len = operandTokens[operandTokens.length - 1].start + operandTokens[operandTokens.length - 1].length - operandTokens[0].start;
                    }

                    diagnostics.push({
                        line: i,
                        message: result.error,
                        startCharacter: startChar,
                        length: len
                    });
                } else if (!result.error && result.sigOps && line.operands) {
                    // Valid syntax, now check for range errors if they are constant expressions
                    for (let j = 0; j < line.operands.length; j++) {
                        const operand = line.operands[j];
                        const sigPart = result.sigOps[j].toLowerCase();
                        
                        // Safe expression parse; syntax errors are diagnosed separately by the operand loop.
                        const ast = tryParseExpression(operand, document.dialect);
                        if (!ast) {
                            continue;
                        }
                        try {
                            if (isConstantExpression(ast)) {
                                const val = evaluate(ast, () => undefined, 0);
                                let rangeError: string | null = null;
                                
                                // Strip indirect for range checks
                                const isIndirect = isIndirectOperand(operand, state.isAsmsxSyntax);
                                const actualSigPart = isIndirect && sigPart.startsWith('(') && sigPart.endsWith(')') ? sigPart.slice(1, -1) : sigPart;
                                
                                if (actualSigPart === 'b') {
                                    if (val < 0 || val > 7) rangeError = `Bit index must be between 0 and 7, but was ${val}`;
                                } else if (actualSigPart === 'n' || actualSigPart === 's' || actualSigPart === 'r/n') {
                                    if (val < 0 || val > 255) rangeError = `8-bit unsigned literal must be between 0 and 255, but was ${val}`;
                                } else if (actualSigPart === 'p') {
                                    if (val < 0 || val > 56 || val % 8 !== 0) rangeError = `Restart vector literal must be one of 0, 8, 16, 24, 32, 40, 48, 56, but was ${val}`;
                                } else if (actualSigPart === 'm' || actualSigPart === 'r') {
                                    rangeError = `Operand must be a register or memory reference, not a literal`;
                                } else if (actualSigPart === 'd') {
                                    if (val < -128 || val > 127) rangeError = `8-bit signed literal must be between -128 and 127, but was ${val}`;
                                } else if (actualSigPart === 'nn') {
                                    const maxVal = document.dialect === CpuDialect.EZ80 ? MAX_ADDR_EZ80 : MAX_ADDR_Z80;
                                    const bitsStr = document.dialect === CpuDialect.EZ80 ? '24-bit' : '16-bit';
                                    if (val < 0 || val > maxVal) rangeError = `${bitsStr} unsigned literal must be between 0 and ${maxVal}, but was ${val}`;
                                }
                                
                                if (rangeError) {
                                    diagnostics.push({
                                        line: i,
                                        message: rangeError,
                                        startCharacter: operand[0] ? (operand[0].start - line.start!) : undefined,
                                        length: operand.length > 0 ? (operand[operand.length - 1].start + operand[operand.length - 1].length - operand[0].start) : undefined
                                    });
                                }
                            } else {
                                const isIndirect = isIndirectOperand(operand, state.isAsmsxSyntax);
                                const actualSigPart = isIndirect && sigPart.startsWith('(') && sigPart.endsWith(')') ? sigPart.slice(1, -1) : sigPart;
                                if (actualSigPart.endsWith('+d') || actualSigPart.endsWith('-d')) {
                                    const offsetVal = extractIndexOffset(ast);
                                    if (offsetVal !== null && (offsetVal < -128 || offsetVal > 127)) {
                                        diagnostics.push({
                                            line: i,
                                            message: `Index offset must be between -128 and 127, but was ${offsetVal}`,
                                            startCharacter: operand[0] ? (operand[0].start - line.start!) : undefined,
                                            length: operand.length > 0 ? (operand[operand.length - 1].start + operand[operand.length - 1].length - operand[0].start) : undefined
                                        });
                                    }
                                }
                            }
                        } catch (e: unknown) {
                            // Evaluation failures (division by zero, bad shift)
                            // carry the offending operator token; anchor the
                            // diagnostic on it.
                            const anchor = e instanceof ParseError ? e.token : null;
                            diagnostics.push({
                                line: i,
                                message: e instanceof Error ? e.message : String(e),
                                startCharacter: anchor ? anchor.start - line.start! : (operand[0] ? operand[0].start - line.start! : undefined),
                                length: anchor ? anchor.length : (operand.length > 0 ? operand[operand.length - 1].start + operand[operand.length - 1].length - operand[0].start : undefined)
                            });
                        }
                    }
                }
            }
        }
    }

    finalizeStructuralState(state, document, emit, addDiagnostic);
    return diagnostics;
}


function isWrongIndirectSyntax(
    operand: Token[],
    openType: TokenType,
    closeType: TokenType,
    dialect: CpuDialect
): boolean {
    // Must be fully wrapped: first token is the wrong open, last is the wrong close.
    if (operand.length < 3) return false;
    if (operand[0].type !== openType) return false;
    if (operand[operand.length - 1].type !== closeType) return false;
    // Only flag when the inner content contains an indirect-capable register.
    // 8-bit registers are handled separately by invalidIndirectRegister so
    // that we never suggest "use parentheses" for something like [h] where
    // even the correct bracket form (h) would still be wrong.
    const inner = operand.slice(1, -1);
    return inner.some(t =>
        t.type === TokenType.Identifier &&
        isRegister(t.value, dialect) &&
        INDIRECT_CAPABLE_REGISTERS[t.value.toLowerCase()] === true
    );
}

/**
 * Returns the register name if the operand is `<open> <non-indirect-reg> <close>` with
 * either bracket pair — i.e. the register cannot be dereferenced regardless of bracket style.
 * Returns null otherwise.
 */
function invalidIndirectRegister(
    operand: Token[],
    dialect: CpuDialect
): string | null {
    if (operand.length !== 3) return null;
    const first = operand[0].type;
    const last  = operand[2].type;
    const isParen   = first === TokenType.LParen   && last === TokenType.RParen;
    const isBracket = first === TokenType.LBracket && last === TokenType.RBracket;
    if (!isParen && !isBracket) return null;
    if (operand[1].type !== TokenType.Identifier) return null;
    const name = operand[1].value.toLowerCase();
    if (!isRegister(name, dialect)) return null;
    if (INDIRECT_CAPABLE_REGISTERS[name] === true) return null;
    return operand[1].value; // return original casing for the message
}

/**
 * Returns the register name if the operand is `<open> <reg> <+ or -> ... <close>`
 * where <reg> is NOT ix or iy. Only ix and iy support offset addressing.
 */
function invalidIndirectOffset(
    operand: Token[]
): string | null {
    if (operand.length < 4) return null;
    
    const first = operand[0].type;
    const last = operand[operand.length - 1].type;
    const isParen   = first === TokenType.LParen   && last === TokenType.RParen;
    const isBracket = first === TokenType.LBracket && last === TokenType.RBracket;
    if (!isParen && !isBracket) return null;
    
    // Check if the second token is a register
    if (operand[1].type !== TokenType.Identifier) return null;
    
    // Check if the third token is a plus or minus sign
    if (operand[2].type !== TokenType.Plus && operand[2].type !== TokenType.Minus) return null;
    
    const name = operand[1].value.toLowerCase();
    // In Z80/eZ80, only ix and iy can have an offset.
    if (name === 'ix' || name === 'iy') return null;
    
    // Check if it's a register pair that is invalid with offsets
    if (INDIRECT_CAPABLE_REGISTERS[name] === true || name === 'hl' || name === 'de' || name === 'bc' || name === 'sp') {
        return operand[1].value;
    }
    
    return null;
}


function findUnresolvedSymbols(
    node: ASTNode,
    document: AsmDocument,
    workspace: IndexedWorkspace,
    localDefs: Set<string>,
    currentGlobalLabel: string,
    inMacro: boolean = false
): string[] {
    const unresolved: string[] = [];

    function traverse(n: ASTNode) {
        if (n.type === 'Symbol') {
            const name = (n as SymbolNode).name;
            const qualifiedName = qualifyScopedLabel(name, currentGlobalLabel);
            const isLocalInMacro = document.dialect === CpuDialect.EZ80 && inMacro && name.startsWith('@') && !TEMPORARY_LOCAL_LABELS[name];
            if (!isRegister(name, document.dialect) &&
                !isConditionCode(name) &&
                name !== '@@' &&
                (!workspace.symbols.has(qualifiedName) || isLocalInMacro) &&
                (!localDefs.has(qualifiedName) || isLocalInMacro)) {
                unresolved.push(name);
            }
        } else if (n.type === 'UnaryOp') {
            traverse((n as UnaryOpNode).expr);
        } else if (n.type === 'BinaryOp') {
            traverse((n as BinaryOpNode).left);
            traverse((n as BinaryOpNode).right);
        }
    }

    traverse(node);
    return unresolved;
}

// Known assume keys and their valid values for ez80asm
const ASSUME_KEYS: ReadonlyMap<string, readonly number[]> = new Map([
    ['adl', [0, 1]],
]);

function validateAssumeOperands(operands: Token[][], line: number, lineStart: number): Diagnostic[] {
    const diagnostics: Diagnostic[] = [];

    for (const operand of operands) {
        // Expect: Identifier(key) Equals Number(value)
        const keyToken = operand[0];
        const equalsToken = operand[1];
        const valueToken = operand[2];

        if (
            !keyToken || keyToken.type !== TokenType.Identifier ||
            !equalsToken || equalsToken.type !== TokenType.Equals ||
            !valueToken || valueToken.type !== TokenType.Number ||
            operand.length !== 3
        ) {
            diagnostics.push({ 
                line, 
                message: `Malformed assume operand: expected 'key=value'`,
                startCharacter: operand[0] ? (operand[0].start - lineStart) : undefined,
                length: operand.length > 0 ? (operand[operand.length - 1].start + operand[operand.length - 1].length - operand[0].start) : undefined
            });
            continue;
        }

        const key = keyToken.value.toLowerCase();
        const validValues = ASSUME_KEYS.get(key);
        if (validValues === undefined) {
            diagnostics.push({ 
                line, 
                message: `Unknown assume key: '${keyToken.value}'`,
                startCharacter: keyToken.start - lineStart,
                length: keyToken.length
            });
            continue;
        }

        const value = parseInt(valueToken.value, 10);
        if (!validValues.includes(value)) {
            diagnostics.push({ 
                line, 
                message: `Invalid value for assume '${key}': must be ${validValues.join(' or ')}`,
                startCharacter: valueToken.start - lineStart,
                length: valueToken.length
            });
        }
    }

    return diagnostics;
}

const MAPPER_TYPES: Readonly<Record<string, true>> = {
    konami: true,
    konami_scc: true,
    ascii8: true,
    ascii16: true
};

type DirectiveRangeSpec =
    | { shape: 'single', range: (value: number, dialect: CpuDialect) => string | null }
    | {
        shape: 'at',
        firstRange: (value: number, dialect: CpuDialect) => string | null,
        secondRange: (value: number, dialect: CpuDialect) => string | null
    };
const addressRange: Extract<DirectiveRangeSpec, { shape: 'single' }>['range'] = (value, dialect) => {
    const maximumValue = dialect === CpuDialect.EZ80 ? MAX_ADDR_EZ80 : MAX_ADDR_Z80;
    const bits = dialect === CpuDialect.EZ80 ? '24-bit' : '16-bit';
    return value < 0 || value > maximumValue
        ? `Address must be a ${bits} unsigned integer (0-${maximumValue}), but was ${value}`
        : null;
};

const subpageRangeSpec: Extract<DirectiveRangeSpec, { shape: 'at' }> = {
    shape: 'at',
    firstRange: (value) => value < 0 || value > 255
        ? `Subpage number must be an 8-bit unsigned integer (0-255), but was ${value}`
        : null,
    secondRange: (value) => value < 0 || value > MAX_ADDR_Z80
        ? `Execution entry point must be a 16-bit unsigned address (0-${MAX_ADDR_Z80}), but was ${value}`
        : null
};

const DIRECTIVE_RANGE_SPECS: Readonly<Record<string, DirectiveRangeSpec>> = {
    page: {
        shape: 'single',
        range: (value) => value < 0 || value > 3 ? `Page number must be between 0 and 3, but was ${value}` : null
    },
    org: { shape: 'single', range: addressRange },
    phase: { shape: 'single', range: addressRange },
    start: { shape: 'single', range: addressRange },
    callbios: {
        shape: 'single',
        range: (value) => value < 0 || value > MAX_ADDR_Z80
            ? `Address must be an 16-bit unsigned integer (0-${MAX_ADDR_Z80}), but was ${value}`
            : null
    },
    calldos: {
        shape: 'single',
        range: (value) => value < 0 || value > 255
            ? `Function number must be an 8-bit unsigned integer (0-255), but was ${value}`
            : null
    },
    size: {
        shape: 'single',
        range: (value) => value <= 0 || value > 8192
            ? `Size in kilobytes must be between 1 and 8192 (8MB), but was ${value}`
            : null
    },
    subpage: subpageRangeSpec,
    select: subpageRangeSpec
};
function validateDirectiveRangeOperands(line: LineNode, lineIndex: number, dialect: CpuDialect): Diagnostic[] {
    const mnemonic = line.mnemonic!.toLowerCase().replace('.', '');
    const spec = DIRECTIVE_RANGE_SPECS[mnemonic];
    if (spec === undefined) return [];

    const operands = line.operands || [];
    const lineStart = line.start!;
    if (spec.shape === 'single') {
        if (operands.length !== 1) return [];
        const range = spec.range;
        return validateConstantExpression(operands[0], lineIndex, lineStart, dialect, (value) => range(value, dialect));
    }

    const formatDiagnostic = () => ({
        line: lineIndex,
        message: `Directive '${mnemonic}' requires format: <n> at <address>`,
        startCharacter: line.mnemonicToken ? line.mnemonicToken.start - lineStart : undefined,
        length: line.mnemonicToken?.length
    });
    if (operands.length !== 1 || operands[0].length < 3) return [formatDiagnostic()];

    const tokens = operands[0];
    let atIndex = -1;
    for (let index = 0; index < tokens.length; index++) {
        if (tokens[index].type === TokenType.Identifier && tokens[index].value.toLowerCase() === 'at') {
            if (atIndex !== -1) return [formatDiagnostic()];
            atIndex = index;
        }
    }
    if (atIndex === 0 || atIndex === tokens.length - 1 || atIndex === -1) return [formatDiagnostic()];

    const expressionParts = [tokens.slice(0, atIndex), tokens.slice(atIndex + 1)];
    for (const expressionTokens of expressionParts) {
        if (!tryParseExpression(expressionTokens, dialect)) {
            return [formatDiagnostic()];
        }
    }
    const diagnostics: Diagnostic[] = [];
    for (const token of tokens) {
        if (token.type === TokenType.String) {
            diagnostics.push({
                line: lineIndex,
                message: `Directive '${mnemonic}' expects numeric expressions, not strings`,
                startCharacter: token.start - lineStart,
                length: token.length
            });
        }
    }
    if (diagnostics.length > 0) return diagnostics;

    const firstRange = spec.firstRange;
    const secondRange = spec.secondRange;
    diagnostics.push(...validateConstantExpression(expressionParts[0], lineIndex, lineStart, dialect, (value) => firstRange(value, dialect)));
    diagnostics.push(...validateConstantExpression(expressionParts[1], lineIndex, lineStart, dialect, (value) => secondRange(value, dialect)));
    return diagnostics;
}


function validateMegasOperands(operands: Token[][], line: number, lineStart: number, directiveToken?: Token): Diagnostic[] {
    const diagnostics: Diagnostic[] = [];
    if (operands.length !== 1) {
        diagnostics.push({ 
            line, 
            message: `Directive 'megas' requires exactly one operand`,
            startCharacter: directiveToken ? (directiveToken.start - lineStart) : undefined,
            length: directiveToken?.length
        });
        return diagnostics;
    }
    const operand = operands[0];
    if (operand.length !== 1 || operand[0].type !== TokenType.Identifier) {
        diagnostics.push({
            line,
            message: `Invalid operand for 'megas'. Expected a MegaROM type identifier.`,
            startCharacter: operand[0] ? (operand[0].start - lineStart) : undefined,
            length: operand.length > 0 ? (operand[operand.length - 1].start + operand[operand.length - 1].length - operand[0].start) : undefined
        });
        return diagnostics;
    }
    const typeValue = operand[0].value.toLowerCase();
    if (MAPPER_TYPES[typeValue] !== true) {
        diagnostics.push({
            line,
            message: `Unknown MegaROM type: '${operand[0].value}'. Valid types are usually KONAMI, KONAMI_SCC, ASCII8, ASCII16.`,
            startCharacter: operand[0].start - lineStart,
            length: operand[0].length
        });
    }
    return diagnostics;
}



function validateNumericDirectiveOperands(
    operands: Token[][],
    minimumOperands: number,
    maximumOperands: number,
    line: number,
    lineStart: number,
    mnemonic: string,
    minimumValue: number,
    maximumValue: number,
    valueName: string,
    allowStrings: boolean = false,
    dialect: CpuDialect = CpuDialect.EZ80,
    directiveToken?: Token
): Diagnostic[] {
    const diagnostics: Diagnostic[] = [];
    if (operands.length < minimumOperands || operands.length > maximumOperands) {
        const countText = minimumOperands === maximumOperands
            ? `exactly ${minimumOperands}`
            : maximumOperands >= Number.MAX_SAFE_INTEGER
                ? `at least ${minimumOperands}`
                : `between ${minimumOperands} and ${maximumOperands}`;
        const plural = (minimumOperands === 1 && (maximumOperands === 1 || maximumOperands >= Number.MAX_SAFE_INTEGER)) ? '' : 's';

        diagnostics.push({
            line,
            message: `Directive '${mnemonic}' requires ${countText} operand${plural}`,
            startCharacter: directiveToken ? directiveToken.start - lineStart : undefined,
            length: directiveToken?.length
        });
        return diagnostics;
    }

    for (const operand of operands) {
        if (operand.length === 1 && operand[0].type === TokenType.String) {
            if (allowStrings) continue;
            diagnostics.push({
                line,
                message: `Directive '${mnemonic}' expects a numeric ${valueName}, not a string`,
                startCharacter: operand[0].start - lineStart,
                length: operand[0].length
            });
            continue;
        }
        diagnostics.push(...validateConstantExpression(operand, line, lineStart, dialect, value => {
            return value < minimumValue || value > maximumValue
                ? `${valueName} must be between ${minimumValue} and ${maximumValue}, but was ${value}`
                : null;
        }));
    }
    return diagnostics;
}

function hasMacroName(line: LineNode): boolean {
    return line.label !== undefined || (line.operands?.length ?? 0) > 0;
}

// A pure dotted local-label reference (`..name`, `.name`): every token but
// the last is a Dot and the last is an Identifier. The expression grammar
// cannot parse multi-dot refs, but they are legal macro-local label
// references, so operand-syntax failures on exactly this shape are
// tolerated while any other malformed operand is a genuine syntax error.
function isDottedLabelReference(operand: readonly Token[]): boolean {
    if (operand.length === 0) return false;
    const last = operand[operand.length - 1];
    if (last.type !== TokenType.Identifier) return false;
    return operand.slice(0, -1).every((token) => token.type === TokenType.Dot);
}


function validateGenericDirectiveOperands(line: LineNode, lineIndex: number, dialect: CpuDialect): { diagnostics: Diagnostic[], handled: boolean, expectsExpression: boolean } {
    const diagnostics: Diagnostic[] = [];
    const operands = line.operands || [];
    const mnemonic = line.mnemonic!.toLowerCase().replace('.', '');
    const lineStart = line.start!;

    if (operands.some((operand) => operand.length === 0)) {
        diagnostics.push({
            line: lineIndex,
            message: `Directive '${mnemonic}' has an empty operand`,
            startCharacter: line.mnemonicToken ? (line.mnemonicToken.start - lineStart) : line.tokens[0]?.start !== undefined ? line.tokens[0].start - lineStart : undefined,
            length: line.mnemonicToken?.length ?? line.tokens[0]?.length
        });
        return { diagnostics, handled: true, expectsExpression: false };
    }

    if (line.isAsmsx && (mnemonic === 'byte' || mnemonic === 'word')) {
        if (operands.length > 0) {
            diagnostics.push({
                line: lineIndex,
                message: `Directive '${mnemonic}' does not take any operands`,
                startCharacter: line.mnemonicToken ? (line.mnemonicToken.start - lineStart) : undefined,
                length: line.mnemonicToken?.length
            });
        }
        return { diagnostics, handled: true, expectsExpression: false };
    }
    if (NO_PARAM_DIRECTIVES.has(mnemonic)) {
        if (operands.length > 0) {
            diagnostics.push({
                line: lineIndex,
                message: `Directive '${mnemonic}' does not take any operands`,
                startCharacter: line.mnemonicToken ? (line.mnemonicToken.start - lineStart) : undefined,
                length: line.mnemonicToken?.length
            });
        }
        return { diagnostics, handled: true, expectsExpression: false };
    }

    if (mnemonic === 'macro') {
        if (!hasMacroName(line)) {
            diagnostics.push({
                line: lineIndex,
                message: "MACRO requires a macro name",
                startCharacter: line.mnemonicToken ? line.mnemonicToken.start - lineStart : undefined,
                length: line.mnemonicToken?.length
            });
        }
        return { diagnostics, handled: true, expectsExpression: false };
    }

    if (Object.hasOwn(DATA_WIDTHS, mnemonic) || STRING_DATA_DIRECTIVES.has(mnemonic)) {
        const maximumValue = DATA_WIDTHS[mnemonic] ?? 255;
        diagnostics.push(...validateNumericDirectiveOperands(
            operands, 1, Number.MAX_SAFE_INTEGER, lineIndex, lineStart, mnemonic, 0, maximumValue, "data value",
            STRING_DATA_DIRECTIVES.has(mnemonic), dialect, line.mnemonicToken
        ));
        return { diagnostics, handled: true, expectsExpression: true };
    }

    if (mnemonic === 'ds' || mnemonic === 'defs') {
        diagnostics.push(...validateNumericDirectiveOperands(
            operands, 1, 2, lineIndex, lineStart, mnemonic, 0, MAX_ADDR_EZ80, "storage count", false, dialect, line.mnemonicToken
        ));
        if (operands.length === 2) {
            diagnostics.push(...validateNumericDirectiveOperands(
                [operands[1]], 1, 1, lineIndex, lineStart, mnemonic, 0, 255, "fill byte", false, dialect, line.mnemonicToken
            ));
        }
        return { diagnostics, handled: true, expectsExpression: true };
    }

    if (Object.hasOwn(BLOCK_WIDTHS, mnemonic)) {
        diagnostics.push(...validateNumericDirectiveOperands(
            operands, 1, 2, lineIndex, lineStart, mnemonic, 0, MAX_ADDR_EZ80, "storage count", false, dialect, line.mnemonicToken
        ));
        if (operands.length === 2) {
            diagnostics.push(...validateNumericDirectiveOperands(
                [operands[1]], 1, 1, lineIndex, lineStart, mnemonic, 0, BLOCK_WIDTHS[mnemonic], "fill value", false, dialect, line.mnemonicToken
            ));
        }
        return { diagnostics, handled: true, expectsExpression: true };
    }

    if (mnemonic === 'align') {
        diagnostics.push(...validateNumericDirectiveOperands(
            operands, 1, 2, lineIndex, lineStart, mnemonic, 1, MAX_ADDR_EZ80, "alignment boundary", false, dialect, line.mnemonicToken
        ));
        if (operands.length === 2) {
            diagnostics.push(...validateNumericDirectiveOperands(
                [operands[1]], 1, 1, lineIndex, lineStart, mnemonic, 0, 255, "fill byte", false, dialect, line.mnemonicToken
            ));
        }
        return { diagnostics, handled: true, expectsExpression: true };
    }

    if (mnemonic === 'fillbyte') {
        diagnostics.push(...validateNumericDirectiveOperands(
            operands, 1, 1, lineIndex, lineStart, mnemonic, 0, 255, "fill byte", false, dialect, line.mnemonicToken
        ));
        return { diagnostics, handled: true, expectsExpression: true };
    }

    if (mnemonic === 'fpos') {
        diagnostics.push(...validateNumericDirectiveOperands(
            operands, 1, 1, lineIndex, lineStart, mnemonic, 0, MAX_ADDR_Z80, "file offset", false, dialect, line.mnemonicToken
        ));
        return { diagnostics, handled: true, expectsExpression: true };
    }

    if (mnemonic === 'rb' || mnemonic === 'rw' || mnemonic === 'rl' || mnemonic === 'rs') {
        if (!line.label) {
            diagnostics.push({
                line: lineIndex,
                message: `Directive '${mnemonic}' requires a label`,
                startCharacter: line.mnemonicToken ? line.mnemonicToken.start - lineStart : undefined,
                length: line.mnemonicToken?.length
            });
        }
        diagnostics.push(...validateNumericDirectiveOperands(
            operands, 1, 1, lineIndex, lineStart, mnemonic, 0, MAX_ADDR_Z80, "reservation count", false, dialect, line.mnemonicToken
        ));
        return { diagnostics, handled: true, expectsExpression: true };
    }
    
    if (mnemonic === 'printfix') {
        if (operands.length !== 1) {
            diagnostics.push({
                line: lineIndex,
                message: `Directive '${mnemonic}' requires exactly one floating point operand`,
                startCharacter: line.mnemonicToken ? (line.mnemonicToken.start - lineStart) : undefined,
                length: line.mnemonicToken?.length
            });
        } else if (operands[0].length === 1 && operands[0][0].type === TokenType.String) {
            diagnostics.push({
                line: lineIndex,
                message: `Directive '${mnemonic}' expects a floating point value, not a string`,
                startCharacter: operands[0][0].start - lineStart,
                length: operands[0][0].length
            });
        }
        return { diagnostics, handled: true, expectsExpression: false };
    }

    if (ONE_PARAM_DIRECTIVES.has(mnemonic)) {
        if (operands.length !== 1) {
            diagnostics.push({
                line: lineIndex,
                message: `Directive '${mnemonic}' requires exactly one operand`,
                startCharacter: line.mnemonicToken ? (line.mnemonicToken.start - lineStart) : undefined,
                length: line.mnemonicToken?.length
            });
        } else if (operands[0].length === 1 && operands[0][0].type === TokenType.String) {
            diagnostics.push({
                line: lineIndex,
                message: `Directive '${mnemonic}' expects a numeric expression, not a string`,
                startCharacter: operands[0][0].start - lineStart,
                length: operands[0][0].length
            });
        }
        if (diagnostics.length === 0) {
            diagnostics.push(...validateDirectiveRangeOperands(line, lineIndex, dialect));
        }
        return { diagnostics, handled: true, expectsExpression: true };
    }

    if (STRING_PARAM_DIRECTIVES.has(mnemonic)) {
        if (operands.length !== 1) {
            diagnostics.push({
                line: lineIndex,
                message: `Directive '${mnemonic}' requires exactly one string operand`,
                startCharacter: line.mnemonicToken ? (line.mnemonicToken.start - lineStart) : undefined,
                length: line.mnemonicToken?.length
            });
        } else if (operands[0].length !== 1 || operands[0][0].type !== TokenType.String) {
            diagnostics.push({
                line: lineIndex,
                message: `Directive '${mnemonic}' expects a string operand`,
                startCharacter: operands[0][0].start - lineStart,
                length: operands[0][operands[0].length - 1].start + operands[0][operands[0].length - 1].length - operands[0][0].start
            });
        }
        return { diagnostics, handled: true, expectsExpression: false };
    }

    if (OPT_STRING_PARAM_DIRECTIVES.has(mnemonic)) {
        if (operands.length > 1) {
            diagnostics.push({
                line: lineIndex,
                message: `Directive '${mnemonic}' takes at most one string operand`,
                startCharacter: line.mnemonicToken ? (line.mnemonicToken.start - lineStart) : undefined,
                length: line.mnemonicToken?.length
            });
        } else if (operands.length === 1 && (operands[0].length !== 1 || operands[0][0].type !== TokenType.String)) {
            diagnostics.push({
                line: lineIndex,
                message: `Directive '${mnemonic}' expects a string operand if provided`,
                startCharacter: operands[0][0].start - lineStart,
                length: operands[0][operands[0].length - 1].start + operands[0][operands[0].length - 1].length - operands[0][0].start
            });
        }
        return { diagnostics, handled: true, expectsExpression: false };
    }

    if (OPT_PARAM_DIRECTIVES.has(mnemonic)) {
        if (operands.length > 1) {
            diagnostics.push({
                line: lineIndex,
                message: `Directive '${mnemonic}' takes at most one operand`,
                startCharacter: line.mnemonicToken ? (line.mnemonicToken.start - lineStart) : undefined,
                length: line.mnemonicToken?.length
            });
        } else if (operands.length === 1 && operands[0].length === 1 && operands[0][0].type === TokenType.String) {
            diagnostics.push({
                line: lineIndex,
                message: `Directive '${mnemonic}' expects a numeric expression if provided, not a string`,
                startCharacter: operands[0][0].start - lineStart,
                length: operands[0][0].length
            });
        }
        return { diagnostics, handled: true, expectsExpression: true };
    }

    if (mnemonic === 'megarom') {
        if (operands.length === 0) {
            diagnostics.push({
                line: lineIndex,
                message: `Directive 'megarom' requires a mapper type operand`,
                startCharacter: line.mnemonicToken ? (line.mnemonicToken.start - lineStart) : undefined,
                length: line.mnemonicToken?.length
            });
        } else if (operands.length > 1) {
            diagnostics.push({
                line: lineIndex,
                message: `Directive 'megarom' takes exactly one operand`,
                startCharacter: line.mnemonicToken ? (line.mnemonicToken.start - lineStart) : undefined,
                length: line.mnemonicToken?.length
            });
        } else if (operands[0].length !== 1 || operands[0][0].type !== TokenType.Identifier || MAPPER_TYPES[operands[0][0].value.toLowerCase()] !== true) {
            diagnostics.push({
                line: lineIndex,
                message: `Invalid mapper type. Expected KONAMI, KONAMI_SCC, ASCII8, or ASCII16`,
                startCharacter: operands[0][0].start - lineStart,
                length: operands[0][operands[0].length - 1].start + operands[0][operands[0].length - 1].length - operands[0][0].start
            });
        }
        return { diagnostics, handled: true, expectsExpression: false };
    }

    if (DIRECTIVE_RANGE_SPECS[mnemonic]?.shape === 'at') {
        diagnostics.push(...validateDirectiveRangeOperands(line, lineIndex, dialect));
        return { diagnostics, handled: true, expectsExpression: false };
    }

    if (mnemonic === 'incbin' || mnemonic === 'insert') {
        if (operands.length === 0) {
            diagnostics.push({
                line: lineIndex,
                message: `Directive '${mnemonic}' requires a string filename`,
                startCharacter: line.mnemonicToken ? (line.mnemonicToken.start - lineStart) : undefined,
                length: line.mnemonicToken?.length
            });
            return { diagnostics, handled: true, expectsExpression: false };
        }
        if (operands[0][0].type !== TokenType.String) {
             diagnostics.push({
                line: lineIndex,
                message: `Directive '${mnemonic}' expects a string filename as first argument`,
                startCharacter: operands[0][0].start - lineStart,
                length: operands[0][0].length
            });
        }
        let j = 1;
        while (j < operands[0].length) {
            const token = operands[0][j];
            if (token.type === TokenType.String) {
                diagnostics.push({
                    line: lineIndex,
                    message: `Directive '${mnemonic}' optional parameters skip and size must be numeric`,
                    startCharacter: token.start - lineStart,
                    length: token.length
                });
                j++;
            } else if (token.type === TokenType.Identifier) {
                const val = token.value.toLowerCase();
                if (val === 'skip' || val === 'size') {
                    if (j + 1 >= operands[0].length) {
                        diagnostics.push({
                            line: lineIndex,
                            message: `Directive '${mnemonic}' parameter '${val}' expects a numeric value`,
                            startCharacter: token.start - lineStart,
                            length: token.length
                        });
                        break;
                    }
                    
                    j++;
                    const exprTokens: Token[] = [];
                    while (j < operands[0].length && !(operands[0][j].type === TokenType.Identifier && (operands[0][j].value.toLowerCase() === 'skip' || operands[0][j].value.toLowerCase() === 'size'))) {
                        exprTokens.push(operands[0][j]);
                        j++;
                    }
                    
                    if (exprTokens.length > 0) {
                        try {
                            const parser = new ExpressionParser(exprTokens, dialect);
                            const ast = parser.parse();
                            if (isConstantExpression(ast)) {
                                const evalValue = evaluate(ast, () => undefined, 0);
                                if (val === 'skip' && evalValue < 0) {
                                    diagnostics.push({
                                        line: lineIndex,
                                        message: `SKIP parameter cannot be negative`,
                                        startCharacter: exprTokens[0].start - lineStart,
                                        length: exprTokens[exprTokens.length - 1].start + exprTokens[exprTokens.length - 1].length - exprTokens[0].start
                                    });
                                } else if (val === 'size' && evalValue <= 0) {
                                    diagnostics.push({
                                        line: lineIndex,
                                        message: `SIZE parameter must be strictly positive`,
                                        startCharacter: exprTokens[0].start - lineStart,
                                        length: exprTokens[exprTokens.length - 1].start + exprTokens[exprTokens.length - 1].length - exprTokens[0].start
                                    });
                                }
                            }
                        } catch (err: unknown) {
                            const msg = err instanceof Error ? err.message : String(err);
                            diagnostics.push({
                                line: lineIndex,
                                message: `Invalid expression for parameter '${val}': ${msg}`,
                                startCharacter: exprTokens[0].start - lineStart,
                                length: exprTokens[exprTokens.length - 1].start + exprTokens[exprTokens.length - 1].length - exprTokens[0].start
                            });
                        }
                    } else {
                        diagnostics.push({
                            line: lineIndex,
                            message: `Directive '${mnemonic}' parameter '${val}' expects a numeric value`,
                            startCharacter: token.start - lineStart,
                            length: token.length
                        });
                    }
                } else {
                    diagnostics.push({
                        line: lineIndex,
                        message: `Unknown parameter '${val}' for directive '${mnemonic}'. Expected SKIP or SIZE.`,
                        startCharacter: token.start - lineStart,
                        length: token.length
                    });
                    j++;
                }
            } else {
                diagnostics.push({
                    line: lineIndex,
                    message: `Unexpected token in '${mnemonic}' directive`,
                    startCharacter: token.start - lineStart,
                    length: token.length
                });
                j++;
            }
        }
        return { diagnostics, handled: true, expectsExpression: false };
    }
    
    return { diagnostics, handled: false, expectsExpression: false };
}

