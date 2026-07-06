import { IndexedWorkspace } from "./workspace";
import { Diagnostic, AsmDocument } from "./document";
import { getInstructionMetadata, isRegister, isConditionCode, CpuDialect } from "./metadata";
import { ExpressionParser, ASTNode, SymbolNode, UnaryOpNode, BinaryOpNode, isConstantExpression, evaluate } from "./expressions";
import { Token, TokenType, ParseError } from "./lexer";

export interface ValidationResult {
    error: string | null;
    sigOps: string[] | null;
}

export function collectDiagnostics(workspace: IndexedWorkspace, uri: string): Diagnostic[] {
    const document = workspace.documents.get(uri);
    if (!document) return [];

    const diagnostics: Diagnostic[] = [];
    const localDefinitions = new Set<string>();
    
    // First pass: collect local definitions and detect duplicates within file
    for (let i = 0; i < document.lines.length; i++) {
        const line = document.lines[i];
        if (line.label) {
            const name = line.label;
            if (name.startsWith('@') && !name.startsWith('@@') && document.dialect === CpuDialect.Z80) {
                diagnostics.push({ line: i, message: `Local label starting with a single '@' is an ez80asm feature, but file is asMSX (.z80)`, startCharacter: line.tokens[0] ? (line.tokens[0].start - line.start!) : undefined, length: line.labelToken ? (line.labelToken.start + line.labelToken.length - line.tokens[0].start) : undefined });
            } else if (name.startsWith('.') && document.dialect === CpuDialect.EZ80 && !document.isAsmsx) {
                diagnostics.push({ line: i, message: `Local label starting with '.' is an asMSX feature, but file is ez80asm (.ez80)`, startCharacter: line.tokens[0] ? (line.tokens[0].start - line.start!) : undefined, length: line.labelToken ? (line.labelToken.start + line.labelToken.length - line.tokens[0].start) : undefined });
            }
            if (line.label !== '@@') {
                if (localDefinitions.has(name)) {
                    diagnostics.push({ line: i, message: `Duplicate symbol definition: ${name}`, startCharacter: line.tokens[0] ? (line.tokens[0].start - line.start!) : undefined, length: line.labelToken ? (line.labelToken.start + line.labelToken.length - line.tokens[0].start) : undefined });
                } else {
                    localDefinitions.add(name);
                }
            }
        }
    }

    let currentIsAsmsxSyntax = document.isAsmsx;

    for (let i = 0; i < document.lines.length; i++) {
        const line = document.lines[i];
        const diagCountBefore = diagnostics.length;

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

        if (line.mnemonic && !line.isDirective) {
            const meta = getInstructionMetadata(line.mnemonic);
            if (!meta) {
                diagnostics.push({ line: i, message: `Unknown instruction: ${line.mnemonic}`, startCharacter: line.mnemonicToken ? (line.mnemonicToken.start - line.start!) : undefined, length: line.mnemonicToken?.length });
            } else {
                if (!meta.supportedDialects.includes(document.dialect)) {
                    diagnostics.push({ line: i, message: `Instruction '${line.mnemonic}' is not supported in dialect ${document.dialect}`, startCharacter: line.mnemonicToken ? (line.mnemonicToken.start - line.start!) : undefined, length: line.mnemonicToken?.length });
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

        if (line.mnemonic === 'bios') {
            for (const diag of validateBiosOperands(line.operands || [], i, line.start!)) {
                diagnostics.push(diag);
            }
            continue;
        }

        if (line.mnemonic === 'biosvars') {
            for (const diag of validateBiosVarsOperands(line.operands || [], i, line.start!)) {
                diagnostics.push(diag);
            }
            continue;
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
                    
                    const unresolved = findUnresolvedSymbols(ast, document, workspace, localDefinitions);
                    for (const sym of unresolved) {
                        diagnostics.push({ 
                            line: i, 
                            message: `Unresolved symbol: ${sym}`,
                            startCharacter: operand[0] ? (operand[0].start - line.start!) : undefined,
                            length: operand.length > 0 ? (operand[operand.length - 1].start + operand[operand.length - 1].length - operand[0].start) : undefined
                        });
                    }
                } catch (e: unknown) {
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

        if (diagnostics.length === diagCountBefore && line.mnemonic && !line.isDirective) {
            const meta = getInstructionMetadata(line.mnemonic);
            if (meta && meta.supportedDialects.includes(document.dialect)) {
                let result: ValidationResult = { error: null, sigOps: null };
                if (line.operands && line.mnemonicToken) {
                    result = validateInstructionOperands(line.operands, line.mnemonic, meta, document.dialect, currentIsAsmsxSyntax);
                } else if (!line.operands && meta.signature.includes(' ') && line.mnemonicToken) {
                    result = validateInstructionOperands([], line.mnemonic, meta, document.dialect, currentIsAsmsxSyntax);
                }

                if (result.error && line.mnemonicToken) {
                    diagnostics.push({
                        line: i,
                        message: result.error,
                        startCharacter: line.mnemonicToken.start - line.start!,
                        length: line.mnemonicToken.length
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
                                } else if (actualSigPart === 'n' || actualSigPart === 'p' || actualSigPart === 's' || actualSigPart === 'm' || actualSigPart === 'r/n') {
                                    if (val < -128 || val > 255) rangeError = `8-bit literal must be between -128 and 255, but was ${val}`;
                                } else if (actualSigPart === 'nn') {
                                    if (val < -32768 || val > 65535) rangeError = `16-bit literal must be between -32768 and 65535, but was ${val}`;
                                } else if (actualSigPart === 'd' || actualSigPart === 'e') {
                                    if (val < -128 || val > 127) rangeError = `Relative offset must be between -128 and 127, but was ${val}`;
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

function findUnresolvedSymbols(node: ASTNode, document: AsmDocument, workspace: IndexedWorkspace, localDefs: Set<string>): string[] {
    const unresolved: string[] = [];

    function traverse(n: ASTNode) {
        if (n.type === 'Symbol') {
            const name = (n as SymbolNode).name;
            if (!isRegister(name, document.dialect) && 
                !isConditionCode(name) && 
                !workspace.symbols.has(name) &&
                !localDefs.has(name) &&
                // A very simple workaround for local labels that might be prefixed
                !name.startsWith('.') && !name.startsWith('@')) {
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

function validateBiosOperands(operands: Token[][], line: number, lineStart: number): Diagnostic[] {
    const diagnostics: Diagnostic[] = [];
    if (operands.length > 0) {
        const lastToken = operands[operands.length - 1][operands[operands.length - 1].length - 1];
        diagnostics.push({ 
            line, 
            message: `Directive 'bios' does not take any operands`,
            startCharacter: operands[0][0].start - lineStart,
            length: lastToken.start + lastToken.length - operands[0][0].start
        });
    }
    return diagnostics;
}

function validateBiosVarsOperands(operands: Token[][], line: number, lineStart: number): Diagnostic[] {
    const diagnostics: Diagnostic[] = [];
    if (operands.length > 0) {
        const lastToken = operands[operands.length - 1][operands[operands.length - 1].length - 1];
        diagnostics.push({ 
            line, 
            message: `Directive 'biosvars' does not take any operands`,
            startCharacter: operands[0][0].start - lineStart,
            length: lastToken.start + lastToken.length - operands[0][0].start
        });
    }
    return diagnostics;
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
        
        if (matchOverload(operands, sigOps, dialect, isAsmsxSyntax)) {
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
            if (!matchOperand(operands[i], sigOps[i], dialect, isAsmsxSyntax)) {
                return { error: `Operand ${i + 1} of '${mnemonic}' must be ${sigOps[i]}`, sigOps: null };
            }
        }
    } else if (matchingCountOverloads.length > 1) {
        for (let prefixLen = operands.length - 1; prefixLen >= 1; prefixLen--) {
            const partialMatches = matchingCountOverloads.filter(sigOps => {
                for (let i = 0; i < prefixLen; i++) {
                    if (!matchOperand(operands[i], sigOps[i], dialect, isAsmsxSyntax)) return false;
                }
                return true;
            });
            if (partialMatches.length > 0) {
                const expectedOpts = Array.from(new Set(partialMatches.map(sigOps => sigOps[prefixLen])));
                return { error: `Operand ${prefixLen + 1} of '${mnemonic}' must be ${expectedOpts.join(' or ')}`, sigOps: null };
            }
        }
    }

    return { error: `Invalid operands for '${mnemonic}'. Expected one of: ${meta.signature}`, sigOps: null };
}

function matchOverload(operands: Token[][], sigOps: string[], dialect: CpuDialect, isAsmsxSyntax: boolean): boolean {
    if (operands.length !== sigOps.length) return false;
    for (let i = 0; i < operands.length; i++) {
        if (!matchOperand(operands[i], sigOps[i], dialect, isAsmsxSyntax)) {
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
    if (operand.length !== 1) return true;
    const t = operand[0];
    if (t.type === TokenType.Number || t.type === TokenType.String) return true;
    if (t.type === TokenType.Identifier) {
        if (isRegister(t.value, dialect)) return false;
        if (isConditionCode(t.value)) return false;
        return true; 
    }
    return false;
}

function isSingleReg(operand: Token[], validRegs: string[]): boolean {
    if (operand.length !== 1) return false;
    if (operand[0].type !== TokenType.Identifier) return false;
    return validRegs.includes(operand[0].value.toLowerCase());
}

const REG_8 = ['a', 'b', 'c', 'd', 'e', 'h', 'l'];
const REG_SS = ['bc', 'de', 'hl', 'sp'];
const REG_PP = ['bc', 'de', 'ix', 'sp'];
const REG_RR = ['bc', 'de', 'iy', 'sp'];
const REG_QQ = ['af', 'bc', 'de', 'hl'];

function matchOperand(operand: Token[], sigPart: string, dialect: CpuDialect, isAsmsxSyntax: boolean): boolean {
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
            return !indirect && isSingleReg(operand, REG_8);
            
        case 'ss':
            return !indirect && isSingleReg(operand, REG_SS);
            
        case 'pp':
            return !indirect && isSingleReg(operand, REG_PP);
            
        case 'rr':
            return !indirect && isSingleReg(operand, REG_RR);
            
        case 'qq':
            return !indirect && isSingleReg(operand, REG_QQ);

        case 'n': case 'nn': case 'd': case 'e': case 'p': case 'b':
            return !indirect && isExpr(operand, dialect);

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
