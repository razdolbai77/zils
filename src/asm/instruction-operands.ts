import { ASTNode, BinaryOpNode, ExpressionParser, SymbolNode, evaluate, isConstantExpression } from "./expressions";
import { Token, TokenType } from "./lexer";
import { CpuDialect, isConditionCode, isRegister } from "./metadata";

export interface ValidationResult {
    error: string | null;
    errorIndex?: number;
    sigOps: string[] | null;
}

// Registers that may appear inside indirect-addressing brackets.
// Single 8-bit registers (h, l, a, b, d, e, i, r, ixh, etc.) are NOT in this set.
export const INDIRECT_CAPABLE_REGISTERS: Record<string, true> = {
    hl: true,
    bc: true,
    de: true,
    sp: true,
    ix: true,
    iy: true,
    c: true, // (C) is valid for IN/OUT port addressing
    mbase: true, // eZ80 extension
};

const REG_8 = ["a", "b", "c", "d", "e", "h", "l"];
const REG_INDEX_IX = ["ixh", "ixl"];
const REG_INDEX_IY = ["iyh", "iyl"];
const REG_DD = ["bc", "de", "hl", "sp"];
const REG_SS = ["bc", "de", "hl", "sp"];
const REG_PP = ["bc", "de", "ix", "sp"];
const REG_RR = ["bc", "de", "iy", "sp"];
const REG_QQ = ["af", "bc", "de", "hl"];
const REG_LEA = ["bc", "de", "hl"];

export function isIndirectOperand(operand: Token[], isAsmsx: boolean): boolean {
    if (operand.length < 3) return false;
    const first = operand[0].type;
    const last = operand[operand.length - 1].type;

    if (isAsmsx) {
        // In asMSX, only [] represents indirect memory access; () is purely for math grouping.
        return first === TokenType.LBracket && last === TokenType.RBracket;
    }

    // In standard Z80/eZ80, both () and [] might be used (even if [] is wrong, the intent is indirect).
    return (first === TokenType.LParen && last === TokenType.RParen) ||
        (first === TokenType.LBracket && last === TokenType.RBracket);
}

export function validateInstructionOperands(
    operands: Token[][],
    mnemonic: string,
    meta: { signature: string },
    dialect: CpuDialect,
    isAsmsxSyntax: boolean
): ValidationResult {
    if (!meta.signature) return { error: null, sigOps: null };

    const overloads = meta.signature.split("|").map(s => s.trim());
    const expectedCounts = new Set<number>();
    const parsedOverloads: string[][] = [];

    for (const overload of overloads) {
        const parts = overload.split(/\s+/);
        // "ADC" "A," "s" -> skip mnemonic
        const sigOpsStr = parts.slice(1).join("");
        const sigOps = sigOpsStr ? sigOpsStr.split(",") : [];
        expectedCounts.add(sigOps.length);
        parsedOverloads.push(sigOps);

        if (matchOverload(operands, sigOps, mnemonic, dialect, isAsmsxSyntax)) {
            return { error: null, sigOps };
        }
    }

    if (!expectedCounts.has(operands.length)) {
        const counts = Array.from(expectedCounts).sort((a, b) => a - b);
        const expectedCountStr = counts.length === 1 ? counts[0].toString() : counts.join(" or ");
        return { error: `Instruction '${mnemonic}' expects ${expectedCountStr} operand${expectedCountStr === "1" ? "" : "s"}, but got ${operands.length}`, sigOps: null };
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
                return { error: `Operand ${prefixLen + 1} of '${mnemonic}' must be ${expectedOpts.join(" or ")}`, errorIndex: prefixLen, sigOps: null };
            }
        }
    }

    return { error: `Invalid operands for '${mnemonic}'. Expected one of: ${meta.signature}`, sigOps: null };
}

function matchOverload(operands: Token[][], sigOps: string[], mnemonic: string, dialect: CpuDialect, isAsmsxSyntax: boolean): boolean {
    if (operands.length !== sigOps.length) return false;
    for (let i = 0; i < operands.length; i++) {
        if (!matchOperand(operands[i], sigOps[i], mnemonic, dialect, isAsmsxSyntax)) return false;
    }
    return true;
}

function stringify(operand: Token[]): string {
    return operand.map(t => t.value).join("").toLowerCase();
}

function stripIndirect(operand: Token[]): Token[] {
    return operand.slice(1, -1);
}

function isExpr(operand: Token[], dialect: CpuDialect): boolean {
    if (operand.length === 0) return false;
    if (operand.length === 1) {
        const token = operand[0];
        if (token.type === TokenType.Number) return true;
        if (token.type === TokenType.String) return token.quote === "'" && !token.invalidEscape && token.value.length === 1;
        if (token.type === TokenType.Identifier) return !isRegister(token.value, dialect) && !isConditionCode(token.value);
        return false;
    }

    try {
        new ExpressionParser(operand, dialect).parse();
        return true;
    } catch {
        return false;
    }
}

function isGroupedExpression(operand: Token[], dialect: CpuDialect, isAsmsxSyntax: boolean): boolean {
    if (operand.length < 3) return false;

    const first = operand[0].type;
    const last = operand[operand.length - 1].type;
    const isParenthesized = first === TokenType.LParen && last === TokenType.RParen;
    const isBracketed = first === TokenType.LBracket && last === TokenType.RBracket;
    if (!isParenthesized && !isBracketed) return false;
    if (isAsmsxSyntax && !isParenthesized) return false;

    const inner = stripIndirect(operand);
    return isExpr(inner, dialect) && !inner.some(token =>
        token.type === TokenType.Identifier &&
        INDIRECT_CAPABLE_REGISTERS[token.value.toLowerCase()] === true
    );
}

function isSingleReg(operand: Token[], validRegs: string[]): boolean {
    return operand.length === 1 && operand[0].type === TokenType.Identifier && validRegs.includes(operand[0].value.toLowerCase());
}

function matchOperand(operand: Token[], sigPart: string, mnemonic: string, dialect: CpuDialect, isAsmsxSyntax: boolean): boolean {
    const indirect = isIndirectOperand(operand, isAsmsxSyntax);
    const inner = indirect ? stripIndirect(operand) : operand;
    const innerStr = stringify(inner);
    const opStr = stringify(operand);
    const groupedExpression = isGroupedExpression(operand, dialect, isAsmsxSyntax);
    const signature = sigPart.toLowerCase();

    switch (signature) {
        case "a": case "af": case "af'": case "de": case "hl": case "sp":
        case "ix": case "iy":
            return !indirect && opStr === signature;
        case "0":
            return !indirect && opStr === "0";
        case "r": case "r'":
            return sigPart === "R" ? !indirect && opStr === "r" : !indirect && isSingleReg(operand, REG_8);
        case "ss":
            return !indirect && isSingleReg(operand, REG_SS);
        case "pp":
            return !indirect && isSingleReg(operand, REG_PP);
        case "rr":
            return !indirect && isSingleReg(operand, REG_RR);
        case "qq":
            return !indirect && isSingleReg(operand, REG_QQ);
        case "kk":
            return !indirect && isSingleReg(operand, REG_LEA);
        case "dd/pp/rr":
            return !indirect && (isSingleReg(operand, REG_DD) || isSingleReg(operand, REG_PP) || isSingleReg(operand, REG_RR));
        case "n": case "nn": case "d": case "e": case "p": case "b":
            return (!indirect || groupedExpression) && isExpr(operand, dialect);
        case "nz/z/nc/c":
            return !indirect && operand.length === 1 && ["nz", "z", "nc", "c"].includes(operand[0].value.toLowerCase());
        case "cc":
            return !indirect && operand.length === 1 && isConditionCode(operand[0].value);
        case "s":
            if ((!indirect || groupedExpression) && (isSingleReg(operand, REG_8) || isSingleReg(operand, REG_INDEX_IX) || isSingleReg(operand, REG_INDEX_IY))) return true;
            if ((!indirect || groupedExpression) && isExpr(operand, dialect)) return true;
            return indirect && (innerStr === "hl" || innerStr.startsWith("ix") || innerStr.startsWith("iy"));
        case "m":
            if (!indirect && isSingleReg(operand, REG_8)) return true;
            return indirect && (innerStr === "hl" || innerStr.startsWith("ix") || innerStr.startsWith("iy"));
        case "x": case "x'":
            return !indirect && isSingleReg(operand, REG_INDEX_IX);
        case "y": case "y'":
            return !indirect && isSingleReg(operand, REG_INDEX_IY);
        case "(hl)": return indirect && innerStr === "hl";
        case "(bc)": return indirect && innerStr === "bc";
        case "(de)": return indirect && innerStr === "de";
        case "(ix)": return indirect && innerStr === "ix";
        case "(iy)": return indirect && innerStr === "iy";
        case "(c)": return indirect && innerStr === "c";
        case "(sp)": return indirect && innerStr === "sp";
        case "(ix+d)": return indirect && innerStr.startsWith("ix");
        case "(iy+d)": return indirect && innerStr.startsWith("iy");
        case "(ix/iy+d)": return indirect && (innerStr.startsWith("ix") || innerStr.startsWith("iy"));
        case "ix+d": return !indirect && opStr.startsWith("ix");
        case "iy+d": return !indirect && opStr.startsWith("iy");
        case "(n)": case "(nn)":
            return indirect && isExpr(inner, dialect);
        case "(bc/de/nn)":
            return indirect && (innerStr === "bc" || innerStr === "de" || isExpr(inner, dialect));
        case "r/n":
            return (!indirect || groupedExpression) && (isSingleReg(operand, REG_8) || isExpr(operand, dialect));
        case "hl/ix/iy":
            return !indirect && (opStr === "hl" || opStr === "ix" || opStr === "iy");
        default:
            return opStr === signature;
    }
}

export function extractIndexOffset(ast: ASTNode): number | null {
    // Returns signed constant offset of an `ix`/`iy` anchor anywhere in a +/- spine.
    const offset = extractAnchorOffset(ast);
    return offset === null || offset.anchors !== 1 ? null : offset.value;
}

function extractAnchorOffset(node: ASTNode): { value: number; anchors: number } | null {
    if (node.type === "Symbol") {
        const name = (node as SymbolNode).name.toLowerCase();
        return name === "ix" || name === "iy" ? { value: 0, anchors: 1 } : null;
    }
    if (node.type === "BinaryOp") {
        const binary = node as BinaryOpNode;
        if (binary.op === "+" || binary.op === "-") {
            const left = extractAnchorOffset(binary.left);
            const right = extractAnchorOffset(binary.right);
            if (left === null && right === null) return null;
            return {
                value: (left?.value ?? 0) + (binary.op === "-" ? -(right?.value ?? 0) : right?.value ?? 0),
                anchors: (left?.anchors ?? 0) + (right?.anchors ?? 0)
            };
        }
    }
    return isConstantExpression(node) ? { value: evaluate(node, () => undefined, 0), anchors: 0 } : null;
}
