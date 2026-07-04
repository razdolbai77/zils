import { IndexedWorkspace } from "./workspace";
import { Diagnostic, AsmDocument } from "./document";
import { getInstructionMetadata, isRegister, isConditionCode, CpuDialect } from "./metadata";
import { ExpressionParser, ASTNode, SymbolNode, UnaryOpNode, BinaryOpNode } from "./expressions";
import { Token, TokenType } from "./lexer";

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
                diagnostics.push({ line: i, message: `Local label starting with a single '@' is an ez80asm feature, but file is asMSX (.z80)` });
            } else if (name.startsWith('.') && document.dialect === CpuDialect.EZ80 && !document.isAsmsx) {
                diagnostics.push({ line: i, message: `Local label starting with '.' is an asMSX feature, but file is ez80asm (.ez80)` });
            }
            if (line.label !== '@@') {
                if (localDefinitions.has(name)) {
                    diagnostics.push({ line: i, message: `Duplicate symbol definition: ${name}` });
                } else {
                    localDefinitions.add(name);
                }
            }
        }
    }

    for (let i = 0; i < document.lines.length; i++) {
        const line = document.lines[i];

        if (line.error) {
            diagnostics.push({ line: i, message: line.error });
            continue;
        }

        if (line.mnemonic && !line.isDirective) {
            const meta = getInstructionMetadata(line.mnemonic);
            if (!meta) {
                diagnostics.push({ line: i, message: `Unknown instruction: ${line.mnemonic}` });
            } else {
                if (!meta.supportedDialects.includes(document.dialect)) {
                    diagnostics.push({ line: i, message: `Instruction '${line.mnemonic}' is not supported in dialect ${document.dialect}` });
                }
            }
        }

        if (line.operands) {
            // assume uses key=value syntax, not a standard expression
            if (line.mnemonic === 'assume') {
                for (const diag of validateAssumeOperands(line.operands, i)) {
                    diagnostics.push(diag);
                }
                continue;
            }

            // In eZ80: [reg] is wrong (indirect needs parens); expression grouping [expr] is fine.
            // In asMSX: (reg) is wrong (indirect needs brackets); expression grouping (expr) is fine.
            const wrongOpen   = document.isAsmsx ? TokenType.LParen   : TokenType.LBracket;
            const wrongClose  = document.isAsmsx ? TokenType.RParen   : TokenType.RBracket;
            const correct     = document.isAsmsx ? 'square brackets' : 'parentheses';
            const wrong       = document.isAsmsx ? 'parentheses'     : 'square brackets';

            let indirectOperandCount = 0;

            for (const operand of line.operands) {
                // If the operand is purely a string, don't parse it as an expression
                if (operand.length === 1 && operand[0].type === TokenType.String) continue;

                if (isWrongIndirectSyntax(operand, wrongOpen, wrongClose, document.dialect)) {
                    diagnostics.push({
                        line: i,
                        message: `${wrong[0].toUpperCase() + wrong.slice(1)} around a register indicate indirect addressing; use ${correct} instead`
                    });
                    continue;
                }

                const badReg = invalidIndirectRegister(operand, document.dialect);
                if (badReg !== null) {
                    diagnostics.push({
                        line: i,
                        message: `Register '${badReg}' cannot be used for indirect addressing; expected a register pair such as HL, BC, DE, SP, IX, or IY`
                    });
                    continue;
                }

                const badOffsetReg = invalidIndirectOffset(operand);
                if (badOffsetReg !== null) {
                    diagnostics.push({
                        line: i,
                        message: `Register '${badOffsetReg}' cannot be used with an offset in indirect addressing; only IX and IY support offsets`
                    });
                    continue;
                }

                try {
                    const parser = new ExpressionParser(operand);
                    const ast = parser.parse();
                    
                    const unresolved = findUnresolvedSymbols(ast, document, workspace, localDefinitions);
                    for (const sym of unresolved) {
                        diagnostics.push({ line: i, message: `Unresolved symbol: ${sym}` });
                    }
                } catch (e: unknown) {
                    diagnostics.push({ line: i, message: `Wrong operand form: ${e instanceof Error ? e.message : String(e)}` });
                }

                if (isIndirectOperand(operand, document.isAsmsx)) {
                    indirectOperandCount++;
                }
            }

            if (indirectOperandCount > 1 && line.mnemonic && getInstructionMetadata(line.mnemonic)) {
                diagnostics.push({
                    line: i,
                    message: "Instruction cannot have multiple indirect operands (memory-to-memory operations are not supported)"
                });
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

function validateAssumeOperands(operands: Token[][], line: number): Diagnostic[] {
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
            diagnostics.push({ line, message: `Malformed assume operand: expected 'key=value'` });
            continue;
        }

        const key = keyToken.value.toLowerCase();
        const validValues = ASSUME_KEYS.get(key);
        if (validValues === undefined) {
            diagnostics.push({ line, message: `Unknown assume key: '${keyToken.value}'` });
            continue;
        }

        const value = parseInt(valueToken.value, 10);
        if (!validValues.includes(value)) {
            diagnostics.push({ line, message: `Invalid value for assume '${key}': must be ${validValues.join(' or ')}` });
        }
    }

    return diagnostics;
}
