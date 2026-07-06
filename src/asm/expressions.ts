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
export interface SymbolNode extends ASTNode {
    type: 'Symbol';
    name: string;
}
export interface CurrentLocNode extends ASTNode {
    type: 'CurrentLoc';
}

export class ExpressionParser {
    private tokens: Token[];
    private position: number = 0;

    constructor(tokens: Token[]) {
        this.tokens = tokens;
    }

    public parse(): ASTNode {
        const expr = this.parseBitwiseOr();
        if (this.position < this.tokens.length) {
            throw new ParseError(`Unexpected token at end of expression: ${this.peek()?.value}`, this.peek());
        }
        return expr;
    }

    private parseBitwiseOr(): ASTNode {
        let left = this.parseBitwiseXor();
        while (this.match(TokenType.Pipe)) {
            const op = '|';
            const right = this.parseBitwiseXor();
            left = { type: 'BinaryOp', op, left, right } as BinaryOpNode;
        }
        return left;
    }

    private parseBitwiseXor(): ASTNode {
        let left = this.parseBitwiseAnd();
        while (this.match(TokenType.Caret)) {
            const op = '^';
            const right = this.parseBitwiseAnd();
            left = { type: 'BinaryOp', op, left, right } as BinaryOpNode;
        }
        return left;
    }

    private parseBitwiseAnd(): ASTNode {
        let left = this.parseShift();
        while (this.match(TokenType.Ampersand)) {
            const op = '&';
            const right = this.parseShift();
            left = { type: 'BinaryOp', op, left, right } as BinaryOpNode;
        }
        return left;
    }

    private parseShift(): ASTNode {
        let left = this.parseAddSub();
        while (this.match(TokenType.ShiftLeft) || this.match(TokenType.ShiftRight)) {
            const token = this.previous();
            const op = token.type === TokenType.ShiftLeft ? '<<' : '>>';
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
        while (this.match(TokenType.Asterisk) || this.match(TokenType.Slash) || this.match(TokenType.Percent)) {
            const token = this.previous();
            const op = token.type === TokenType.Asterisk ? '*' : (token.type === TokenType.Slash ? '/' : '%');
            const right = this.parseUnary();
            left = { type: 'BinaryOp', op, left, right } as BinaryOpNode;
        }
        return left;
    }

    private parseUnary(): ASTNode {
        if (this.match(TokenType.Plus) || this.match(TokenType.Minus) || this.match(TokenType.Tilde) || this.matchIdent('not')) {
            const token = this.previous();
            let op = token.value;
            if (token.type === TokenType.Identifier && token.value.toLowerCase() === 'not') op = '~';
            const expr = this.parseUnary();
            return { type: 'UnaryOp', op, expr } as UnaryOpNode;
        }
        return this.parsePrimary();
    }

    private parsePrimary(): ASTNode {
        if (this.match(TokenType.Number)) {
            return { type: 'Number', value: this.parseNumberValue(this.previous().value) } as NumberNode;
        }
        if (this.match(TokenType.Dollar)) {
            return { type: 'CurrentLoc' } as CurrentLocNode;
        }
        if (this.match(TokenType.Identifier)) {
            return { type: 'Symbol', name: this.previous().value } as SymbolNode;
        }
        if (this.match(TokenType.Dot)) {
            if (this.match(TokenType.Identifier)) {
                return { type: 'Symbol', name: '.' + this.previous().value } as SymbolNode;
            }
            throw new ParseError(`Unexpected dot in expression`, this.peek());
        }
        if (this.match(TokenType.LParen)) {
            const expr = this.parseBitwiseOr();
            this.consume(TokenType.RParen, "Expected ')' after expression");
            return expr;
        }
        if (this.match(TokenType.LBracket)) {
            const expr = this.parseBitwiseOr();
            this.consume(TokenType.RBracket, "Expected ']' after expression");
            return expr;
        }
        throw new ParseError(`Unexpected token in expression: ${this.peek()?.value}`, this.peek());
    }

    private parseNumberValue(val: string): number {
        val = val.toLowerCase();
        if (val.startsWith('$')) return parseInt(val.substring(1), 16);
        if (val.startsWith('0x')) return parseInt(val.substring(2), 16);
        if (val.startsWith('%')) return parseInt(val.substring(1), 2);
        if (val.endsWith('h')) return parseInt(val.substring(0, val.length - 1), 16);
        if (val.endsWith('b')) return parseInt(val.substring(0, val.length - 1), 2);
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
        case 'CurrentLoc':
            return currentLoc;
        case 'Symbol': {
            const sym = node as SymbolNode;
            const val = lookup(sym.name);
            if (val === undefined) throw new Error(`Undefined symbol: ${sym.name}`);
            return val;
        }
        case 'UnaryOp': {
            const un = node as UnaryOpNode;
            const exprVal = evaluate(un.expr, lookup, currentLoc);
            switch (un.op) {
                case '+': return exprVal;
                case '-': return -exprVal;
                case '~': return ~exprVal;
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
                case '/': return Math.floor(left / right);
                case '%': return left % right;
                case '&': return left & right;
                case '|': return left | right;
                case '^': return left ^ right;
                case '<<': return left << right;
                case '>>': return left >> right;
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
            return true;
        case 'CurrentLoc':
        case 'Symbol':
            return false;
        case 'UnaryOp':
            return isConstantExpression((node as UnaryOpNode).expr);
        case 'BinaryOp':
            return isConstantExpression((node as BinaryOpNode).left) && isConstantExpression((node as BinaryOpNode).right);
        default:
            return false;
    }
}

