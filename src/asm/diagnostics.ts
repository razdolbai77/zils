import { IndexedWorkspace } from "./workspace";
import { Diagnostic, AsmDocument } from "./document";
import { getInstructionMetadata, getDirectiveMetadata, isRegister, isConditionCode, CpuDialect, CpuTarget, MAX_ADDR_Z80, MAX_ADDR_EZ80 } from "./metadata";
import { ExpressionParser, ASTNode, SymbolNode, UnaryOpNode, BinaryOpNode, isConstantExpression, evaluate } from "./expressions";
import { Token, TokenType, ParseError } from "./lexer";
import { LineNode } from "./line-parser";

function validateConstantExpression(
    tokens: Token[],
    lineIndex: number,
    lineStart: number,
    validateFn: (val: number) => string | null
): Diagnostic[] {
    const diagnostics: Diagnostic[] = [];
    if (tokens.length === 0) return diagnostics;
    try {
        const parser = new ExpressionParser(tokens);
        const ast = parser.parse();
        if (isConstantExpression(ast)) {
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
        }
    } catch {
        // ignore parse errors
    }
    return diagnostics;
}

export interface ValidationResult {
    error: string | null;
    errorIndex?: number;
    sigOps: string[] | null;
}

const TEMPORARY_LOCAL_LABELS: Record<string, true> = {
    '@@': true,
    '@b': true,
    '@f': true,
    '@n': true,
    '@p': true
};

const CPU_TARGETS: ReadonlyMap<string, CpuTarget> = new Map([
    ['z80', CpuTarget.Z80],
    ['z180', CpuTarget.Z180],
    ['ez80', CpuTarget.EZ80]
]);

function qualifyScopedLabel(name: string, currentGlobalLabel: string): string {
    if ((!name.startsWith('@') && !name.startsWith('.')) || TEMPORARY_LOCAL_LABELS[name] || currentGlobalLabel.length === 0) {
        return name;
    }

    return `${currentGlobalLabel}${name}`;
}


export function collectDiagnostics(workspace: IndexedWorkspace, uri: string): Diagnostic[] {
    const document = workspace.documents.get(uri);
    if (!document) return [];

    const diagnostics: Diagnostic[] = [];
    const localDefinitions = new Set<string>();
    
    // First pass: collect local definitions and detect duplicates within file
    let currentGlobalLabel = "";
    for (let i = 0; i < document.lines.length; i++) {
        const line = document.lines[i];
        if (line.isInactive) continue;
        if (line.label) {
            let name = line.label;
            if (name.startsWith('@') && !name.startsWith('@@') && document.dialect === CpuDialect.Z80) {
                diagnostics.push({ line: i, message: `Local label starting with a single '@' is an ez80asm feature, but file is asMSX (.z80)`, startCharacter: line.tokens[0] ? (line.tokens[0].start - line.start!) : undefined, length: line.labelToken ? (line.labelToken.start + line.labelToken.length - line.tokens[0].start) : undefined });
            } else if (name.startsWith('.') && document.dialect === CpuDialect.EZ80 && !document.isAsmsx) {
                diagnostics.push({ line: i, message: `Local label starting with '.' is an asMSX feature, but file is ez80asm (.ez80)`, startCharacter: line.tokens[0] ? (line.tokens[0].start - line.start!) : undefined, length: line.labelToken ? (line.labelToken.start + line.labelToken.length - line.tokens[0].start) : undefined });
            }

            if (name.startsWith('@') || name.startsWith('.')) {
                name = qualifyScopedLabel(name, currentGlobalLabel);
            } else {
                currentGlobalLabel = name;
            }

            if (line.label !== '@@') {
                if (localDefinitions.has(name)) {
                    diagnostics.push({ line: i, message: `Duplicate symbol definition: ${line.label}`, startCharacter: line.tokens[0] ? (line.tokens[0].start - line.start!) : undefined, length: line.labelToken ? (line.labelToken.start + line.labelToken.length - line.tokens[0].start) : undefined });
                } else {
                    localDefinitions.add(name);
                }
            }
        }
    }

    let currentIsAsmsxSyntax = document.isAsmsx;
    let currentScopeLabel = "";
    let currentCpu = document.dialect === CpuDialect.EZ80 ? CpuTarget.EZ80 : CpuTarget.Z80;
    const relocateStack: { line: number; token: Token | undefined }[] = [];
    let ifDepth = 0;
    const ifStack: { line: number; token: Token | undefined }[] = [];
    let macroDepth = 0;
    const macroStack: { line: number; token: Token | undefined }[] = [];

    for (let i = 0; i < document.lines.length; i++) {
        let hasBlockingOperandDiagnostic = false;
        const line = document.lines[i];
        if (line.label && !line.label.startsWith('@') && !line.label.startsWith('.')) {
            currentScopeLabel = line.label;
        }

        if (line.mnemonic === 'zilog') {
            currentIsAsmsxSyntax = false;
        }

        if (line.error) {
            diagnostics.push({ 
                line: i, 
                message: line.error,
                startCharacter: line.errorToken ? (line.errorToken.start - line.start!) : undefined,
                length: line.errorToken?.length
            });
            continue;
        }
        if (line.mnemonic === 'cpu') {
            const operand = line.operands?.[0];
            const cpu = operand?.length === 1 && operand[0].type === TokenType.Identifier
                ? CPU_TARGETS.get(operand[0].value.toLowerCase())
                : undefined;
            if (cpu === undefined) {
                diagnostics.push({
                    line: i,
                    message: "CPU directive expects Z80, Z180, or EZ80",
                    startCharacter: line.mnemonicToken ? line.mnemonicToken.start - line.start! : undefined,
                    length: line.mnemonicToken?.length
                });
            } else {
                currentCpu = cpu;
            }
            continue;
        }
        if (line.mnemonic === 'relocate') {
            relocateStack.push({ line: i, token: line.mnemonicToken });
            continue;
        }
        if (line.mnemonic === 'endrelocate') {
            if (relocateStack.length === 0) {
                diagnostics.push({
                    line: i,
                    message: "ENDRELOCATE without matching RELOCATE",
                    startCharacter: line.mnemonicToken ? line.mnemonicToken.start - line.start! : undefined,
                    length: line.mnemonicToken?.length
                });
            } else if (relocateStack.length > 1) {
                const nested = relocateStack.pop()!;
                diagnostics.push({
                    line: nested.line,
                    message: "RELOCATE blocks cannot be nested",
                    startCharacter: nested.token ? nested.token.start - document.lines[nested.line].start! : undefined,
                    length: nested.token?.length
                });
            } else {
                relocateStack.pop();
            }
            continue;
        }
        if (line.mnemonic === 'if' || line.mnemonic === 'ifdef' || line.mnemonic === 'ifndef') {
            ifDepth++;
            ifStack.push({ line: i, token: line.mnemonicToken });
            continue;
        }
        if (line.mnemonic === 'else') {
            if (ifDepth === 0) {
                diagnostics.push({
                    line: i,
                    message: "ELSE without matching IF",
                    startCharacter: line.mnemonicToken ? line.mnemonicToken.start - line.start! : undefined,
                    length: line.mnemonicToken?.length
                });
            }
            continue;
        }
        if (line.mnemonic === 'endif') {
            if (ifDepth === 0) {
                diagnostics.push({
                    line: i,
                    message: "ENDIF without matching IF",
                    startCharacter: line.mnemonicToken ? line.mnemonicToken.start - line.start! : undefined,
                    length: line.mnemonicToken?.length
                });
            } else {
                ifDepth--;
                ifStack.pop();
            }
            continue;
        }
        if (line.mnemonic === 'macro') {
            macroDepth++;
            macroStack.push({ line: i, token: line.mnemonicToken });
            // macro directive is valid, but body is skipped
        }
        
        if (line.mnemonic === 'endm' || line.mnemonic === 'endmacro') {
            if (macroDepth === 0) {
                diagnostics.push({
                    line: i,
                    message: `${line.mnemonic.toUpperCase()} without matching MACRO`,
                    startCharacter: line.mnemonicToken ? line.mnemonicToken.start - line.start! : undefined,
                    length: line.mnemonicToken?.length
                });
            } else {
                macroDepth--;
                macroStack.pop();
            }
            continue;
        }
        // Inside inactive conditional or macro block — suppress all diagnostics for skipped code
        if (line.isInactive || macroDepth > 0) {
            continue;
        }
        if (line.mnemonic && !line.isDirective) {
            const mnemonicToken = line.mnemonicToken;
            const hasDirectiveDot = mnemonicToken !== undefined && line.tokens.some((token) =>
                token.type === TokenType.Dot &&
                token.start + token.length === mnemonicToken.start
            );
            if (hasDirectiveDot && mnemonicToken !== undefined && getDirectiveMetadata(line.mnemonic) === undefined) {
                diagnostics.push({
                    line: i,
                    message: `Unknown directive: .${line.mnemonic}`,
                    startCharacter: mnemonicToken.start - line.start! - 1,
                    length: mnemonicToken.length + 1
                });
            } else {
                const meta = getInstructionMetadata(line.mnemonic);
                if (!meta) {
                    // check if it's a known macro call
                    if (!workspace.symbols.has(line.mnemonic)) {
                        diagnostics.push({ line: i, message: `Unknown instruction: ${line.mnemonic}`, startCharacter: line.mnemonicToken ? (line.mnemonicToken.start - line.start!) : undefined, length: line.mnemonicToken?.length });
                    } else {
                        // It's a macro call — skip instruction-specific operand validation
                        hasBlockingOperandDiagnostic = true;
                    }
                } else {
                    if (!meta.supportedDialects.includes(document.dialect)) {
                        diagnostics.push({ line: i, message: `Instruction '${line.mnemonic}' is not supported in dialect ${document.dialect}`, startCharacter: line.mnemonicToken ? (line.mnemonicToken.start - line.start!) : undefined, length: line.mnemonicToken?.length });
                    } else if (!meta.supportedCpus.includes(currentCpu)) {
                        diagnostics.push({ line: i, message: `Instruction '${line.mnemonic}' is not supported by CPU ${currentCpu.toUpperCase()}`, startCharacter: line.mnemonicToken ? (line.mnemonicToken.start - line.start!) : undefined, length: line.mnemonicToken?.length });
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
            const result = validateGenericDirectiveOperands(line, i);
            if (result.handled) {
                for (const diag of result.diagnostics) {
                    diagnostics.push(diag);
                }
                
                const mnem = line.mnemonic.toLowerCase().replace('.', '');
                if (mnem === 'subpage' || mnem === 'select') {
                    if (line.operands && line.operands.length === 1 && result.diagnostics.length === 0) {
                        let atIndex = -1;
                        for (let j = 0; j < line.operands[0].length; j++) {
                            if (line.operands[0][j].type === TokenType.Identifier && line.operands[0][j].value.toLowerCase() === 'at') {
                                atIndex = j;
                                break;
                            }
                        }
                        if (atIndex > 0 && atIndex < line.operands[0].length - 1) {
                            const nTokens = line.operands[0].slice(0, atIndex);
                            const xTokens = line.operands[0].slice(atIndex + 1);
                            
                            diagnostics.push(...validateConstantExpression(nTokens, i, line.start!, val => {
                                return (val < 0 || val > 255) ? `Subpage number must be an 8-bit unsigned integer (0-255), but was ${val}` : null;
                            }));

                            diagnostics.push(...validateConstantExpression(xTokens, i, line.start!, val => {
                                return (val < 0 || val > MAX_ADDR_Z80) ? `Execution entry point must be a 16-bit unsigned address (0-${MAX_ADDR_Z80}), but was ${val}` : null;
                            }));
                        }
                    }
                }

                if (!result.expectsExpression || result.diagnostics.length > 0) {
                    continue;
                }
                
                if (mnem === 'page' && line.operands && line.operands.length === 1) {
                    diagnostics.push(...validateConstantExpression(line.operands[0], i, line.start!, val => {
                        return (val < 0 || val > 3) ? `Page number must be between 0 and 3, but was ${val}` : null;
                    }));
                }

                if ((mnem === 'org' || mnem === 'phase' || mnem === 'start') && line.operands && line.operands.length === 1) {
                    const maxVal = document.dialect === CpuDialect.EZ80 ? MAX_ADDR_EZ80 : MAX_ADDR_Z80;
                    const maxBits = document.dialect === CpuDialect.EZ80 ? '24-bit' : '16-bit';
                    diagnostics.push(...validateConstantExpression(line.operands[0], i, line.start!, val => {
                        return (val < 0 || val > maxVal) ? `Address must be a ${maxBits} unsigned integer (0-${maxVal}), but was ${val}` : null;
                    }));
                }

                if ((mnem === 'callbios' || mnem === 'calldos') && line.operands && line.operands.length === 1) {
                    const maxVal = mnem === 'calldos' ? 255 : MAX_ADDR_Z80;
                    const maxBits = mnem === 'calldos' ? '8-bit' : '16-bit';
                    const argName = mnem === 'calldos' ? 'Function number' : 'Address';
                    diagnostics.push(...validateConstantExpression(line.operands[0], i, line.start!, val => {
                        return (val < 0 || val > maxVal) ? `${argName} must be an ${maxBits} unsigned integer (0-${maxVal}), but was ${val}` : null;
                    }));
                }

                if (mnem === 'size' && line.operands && line.operands.length === 1) {
                    diagnostics.push(...validateConstantExpression(line.operands[0], i, line.start!, val => {
                        return (val <= 0 || val > 8192) ? `Size in kilobytes must be between 1 and 8192 (8MB), but was ${val}` : null;
                    }));
                }
            }
        }


        if (line.operands) {

            // In eZ80: [reg] is wrong (indirect needs parens); expression grouping [expr] is fine.
            // In asMSX: (reg) is wrong (indirect needs brackets); expression grouping (expr) is fine.
            const wrongOpen   = currentIsAsmsxSyntax ? TokenType.LParen   : TokenType.LBracket;
            const wrongClose  = currentIsAsmsxSyntax ? TokenType.RParen   : TokenType.RBracket;
            const correct     = currentIsAsmsxSyntax ? 'square brackets' : 'parentheses';
            const wrong       = currentIsAsmsxSyntax ? 'parentheses'     : 'square brackets';

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
                    const parser = new ExpressionParser(operand);
                    const ast = parser.parse();
                    
                    const unresolved = findUnresolvedSymbols(ast, document, workspace, localDefinitions, currentScopeLabel);
                    for (const sym of unresolved) {
                        diagnostics.push({ 
                            line: i, 
                            message: `Unresolved symbol: ${sym}`,
                            startCharacter: operand[0] ? (operand[0].start - line.start!) : undefined,
                            length: operand.length > 0 ? (operand[operand.length - 1].start + operand[operand.length - 1].length - operand[0].start) : undefined
                        });
                    }
                } catch (e: unknown) {
                    hasBlockingOperandDiagnostic = true;
                    const diag: Diagnostic = { line: i, message: `Wrong operand form: ${e instanceof Error ? e.message : String(e)}` };
                    if (e instanceof ParseError && e.token) {
                        diag.startCharacter = e.token.start - line.start!;
                        diag.length = e.token.length;
                    } else if (operand.length > 0) {
                        diag.startCharacter = operand[0].start - line.start!;
                        diag.length = operand[operand.length - 1].start + operand[operand.length - 1].length - operand[0].start;
                    }
                    diagnostics.push(diag);
                }
            }
        }

        if (!hasBlockingOperandDiagnostic && line.mnemonic && !line.isDirective) {
            const meta = getInstructionMetadata(line.mnemonic);
            if (meta && meta.supportedDialects.includes(document.dialect)) {
                let result: ValidationResult = { error: null, sigOps: null };
                if (line.operands && line.mnemonicToken) {
                    result = validateInstructionOperands(line.operands, line.mnemonic, meta, document.dialect, currentIsAsmsxSyntax);
                } else if (!line.operands && meta.signature.includes(' ') && line.mnemonicToken) {
                    result = validateInstructionOperands([], line.mnemonic, meta, document.dialect, currentIsAsmsxSyntax);
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
                        
                        try {
                            const parser = new ExpressionParser(operand);
                            const ast = parser.parse();
                            if (isConstantExpression(ast)) {
                                const val = evaluate(ast, () => undefined, 0);
                                let rangeError: string | null = null;
                                
                                // Strip indirect for range checks
                                const isIndirect = isIndirectOperand(operand, currentIsAsmsxSyntax);
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
                                const isIndirect = isIndirectOperand(operand, currentIsAsmsxSyntax);
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
                        } catch {
                            // Ignored, parse errors handled earlier
                        }
                    }
                }
            }
        }
    }

    for (const unclosed of relocateStack) {
        diagnostics.push({
            line: unclosed.line,
            message: "RELOCATE without matching ENDRELOCATE",
            startCharacter: unclosed.token ? unclosed.token.start - document.lines[unclosed.line].start! : undefined,
            length: unclosed.token?.length
        });
    }

    for (const unclosed of ifStack) {
        diagnostics.push({
            line: unclosed.line,
            message: "IF without matching ENDIF",
            startCharacter: unclosed.token ? unclosed.token.start - document.lines[unclosed.line].start! : undefined,
            length: unclosed.token?.length
        });
    }


    for (const unclosed of macroStack) {
        diagnostics.push({
            line: unclosed.line,
            message: "MACRO without matching ENDM/ENDMACRO",
            startCharacter: unclosed.token ? unclosed.token.start - document.lines[unclosed.line].start! : undefined,
            length: unclosed.token?.length
        });
    }
    return diagnostics;
}

// Registers that may appear inside indirect-addressing brackets.
// Single 8-bit registers (h, l, a, b, d, e, i, r, ixh, etc.) are NOT in this set.
const INDIRECT_CAPABLE_REGISTERS = new Set([
    'hl', 'bc', 'de', 'sp', 'ix', 'iy',
    'c',      // (C) is valid for IN/OUT port addressing
    'mbase',  // eZ80 extension
]);

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
        INDIRECT_CAPABLE_REGISTERS.has(t.value.toLowerCase())
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
    if (INDIRECT_CAPABLE_REGISTERS.has(name)) return null;
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
    if (INDIRECT_CAPABLE_REGISTERS.has(name) || name === 'hl' || name === 'de' || name === 'bc' || name === 'sp') {
        return operand[1].value;
    }
    
    return null;
}

/**
 * Checks if an operand has the outer syntax of an indirect memory access.
 */
function isIndirectOperand(operand: Token[], isAsmsx: boolean): boolean {
    if (operand.length < 3) return false;
    const first = operand[0].type;
    const last = operand[operand.length - 1].type;
    
    if (isAsmsx) {
        // In asMSX, only [] represents indirect memory access; () is purely for math grouping.
        return first === TokenType.LBracket && last === TokenType.RBracket;
    } else {
        // In standard Z80/eZ80, both () and [] might be used (even if [] is wrong, the intent is indirect).
        return (first === TokenType.LParen && last === TokenType.RParen) ||
               (first === TokenType.LBracket && last === TokenType.RBracket);
    }
}

function findUnresolvedSymbols(
    node: ASTNode,
    document: AsmDocument,
    workspace: IndexedWorkspace,
    localDefs: Set<string>,
    currentGlobalLabel: string
): string[] {
    const unresolved: string[] = [];

    function traverse(n: ASTNode) {
        if (n.type === 'Symbol') {
            const name = (n as SymbolNode).name;
            const qualifiedName = qualifyScopedLabel(name, currentGlobalLabel);
            if (!isRegister(name, document.dialect) &&
                !isConditionCode(name) &&
                !TEMPORARY_LOCAL_LABELS[name] &&
                !workspace.symbols.has(qualifiedName) &&
                !localDefs.has(qualifiedName)) {
                unresolved.push(qualifiedName);
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

const MEGAS_TYPES = new Set(['konami', 'konami_scc', 'ascii8', 'ascii16']);

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
    if (!MEGAS_TYPES.has(typeValue)) {
        diagnostics.push({
            line,
            message: `Unknown MegaROM type: '${operand[0].value}'. Valid types are usually KONAMI, KONAMI_SCC, ASCII8, ASCII16.`,
            startCharacter: operand[0].start - lineStart,
            length: operand[0].length
        });
    }
    return diagnostics;
}



function validateGenericDirectiveOperands(line: LineNode, lineIndex: number): { diagnostics: Diagnostic[], handled: boolean, expectsExpression: boolean } {
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

    const noParamDirectives = new Set(['bios', 'biosvars', 'rom', 'basic', 'msxdos', 'search', 'dephase', 'sinclair', 'zilog', 'endr']);
    const oneParamDirectives = new Set(['org', 'page', 'start', 'phase', 'callbios', 'calldos', 'size', 'rept', 'print', 'printdec', 'printhex', 'equ']);
    const stringParamDirectives = new Set(['include', 'debug', 'printtext', 'printstring']);
    const optStringParamDirectives = new Set(['cas', 'cassette', 'wav', 'filename']);
    const optParamDirectives = new Set(['break', 'breakpoint']);
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
    if (noParamDirectives.has(mnemonic)) {
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

    if (oneParamDirectives.has(mnemonic)) {
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
        return { diagnostics, handled: true, expectsExpression: true };
    }

    if (stringParamDirectives.has(mnemonic)) {
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

    if (optStringParamDirectives.has(mnemonic)) {
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

    if (optParamDirectives.has(mnemonic)) {
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
        } else if (operands[0].length !== 1 || operands[0][0].type !== TokenType.Identifier || !['konami', 'konamiscc', 'ascii8', 'ascii16'].includes(operands[0][0].value.toLowerCase())) {
            diagnostics.push({
                line: lineIndex,
                message: `Invalid mapper type. Expected KONAMI, KONAMISCC, ASCII8, or ASCII16`,
                startCharacter: operands[0][0].start - lineStart,
                length: operands[0][operands[0].length - 1].start + operands[0][operands[0].length - 1].length - operands[0][0].start
            });
        }
        return { diagnostics, handled: true, expectsExpression: false };
    }

    if (mnemonic === 'subpage' || mnemonic === 'select') {
        if (operands.length !== 1 || operands[0].length < 3) {
            diagnostics.push({
                line: lineIndex,
                message: `Directive '${mnemonic}' requires format: <n> at <address>`,
                startCharacter: line.mnemonicToken ? (line.mnemonicToken.start - lineStart) : undefined,
                length: line.mnemonicToken?.length
            });
            return { diagnostics, handled: true, expectsExpression: false };
        }
        let hasAt = false;
        for (const token of operands[0]) {
            if (token.type === TokenType.Identifier && token.value.toLowerCase() === 'at') {
                hasAt = true;
                break;
            }
        }
        if (!hasAt) {
            diagnostics.push({
                line: lineIndex,
                message: `Directive '${mnemonic}' requires 'at' keyword`,
                startCharacter: operands[0][0].start - lineStart,
                length: operands[0][operands[0].length - 1].start + operands[0][operands[0].length - 1].length - operands[0][0].start
            });
        } else {
            for (const token of operands[0]) {
                if (token.type === TokenType.String) {
                    diagnostics.push({
                        line: lineIndex,
                        message: `Directive '${mnemonic}' expects numeric expressions, not strings`,
                        startCharacter: token.start - lineStart,
                        length: token.length
                    });
                }
            }
        }
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
                            const parser = new ExpressionParser(exprTokens);
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

export function validateInstructionOperands(
    operands: Token[][],
    mnemonic: string,
    meta: { signature: string },
    dialect: CpuDialect,
    isAsmsxSyntax: boolean
): ValidationResult {
    if (!meta.signature) return { error: null, sigOps: null };

    const overloads = meta.signature.split('|').map(s => s.trim());
    const expectedCounts = new Set<number>();
    const parsedOverloads: string[][] = [];
    
    for (const overload of overloads) {
        const parts = overload.split(/\s+/);
        // "ADC" "A," "s" -> skip mnemonic
        const sigOpsStr = parts.slice(1).join('');
        const sigOps = sigOpsStr ? sigOpsStr.split(',') : [];
        expectedCounts.add(sigOps.length);
        parsedOverloads.push(sigOps);
        
        if (matchOverload(operands, sigOps, mnemonic, dialect, isAsmsxSyntax)) {
            return { error: null, sigOps }; // found a match!
        }
    }

    if (!expectedCounts.has(operands.length)) {
        const counts = Array.from(expectedCounts).sort((a, b) => a - b);
        const expectedCountStr = counts.length === 1 ? counts[0].toString() : counts.join(' or ');
        return { error: `Instruction '${mnemonic}' expects ${expectedCountStr} operand${expectedCountStr === '1' ? '' : 's'}, but got ${operands.length}`, sigOps: null };
    }

    const matchingCountOverloads = parsedOverloads.filter(sigOps => sigOps.length === operands.length);
    if (matchingCountOverloads.length === 1) {
        const sigOps = matchingCountOverloads[0];
        for (let i = 0; i < operands.length; i++) {
            if (!matchOperand(operands[i], sigOps[i], mnemonic, dialect, isAsmsxSyntax)) {
                return { error: `Operand ${i + 1} of '${mnemonic}' must be ${sigOps[i]}`, errorIndex: i, sigOps: null };
            }
        }
    } else if (matchingCountOverloads.length > 1) {
        for (let prefixLen = operands.length - 1; prefixLen >= 0; prefixLen--) {
            const partialMatches = matchingCountOverloads.filter(sigOps => {
                for (let i = 0; i < prefixLen; i++) {
                    if (!matchOperand(operands[i], sigOps[i], mnemonic, dialect, isAsmsxSyntax)) return false;
                }
                return true;
            });
            if (partialMatches.length > 0) {
                const expectedOpts = Array.from(new Set(partialMatches.map(sigOps => sigOps[prefixLen])));
                return { error: `Operand ${prefixLen + 1} of '${mnemonic}' must be ${expectedOpts.join(' or ')}`, errorIndex: prefixLen, sigOps: null };
            }
        }
    }

    return { error: `Invalid operands for '${mnemonic}'. Expected one of: ${meta.signature}`, sigOps: null };
}

function matchOverload(operands: Token[][], sigOps: string[], mnemonic: string, dialect: CpuDialect, isAsmsxSyntax: boolean): boolean {
    if (operands.length !== sigOps.length) return false;
    for (let i = 0; i < operands.length; i++) {
        if (!matchOperand(operands[i], sigOps[i], mnemonic, dialect, isAsmsxSyntax)) {
            return false;
        }
    }
    return true;
}

function stringify(operand: Token[]): string {
    return operand.map(t => t.value).join('').toLowerCase();
}

function stripIndirect(operand: Token[]): Token[] {
    return operand.slice(1, -1);
}

function isExpr(operand: Token[], dialect: CpuDialect): boolean {
    if (operand.length === 0) return false;
    if (operand.length === 1) {
        const t = operand[0];
        if (t.type === TokenType.Number) return true;
        if (t.type === TokenType.String) return t.quote === "'" && !t.invalidEscape && t.value.length === 1;
        if (t.type === TokenType.Identifier) {
            if (isRegister(t.value, dialect)) return false;
            if (isConditionCode(t.value)) return false;
            return true;
        }
        return false;
    }

    try {
        new ExpressionParser(operand).parse();
        return true;
    } catch {
        return false;
    }
}

function isSingleReg(operand: Token[], validRegs: string[]): boolean {
    if (operand.length !== 1) return false;
    if (operand[0].type !== TokenType.Identifier) return false;
    return validRegs.includes(operand[0].value.toLowerCase());
}

const REG_8 = ['a', 'b', 'c', 'd', 'e', 'h', 'l'];
const REG_DD = ['bc', 'de', 'hl', 'sp'];
const REG_SS = ['bc', 'de', 'hl', 'sp'];
const REG_PP = ['bc', 'de', 'ix', 'sp'];
const REG_RR = ['bc', 'de', 'iy', 'sp'];
const REG_QQ = ['af', 'bc', 'de', 'hl'];
const REG_LEA = ['bc', 'de', 'hl'];

function matchOperand(operand: Token[], sigPart: string, mnemonic: string, dialect: CpuDialect, isAsmsxSyntax: boolean): boolean {
    const indirect = isIndirectOperand(operand, isAsmsxSyntax);
    const inner = indirect ? stripIndirect(operand) : operand;
    const innerStr = stringify(inner);
    const opStr = stringify(operand);

    const s = sigPart.toLowerCase();

    switch (s) {
        case 'a': case 'af': case 'af\'': case 'de': case 'hl': case 'sp':
        case 'ix': case 'iy':
            return !indirect && opStr === s;
            
        case '0':
            return !indirect && opStr === '0';

        case 'r': case 'r\'':
            if (sigPart === 'R') {
                return !indirect && opStr === 'r';
            }
            return !indirect && isSingleReg(operand, REG_8);
            
        case 'ss':
            return !indirect && isSingleReg(operand, REG_SS);
            
        case 'pp':
            return !indirect && isSingleReg(operand, REG_PP);
            
        case 'rr':
            return !indirect && isSingleReg(operand, REG_RR);
            
        case 'qq':
            return !indirect && isSingleReg(operand, REG_QQ);
        case 'kk':
            return !indirect && isSingleReg(operand, REG_LEA);


        case 'dd/pp/rr':
            return !indirect && (isSingleReg(operand, REG_DD) || isSingleReg(operand, REG_PP) || isSingleReg(operand, REG_RR));

        case 'n': case 'nn': case 'd': case 'e': case 'p': case 'b':
            return !indirect && isExpr(operand, dialect);

        case 'nz/z/nc/c':
            return !indirect && operand.length === 1 && ['nz', 'z', 'nc', 'c'].includes(operand[0].value.toLowerCase());

        case 'cc':
            return !indirect && operand.length === 1 && isConditionCode(operand[0].value);

        case 's':
            if (!indirect && isSingleReg(operand, REG_8)) return true;
            if (!indirect && isExpr(operand, dialect)) return true;
            if (indirect) {
                if (innerStr === 'hl') return true;
                if (innerStr.startsWith('ix') || innerStr.startsWith('iy')) return true;
            }
            return false;

        case 'm':
            if (!indirect && isSingleReg(operand, REG_8)) return true;
            if (indirect) {
                if (innerStr === 'hl') return true;
                if (innerStr.startsWith('ix') || innerStr.startsWith('iy')) return true;
            }
            return false;

        case '(hl)': return indirect && innerStr === 'hl';
        case '(bc)': return indirect && innerStr === 'bc';
        case '(de)': return indirect && innerStr === 'de';
        case '(ix)': return indirect && innerStr === 'ix';
        case '(iy)': return indirect && innerStr === 'iy';
        case '(c)': return indirect && innerStr === 'c';
        case '(sp)': return indirect && innerStr === 'sp';

        case '(ix+d)': return indirect && innerStr.startsWith('ix');
        case '(iy+d)': return indirect && innerStr.startsWith('iy');
        case '(ix/iy+d)': return indirect && (innerStr.startsWith('ix') || innerStr.startsWith('iy'));
        case 'ix+d': return !indirect && opStr.startsWith('ix');
        case 'iy+d': return !indirect && opStr.startsWith('iy');

        case '(n)':
        case '(nn)':
            return indirect && isExpr(inner, dialect);

        case '(bc/de/nn)':
            return indirect && (innerStr === 'bc' || innerStr === 'de' || isExpr(inner, dialect));

        case 'r/n':
            return !indirect && (isSingleReg(operand, REG_8) || isExpr(operand, dialect));

        case 'hl/ix/iy':
            return !indirect && (opStr === 'hl' || opStr === 'ix' || opStr === 'iy');

        default:
            return opStr === s;
    }
}

function extractIndexOffset(ast: ASTNode): number | null {
    if (ast.type === 'BinaryOp') {
        const bin = ast as BinaryOpNode;
        let constExpr: ASTNode | null = null;
        const isMinus = bin.op === '-';
        if (bin.op === '+' || bin.op === '-') {
            if (bin.left.type === 'Symbol' && ['ix', 'iy'].includes((bin.left as SymbolNode).name.toLowerCase())) {
                constExpr = bin.right;
            } else if (bin.op === '+' && bin.right.type === 'Symbol' && ['ix', 'iy'].includes((bin.right as SymbolNode).name.toLowerCase())) {
                constExpr = bin.left;
            }
        }
        if (constExpr && isConstantExpression(constExpr)) {
            const val = evaluate(constExpr, () => undefined, 0);
            return isMinus ? -val : val;
        }
    }
    return null;
}
