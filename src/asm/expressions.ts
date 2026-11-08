import { Token, TokenType, ParseError } from './lexer';
import { CpuDialect, RANDOM_FUNCTION } from './metadata';
import { parseNumberValue } from './numbers';
import { TokenCursor } from './token-cursor';

export interface ASTNode {
    type: string;
    token?: Token;
}
export interface BinaryOpNode extends ASTNode {
    type: 'BinaryOp';
    op: string;
    left: ASTNode;
    right: ASTNode;
}
export interface UnaryOpNode extends ASTNode {
    type: 'UnaryOp';
    op: string;
    expr: ASTNode;
}
export interface NumberNode extends ASTNode {
    type: 'Number';
    value: number;
}
export interface CharacterNode extends ASTNode {
    type: 'Character';
    value: number;
}
export interface SymbolNode extends ASTNode {
    type: 'Symbol';
    name: string;
}
export interface CurrentLocNode extends ASTNode {
    type: 'CurrentLoc';
}
export interface FunctionCallNode extends ASTNode {
    type: 'FunctionCall';
    name: string;
    args: ASTNode[];
}

// asMSX unary operators bind tighter than every binary operator (C/C++ rules).
const UNARY_PRECEDENCE = 11;

export class ExpressionParser extends TokenCursor {
    constructor(tokens: Token[], private dialect: CpuDialect = CpuDialect.EZ80) {
        super(tokens);
    }

    public parse(): ASTNode {
        const expr = this.dialect === CpuDialect.Z80 ? this.parseAsmsxExpression() : this.parseLogicalOr();
        if (this.position < this.tokens.length) {
            throw new ParseError(`Unexpected token at end of expression: ${this.peek()?.value}`, this.peek());
        }
        return expr;
    }


    private parseAsmsxExpression(minPrecedence: number = 0): ASTNode {
        let left = this.parseAsmsxPrefix();

        while (true) {
            const operator = this.getAsmsxInfixOperator();
            if (!operator || operator.precedence < minPrecedence) return left;

            this.position++;
            const right = this.parseAsmsxExpression(operator.precedence + 1);
            left = { type: 'BinaryOp', op: operator.op, left, right, token: operator.token } as BinaryOpNode;
        }
    }

    private parseAsmsxPrefix(): ASTNode {
        const token = this.peek();
        if (!token) return this.parsePrimary();

        let op: string | null = null;
        let precedence = 0;
        if (token.type === TokenType.Plus || token.type === TokenType.Minus) {
            op = token.type === TokenType.Plus ? '+' : '-';
            precedence = UNARY_PRECEDENCE;
        } else if (token.type === TokenType.Tilde || token.type === TokenType.Exclamation) {
            op = token.type === TokenType.Tilde ? '~' : '!';
            precedence = UNARY_PRECEDENCE;
        } else if (token.type === TokenType.Identifier && token.value.toLowerCase() === 'not') {
            op = '~';
            precedence = UNARY_PRECEDENCE;
        }

        if (op === null) return this.parsePrimary();

        this.position++;
        return { type: 'UnaryOp', op, expr: this.parseAsmsxExpression(precedence), token } as UnaryOpNode;
    }

    // asMSX manual 2.3.2: "The precedence order is same as in C/C++."
    // Higher number binds tighter, matching the eZ80 recursive-descent grammar.
    private getAsmsxInfixOperator(): { op: string; precedence: number; token: Token } | null {
        const token = this.peek();
        if (!token) return null;

        switch (token.type) {
            case TokenType.LogicalOr: return { op: '||', precedence: 1, token };
            case TokenType.LogicalAnd: return { op: '&&', precedence: 2, token };
            case TokenType.Pipe: return { op: '|', precedence: 3, token };
            case TokenType.Caret: return { op: '^', precedence: 4, token };
            case TokenType.Ampersand: return { op: '&', precedence: 5, token };
            case TokenType.EqualEqual:
            case TokenType.Equals: return { op: '==', precedence: 6, token };
            case TokenType.NotEqual:
            case TokenType.LessGreater: return { op: '!=', precedence: 6, token };
            case TokenType.Less: return { op: '<', precedence: 7, token };
            case TokenType.LessEqual: return { op: '<=', precedence: 7, token };
            case TokenType.Greater: return { op: '>', precedence: 7, token };
            case TokenType.GreaterEqual: return { op: '>=', precedence: 7, token };
            case TokenType.ShiftLeft: return { op: '<<', precedence: 8, token };
            case TokenType.ShiftRight: return { op: '>>', precedence: 8, token };
            case TokenType.Plus: return { op: '+', precedence: 9, token };
            case TokenType.Minus: return { op: '-', precedence: 9, token };
            case TokenType.Asterisk: return { op: '*', precedence: 10, token };
            case TokenType.Slash: return { op: '/', precedence: 10, token };
            case TokenType.Percent: return { op: '%', precedence: 10, token };
            case TokenType.Identifier:
                switch (token.value.toLowerCase()) {
                    case 'or': return { op: '|', precedence: 3, token };
                    case 'xor': return { op: '^', precedence: 4, token };
                    case 'and': return { op: '&', precedence: 5, token };
                    case 'eq': return { op: '==', precedence: 6, token };
                    case 'ne': return { op: '!=', precedence: 6, token };
                    case 'lt': return { op: '<', precedence: 7, token };
                    case 'le': return { op: '<=', precedence: 7, token };
                    case 'gt': return { op: '>', precedence: 7, token };
                    case 'ge': return { op: '>=', precedence: 7, token };
                    case 'shl': return { op: '<<', precedence: 8, token };
                    case 'shr': return { op: '>>', precedence: 8, token };
                    case 'mod': return { op: '%', precedence: 10, token };
                    default: return null;
                }
            default:
                return null;
        }
    }

    private parseLogicalOr(): ASTNode {
        let left = this.parseLogicalAnd();
        while (this.match(TokenType.LogicalOr)) {
            const op = '||';
            const operatorToken = this.previous();
            const right = this.parseLogicalAnd();
            left = { type: 'BinaryOp', op, left, right, token: operatorToken } as BinaryOpNode;
        }
        return left;
    }

    private parseLogicalAnd(): ASTNode {
        let left = this.parseBitwiseOr();
        while (this.match(TokenType.LogicalAnd)) {
            const op = '&&';
            const operatorToken = this.previous();
            const right = this.parseBitwiseOr();
            left = { type: 'BinaryOp', op, left, right, token: operatorToken } as BinaryOpNode;
        }
        return left;
    }

    private parseBitwiseOr(): ASTNode {
        let left = this.parseBitwiseXor();
        while (this.match(TokenType.Pipe) || this.matchIdent('or')) {
            const op = '|';
            const operatorToken = this.previous();
            const right = this.parseBitwiseXor();
            left = { type: 'BinaryOp', op, left, right, token: operatorToken } as BinaryOpNode;
        }
        return left;
    }

    private parseBitwiseXor(): ASTNode {
        let left = this.parseBitwiseAnd();
        while (this.match(TokenType.Caret) || this.matchIdent('xor')) {
            const op = '^';
            const operatorToken = this.previous();
            const right = this.parseBitwiseAnd();
            left = { type: 'BinaryOp', op, left, right, token: operatorToken } as BinaryOpNode;
        }
        return left;
    }

    private parseBitwiseAnd(): ASTNode {
        let left = this.parseEquality();
        while (this.match(TokenType.Ampersand) || this.matchIdent('and')) {
            const op = '&';
            const operatorToken = this.previous();
            const right = this.parseEquality();
            left = { type: 'BinaryOp', op, left, right, token: operatorToken } as BinaryOpNode;
        }
        return left;
    }

    private parseEquality(): ASTNode {
        let left = this.parseRelational();
        while (
            this.match(TokenType.EqualEqual) ||
            this.match(TokenType.Equals) ||
            this.match(TokenType.NotEqual) ||
            this.match(TokenType.LessGreater) ||
            this.matchIdent('eq') ||
            this.matchIdent('ne')
        ) {
            const token = this.previous();
            let op = token.value;
            if (token.type === TokenType.Identifier) {
                op = token.value.toLowerCase() === 'eq' ? '==' : '!=';
            } else if (token.type === TokenType.Equals) {
                op = '==';
            } else if (token.type === TokenType.LessGreater) {
                op = '!=';
            }
            const right = this.parseRelational();
            left = { type: 'BinaryOp', op, left, right, token } as BinaryOpNode;
        }
        return left;
    }

    private parseRelational(): ASTNode {
        let left = this.parseShift();
        while (
            this.match(TokenType.Less) ||
            this.match(TokenType.LessEqual) ||
            this.match(TokenType.Greater) ||
            this.match(TokenType.GreaterEqual) ||
            this.matchIdent('lt') ||
            this.matchIdent('le') ||
            this.matchIdent('gt') ||
            this.matchIdent('ge')
        ) {
            const token = this.previous();
            let op = token.value;
            if (token.type === TokenType.Identifier) {
                const val = token.value.toLowerCase();
                if (val === 'lt') op = '<';
                else if (val === 'le') op = '<=';
                else if (val === 'gt') op = '>';
                else if (val === 'ge') op = '>=';
            }
            const right = this.parseShift();
            left = { type: 'BinaryOp', op, left, right, token } as BinaryOpNode;
        }
        return left;
    }

    private parseShift(): ASTNode {
        let left = this.parseAddSub();
        while (this.match(TokenType.ShiftLeft) || this.match(TokenType.ShiftRight) || this.matchIdent('shl') || this.matchIdent('shr')) {
            const token = this.previous();
            let op = token.value;
            if (token.type === TokenType.Identifier) {
                op = token.value.toLowerCase() === 'shl' ? '<<' : '>>';
            } else if (token.type === TokenType.ShiftLeft) {
                op = '<<';
            } else if (token.type === TokenType.ShiftRight) {
                op = '>>';
            }
            const right = this.parseAddSub();
            left = { type: 'BinaryOp', op, left, right, token } as BinaryOpNode;
        }
        return left;
    }

    private parseAddSub(): ASTNode {
        let left = this.parseMulDivMod();
        while (this.match(TokenType.Plus) || this.match(TokenType.Minus)) {
            const token = this.previous();
            const op = token.type === TokenType.Plus ? '+' : '-';
            const right = this.parseMulDivMod();
            left = { type: 'BinaryOp', op, left, right, token } as BinaryOpNode;
        }
        return left;
    }

    private parseMulDivMod(): ASTNode {
        let left = this.parseUnary();
        while (this.match(TokenType.Asterisk) || this.match(TokenType.Slash) || this.match(TokenType.Percent) || this.matchIdent('mod')) {
            const token = this.previous();
            let op = token.value;
            if (token.type === TokenType.Identifier) {
                op = '%';
            } else if (token.type === TokenType.Asterisk) {
                op = '*';
            } else if (token.type === TokenType.Slash) {
                op = '/';
            } else if (token.type === TokenType.Percent) {
                op = '%';
            }
            const right = this.parseUnary();
            left = { type: 'BinaryOp', op, left, right, token } as BinaryOpNode;
        }
        return left;
    }

    private parseUnary(): ASTNode {
        if (this.match(TokenType.Plus) || this.match(TokenType.Minus) || this.match(TokenType.Tilde) || this.match(TokenType.Exclamation) || this.matchIdent('not')) {
            const token = this.previous();
            let op = token.value;
            if (token.type === TokenType.Identifier && token.value.toLowerCase() === 'not') op = '~';
            if (token.type === TokenType.Exclamation) op = '!';
            const expr = this.parseUnary();
            return { type: 'UnaryOp', op, expr, token } as UnaryOpNode;
        }
        return this.parsePrimary();
    }

    private parsePrimary(): ASTNode {
        if (this.match(TokenType.String)) {
            const token = this.previous();
            if (token.quote !== "'" || token.invalidEscape || token.value.length !== 1) {
                throw new ParseError('Expected a single-character literal', token);
            }
            return { type: 'Character', value: token.value.charCodeAt(0), token } as CharacterNode;
        }

        if (this.match(TokenType.Number)) {
            const token = this.previous();
            return { type: 'Number', value: parseNumberValue(token.value), token } as NumberNode;
        }
        if (this.match(TokenType.Dollar)) {
            return { type: 'CurrentLoc', token: this.previous() } as CurrentLocNode;
        }
        if (this.match(TokenType.Identifier)) {
            const functionToken = this.previous();
            const name = functionToken.value;
            if (this.match(TokenType.LParen)) {
                const args: ASTNode[] = [];
                if (!this.check(TokenType.RParen)) {
                    do {
                        args.push(this.dialect === CpuDialect.Z80 ? this.parseAsmsxExpression() : this.parseLogicalOr());
                    } while (this.match(TokenType.Comma));
                }
                this.consume(TokenType.RParen, "Expected ')' after function arguments");
                if (name.toLowerCase() === RANDOM_FUNCTION && args.length !== 1) {
                    throw new ParseError("Invalid arity for .RANDOM", functionToken);
                }
                return { type: 'FunctionCall', name, args, token: functionToken } as FunctionCallNode;
            }
            return { type: 'Symbol', name, token: functionToken } as SymbolNode;
        }
        if (this.match(TokenType.Dot)) {
            if (this.match(TokenType.Identifier)) {
                const dotToken = this.previous();
                return { type: 'Symbol', name: '.' + dotToken.value, token: dotToken } as SymbolNode;
            }
            throw new ParseError(`Unexpected dot in expression`, this.peek());
        }
        if (this.match(TokenType.LParen)) {
            const expr = this.dialect === CpuDialect.Z80 ? this.parseAsmsxExpression() : this.parseLogicalOr();
            this.consume(TokenType.RParen, "Expected ')' after expression");
            return expr;
        }
        if (this.match(TokenType.LBracket)) {
            const expr = this.dialect === CpuDialect.Z80 ? this.parseAsmsxExpression() : this.parseLogicalOr();
            this.consume(TokenType.RBracket, "Expected ']' after expression");
            return expr;
        }
        const token = this.peek();
        if (token === null) {
            throw new ParseError('Missing expression', token);
        }
        throw new ParseError(`Unexpected token in expression: ${token.value}`, token);
    }


    private match(type: TokenType): boolean {
        if (this.check(type)) {
            this.position++;
            return true;
        }
        return false;
    }

    private matchIdent(value: string): boolean {
        if (this.check(TokenType.Identifier) && this.peek()!.value.toLowerCase() === value.toLowerCase()) {
            this.position++;
            return true;
        }
        return false;
    }


    private consume(type: TokenType, message: string): Token {
        if (this.check(type)) {
            return this.tokens[this.position++];
        }
        throw new ParseError(message, this.peek());
    }

    private previous(): Token {
        return this.tokens[this.position - 1];
    }


}

export function evaluate(node: ASTNode, lookup: (name: string) => number | undefined, currentLoc: number): number {
    switch (node.type) {
        case 'Number':
            return (node as NumberNode).value;
        case 'Character':
            return (node as CharacterNode).value;
        case 'CurrentLoc':
            return currentLoc;
        case 'Symbol': {
            const sym = node as SymbolNode;
            const val = lookup(sym.name);
            if (val !== undefined) return val;
            if (sym.name.toUpperCase() === 'PI') return Math.PI;
            throw new ParseError(`Undefined symbol: ${sym.name}`, sym.token);
        }
        case 'FunctionCall': {
            const fn = node as FunctionCallNode;
            const args = fn.args.map(a => evaluate(a, lookup, currentLoc));
            const argCount = args.length;
            switch (fn.name.toUpperCase()) {
                case 'SIN': if (argCount !== 1) throw new ParseError(`Invalid arity for SIN`, fn.token); return Math.sin(args[0]);
                case 'COS': if (argCount !== 1) throw new ParseError(`Invalid arity for COS`, fn.token); return Math.cos(args[0]);
                case 'TAN': if (argCount !== 1) throw new ParseError(`Invalid arity for TAN`, fn.token); return Math.tan(args[0]);
                case 'ASIN': if (argCount !== 1) throw new ParseError(`Invalid arity for ASIN`, fn.token); return Math.asin(args[0]);
                case 'ACOS': if (argCount !== 1) throw new ParseError(`Invalid arity for ACOS`, fn.token); return Math.acos(args[0]);
                case 'ATAN': if (argCount !== 1) throw new ParseError(`Invalid arity for ATAN`, fn.token); return Math.atan(args[0]);
                case 'LOG': if (argCount !== 1) throw new ParseError(`Invalid arity for LOG`, fn.token); return Math.log(args[0]);
                case 'LOG10': if (argCount !== 1) throw new ParseError(`Invalid arity for LOG10`, fn.token); return Math.log10(args[0]);
                case 'EXP': if (argCount !== 1) throw new ParseError(`Invalid arity for EXP`, fn.token); return Math.exp(args[0]);
                case 'SQRT': if (argCount !== 1) throw new ParseError(`Invalid arity for SQRT`, fn.token); return Math.sqrt(args[0]);
                case 'INT': if (argCount !== 1) throw new ParseError(`Invalid arity for INT`, fn.token); return Math.trunc(args[0]);
                case 'ABS': if (argCount !== 1) throw new ParseError(`Invalid arity for ABS`, fn.token); return Math.abs(args[0]);
                case 'SGN': if (argCount !== 1) throw new ParseError(`Invalid arity for SGN`, fn.token); return Math.sign(args[0]);
                case 'POW': if (argCount !== 2) throw new ParseError(`Invalid arity for POW`, fn.token); return Math.pow(args[0], args[1]);
                case 'MAX': if (argCount !== 2) throw new ParseError(`Invalid arity for MAX`, fn.token); return Math.max(args[0], args[1]);
                case 'MIN': if (argCount !== 2) throw new ParseError(`Invalid arity for MIN`, fn.token); return Math.min(args[0], args[1]);
                case RANDOM_FUNCTION.toUpperCase(): if (argCount !== 1) throw new ParseError(`Invalid arity for .RANDOM`, fn.token); return Math.floor(Math.random() * args[0]);
                default: throw new ParseError(`Unknown function: ${fn.name}`, fn.token);
            }
        }
        case 'UnaryOp': {
            const un = node as UnaryOpNode;
            const exprVal = evaluate(un.expr, lookup, currentLoc);
            switch (un.op) {
                case '+': return exprVal;
                case '-': return -exprVal;
                case '~': return (~exprVal) >>> 0;
                case '!': return exprVal === 0 ? -1 : 0;
                default: throw new ParseError(`Unknown unary op: ${un.op}`, un.token);
            }
        }
        case 'BinaryOp': {
            const bin = node as BinaryOpNode;
            const left = evaluate(bin.left, lookup, currentLoc);
            const right = evaluate(bin.right, lookup, currentLoc);
            switch (bin.op) {
                case '+': return left + right;
                case '-': return left - right;
                case '*': return left * right;
                case '/':
                    if (right === 0) throw new ParseError("Division by zero", bin.token);
                    // Integral operands use integer division; floats divide
                    // exactly (asMSX supports floating point).
                    return Number.isInteger(left) && Number.isInteger(right)
                        ? Math.trunc(left / right)
                        : left / right;
                case '%':
                    if (right === 0) throw new ParseError("Modulo by zero", bin.token);
                    return left % right;
                case '&': return (left & right) >>> 0;
                case '|': return (left | right) >>> 0;
                case '^': return (left ^ right) >>> 0;
                case '<<':
                    if (!Number.isInteger(left) || !Number.isInteger(right) || right < 0 || right >= 32) throw new ParseError("Shift count must be an integer in [0, 31]", bin.token);
                    // Shifts share the bitwise ops' unsigned 32-bit domain;
                    // the count gate keeps results finite (no float overflow).
                    return (left << right) >>> 0;
                case '>>':
                    if (!Number.isInteger(left) || !Number.isInteger(right) || right < 0 || right >= 32) throw new ParseError("Shift count must be an integer in [0, 31]", bin.token);
                    return (left >>> 0) >>> right;
                case '==': return left === right ? -1 : 0;
                case '!=': return left !== right ? -1 : 0;
                case '<': return left < right ? -1 : 0;
                case '<=': return left <= right ? -1 : 0;
                case '>': return left > right ? -1 : 0;
                case '>=': return left >= right ? -1 : 0;
                case '&&': return (left !== 0 && right !== 0) ? -1 : 0;
                case '||': return (left !== 0 || right !== 0) ? -1 : 0;
                default: throw new ParseError(`Unknown binary op: ${bin.op}`, bin.token);
            }
        }
        default:
            throw new ParseError(`Unknown AST node type: ${node.type}`, node.token);
    }
}

export function isConstantExpression(node: ASTNode): boolean {
    switch (node.type) {
        case 'Number':
        case 'Character':
            return true;
        case 'CurrentLoc':
        case 'Symbol':
            return false;
        case 'UnaryOp':
            return isConstantExpression((node as UnaryOpNode).expr);
        case 'BinaryOp':
            return isConstantExpression((node as BinaryOpNode).left) && isConstantExpression((node as BinaryOpNode).right);
        case 'FunctionCall': {
            const call = node as FunctionCallNode;
            // .RANDOM(n) evaluates to Math.random(); treating it as constant
            // would let range validators roll the dice on every publish.
            if (call.name.toLowerCase() === RANDOM_FUNCTION) return false;
            return call.args.every(a => isConstantExpression(a));
        }
        default:
            return false;
    }
}

/**
 * Attempts to parse tokens into an AST, returning null if parsing fails.
 * Expression parsing errors are intentionally caught and ignored during
 * AST extraction in analysis passes where syntax errors are diagnosed separately.
 */
export function tryParseExpression(tokens: Token[], dialect: CpuDialect = CpuDialect.EZ80): ASTNode | null {
    try {
        return new ExpressionParser(tokens, dialect).parse();
    } catch {
        // Parse error ignored; caller handles missing AST.
        return null;
    }
}

/**
 * Attempts to parse and evaluate an expression, returning undefined if either fails.
 * Centralizes expression evaluation catch blocks across conditional assembly,
 * equate resolution, and validation passes.
 */
export function tryEvaluateExpression(
    tokens: Token[],
    dialect: CpuDialect = CpuDialect.EZ80,
    symbolValue: (name: string) => number | undefined = () => undefined,
    currentLoc: number = 0
): number | undefined {
    try {
        const ast = new ExpressionParser(tokens, dialect).parse();
        return evaluate(ast, symbolValue, currentLoc);
    } catch {
        // Evaluation failure ignored; caller handles missing value.
        return undefined;
    }
}

