import { Token, TokenType, ParseError } from './lexer';

export interface ASTNode {
    type: string;
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

export class ExpressionParser {
    private tokens: Token[];
    private position: number = 0;

    constructor(tokens: Token[]) {
        this.tokens = tokens;
    }

    public parse(): ASTNode {
        const expr = this.parseLogicalOr();
        if (this.position < this.tokens.length) {
            throw new ParseError(`Unexpected token at end of expression: ${this.peek()?.value}`, this.peek());
        }
        return expr;
    }

    private parseLogicalOr(): ASTNode {
        let left = this.parseLogicalAnd();
        while (this.match(TokenType.LogicalOr)) {
            const op = '||';
            const right = this.parseLogicalAnd();
            left = { type: 'BinaryOp', op, left, right } as BinaryOpNode;
        }
        return left;
    }

    private parseLogicalAnd(): ASTNode {
        let left = this.parseBitwiseOr();
        while (this.match(TokenType.LogicalAnd)) {
            const op = '&&';
            const right = this.parseBitwiseOr();
            left = { type: 'BinaryOp', op, left, right } as BinaryOpNode;
        }
        return left;
    }

    private parseBitwiseOr(): ASTNode {
        let left = this.parseBitwiseXor();
        while (this.match(TokenType.Pipe) || this.matchIdent('or')) {
            const op = '|';
            const right = this.parseBitwiseXor();
            left = { type: 'BinaryOp', op, left, right } as BinaryOpNode;
        }
        return left;
    }

    private parseBitwiseXor(): ASTNode {
        let left = this.parseBitwiseAnd();
        while (this.match(TokenType.Caret) || this.matchIdent('xor')) {
            const op = '^';
            const right = this.parseBitwiseAnd();
            left = { type: 'BinaryOp', op, left, right } as BinaryOpNode;
        }
        return left;
    }

    private parseBitwiseAnd(): ASTNode {
        let left = this.parseEquality();
        while (this.match(TokenType.Ampersand) || this.matchIdent('and')) {
            const op = '&';
            const right = this.parseEquality();
            left = { type: 'BinaryOp', op, left, right } as BinaryOpNode;
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
            left = { type: 'BinaryOp', op, left, right } as BinaryOpNode;
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
            left = { type: 'BinaryOp', op, left, right } as BinaryOpNode;
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
            left = { type: 'BinaryOp', op, left, right } as BinaryOpNode;
        }
        return left;
    }

    private parseAddSub(): ASTNode {
        let left = this.parseMulDivMod();
        while (this.match(TokenType.Plus) || this.match(TokenType.Minus)) {
            const token = this.previous();
            const op = token.type === TokenType.Plus ? '+' : '-';
            const right = this.parseMulDivMod();
            left = { type: 'BinaryOp', op, left, right } as BinaryOpNode;
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
            left = { type: 'BinaryOp', op, left, right } as BinaryOpNode;
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
            return { type: 'UnaryOp', op, expr } as UnaryOpNode;
        }
        return this.parsePrimary();
    }

    private parsePrimary(): ASTNode {
        if (this.match(TokenType.String)) {
            const token = this.previous();
            if (token.quote !== "'" || token.invalidEscape || token.value.length !== 1) {
                throw new ParseError('Expected a single-character literal', token);
            }
            return { type: 'Character', value: token.value.charCodeAt(0) } as CharacterNode;
        }

        if (this.match(TokenType.Number)) {
            return { type: 'Number', value: this.parseNumberValue(this.previous().value) } as NumberNode;
        }
        if (this.match(TokenType.Dollar)) {
            return { type: 'CurrentLoc' } as CurrentLocNode;
        }
        if (this.match(TokenType.Identifier)) {
            const name = this.previous().value;
            if (this.match(TokenType.LParen)) {
                const args: ASTNode[] = [];
                if (!this.check(TokenType.RParen)) {
                    do {
                        args.push(this.parseLogicalOr());
                    } while (this.match(TokenType.Comma));
                }
                this.consume(TokenType.RParen, "Expected ')' after function arguments");
                return { type: 'FunctionCall', name, args } as FunctionCallNode;
            }
            return { type: 'Symbol', name } as SymbolNode;
        }
        if (this.match(TokenType.Dot)) {
            if (this.match(TokenType.Identifier)) {
                return { type: 'Symbol', name: '.' + this.previous().value } as SymbolNode;
            }
            throw new ParseError(`Unexpected dot in expression`, this.peek());
        }
        if (this.match(TokenType.LParen)) {
            const expr = this.parseLogicalOr();
            this.consume(TokenType.RParen, "Expected ')' after expression");
            return expr;
        }
        if (this.match(TokenType.LBracket)) {
            const expr = this.parseLogicalOr();
            this.consume(TokenType.RBracket, "Expected ']' after expression");
            return expr;
        }
        throw new ParseError(`Unexpected token in expression: ${this.peek()?.value}`, this.peek());
    }

    private parseNumberValue(val: string): number {
        val = val.toLowerCase();
        if (val.startsWith('$') || val.startsWith('#')) return parseInt(val.substring(1), 16);
        if (val.startsWith('0x')) return parseInt(val.substring(2), 16);
        if (val.startsWith('%')) return parseInt(val.substring(1), 2);
        if (val.startsWith('0b')) return parseInt(val.substring(2), 2);
        if (val.endsWith('h')) return parseInt(val.substring(0, val.length - 1), 16);
        if (val.endsWith('b')) return parseInt(val.substring(0, val.length - 1), 2);
        if (val.endsWith('o')) return parseInt(val.substring(0, val.length - 1), 8);
        if (val.startsWith('0') && val.length > 1 && !val.includes('.')) return parseInt(val, 8);
        if (val.includes('.') || val.includes('e')) return parseFloat(val);
        return parseInt(val, 10);
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

    private check(type: TokenType): boolean {
        if (this.isAtEnd()) return false;
        return this.peek()!.type === type;
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

    private peek(): Token | null {
        if (this.isAtEnd()) return null;
        return this.tokens[this.position];
    }

    private isAtEnd(): boolean {
        return this.position >= this.tokens.length;
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
            if (sym.name.toUpperCase() === 'PI') return Math.PI;
            const val = lookup(sym.name);
            if (val === undefined) throw new Error(`Undefined symbol: ${sym.name}`);
            return val;
        }
        case 'FunctionCall': {
            const fn = node as FunctionCallNode;
            const args = fn.args.map(a => evaluate(a, lookup, currentLoc));
            const argCount = args.length;
            switch (fn.name.toUpperCase()) {
                case 'SIN': if (argCount !== 1) throw new Error(`Invalid arity for SIN`); return Math.sin(args[0]);
                case 'COS': if (argCount !== 1) throw new Error(`Invalid arity for COS`); return Math.cos(args[0]);
                case 'TAN': if (argCount !== 1) throw new Error(`Invalid arity for TAN`); return Math.tan(args[0]);
                case 'ASIN': if (argCount !== 1) throw new Error(`Invalid arity for ASIN`); return Math.asin(args[0]);
                case 'ACOS': if (argCount !== 1) throw new Error(`Invalid arity for ACOS`); return Math.acos(args[0]);
                case 'ATAN': if (argCount !== 1) throw new Error(`Invalid arity for ATAN`); return Math.atan(args[0]);
                case 'LOG': if (argCount !== 1) throw new Error(`Invalid arity for LOG`); return Math.log(args[0]);
                case 'LOG10': if (argCount !== 1) throw new Error(`Invalid arity for LOG10`); return Math.log10(args[0]);
                case 'EXP': if (argCount !== 1) throw new Error(`Invalid arity for EXP`); return Math.exp(args[0]);
                case 'SQRT': if (argCount !== 1) throw new Error(`Invalid arity for SQRT`); return Math.sqrt(args[0]);
                case 'INT': if (argCount !== 1) throw new Error(`Invalid arity for INT`); return Math.trunc(args[0]);
                case 'ABS': if (argCount !== 1) throw new Error(`Invalid arity for ABS`); return Math.abs(args[0]);
                case 'SGN': if (argCount !== 1) throw new Error(`Invalid arity for SGN`); return Math.sign(args[0]);
                case 'POW': if (argCount !== 2) throw new Error(`Invalid arity for POW`); return Math.pow(args[0], args[1]);
                case 'MAX': if (argCount !== 2) throw new Error(`Invalid arity for MAX`); return Math.max(args[0], args[1]);
                case 'MIN': if (argCount !== 2) throw new Error(`Invalid arity for MIN`); return Math.min(args[0], args[1]);
                default: throw new Error(`Unknown function: ${fn.name}`);
            }
        }
        case 'UnaryOp': {
            const un = node as UnaryOpNode;
            const exprVal = evaluate(un.expr, lookup, currentLoc);
            switch (un.op) {
                case '+': return exprVal;
                case '-': return -exprVal;
                case '~': return ~exprVal;
                case '!': return exprVal === 0 ? -1 : 0;
                default: throw new Error(`Unknown unary op: ${un.op}`);
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
                    if (right === 0) throw new Error("Division by zero");
                    return Math.trunc(left / right);
                case '%':
                    if (right === 0) throw new Error("Modulo by zero");
                    return left % right;
                case '&': return left & right;
                case '|': return left | right;
                case '^': return left ^ right;
                case '<<': return left << right;
                case '>>': return left >> right;
                case '==': return left === right ? -1 : 0;
                case '!=': return left !== right ? -1 : 0;
                case '<': return left < right ? -1 : 0;
                case '<=': return left <= right ? -1 : 0;
                case '>': return left > right ? -1 : 0;
                case '>=': return left >= right ? -1 : 0;
                case '&&': return (left !== 0 && right !== 0) ? -1 : 0;
                case '||': return (left !== 0 || right !== 0) ? -1 : 0;
                default: throw new Error(`Unknown binary op: ${bin.op}`);
            }
        }
        default:
            throw new Error(`Unknown AST node type: ${node.type}`);
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
        case 'FunctionCall':
            return (node as FunctionCallNode).args.every(a => isConstantExpression(a));
        default:
            return false;
    }
}

