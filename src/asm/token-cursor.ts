import { Token, TokenType } from './lexer';

// Shared token-stream cursor for the line parser and the expression parser:
// both walk a flat token array with the same check/peek/isAtEnd mechanics.
// Consume semantics differ per parser (unterminated-string validation vs
// caller-supplied error messages), so subclasses keep their own consume.
export abstract class TokenCursor {
    protected tokens: Token[];
    protected position: number = 0;

    constructor(tokens: Token[]) {
        this.tokens = tokens;
    }

    public isAtEnd(): boolean {
        return this.position >= this.tokens.length;
    }

    protected peek(offset: number = 0): Token | null {
        if (this.position + offset >= this.tokens.length) return null;
        return this.tokens[this.position + offset];
    }

    protected check(type: TokenType): boolean {
        if (this.isAtEnd()) return false;
        return this.tokens[this.position].type === type;
    }
}
