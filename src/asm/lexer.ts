export enum TokenType {
    Identifier = 'Identifier',
    Number = 'Number',
    String = 'String',
    Comment = 'Comment',
    Colon = 'Colon',
    Comma = 'Comma',
    Plus = 'Plus',
    Minus = 'Minus',
    LParen = 'LParen',
    RParen = 'RParen',
    LBracket = 'LBracket',
    RBracket = 'RBracket',
    Dot = 'Dot',
    Asterisk = 'Asterisk',
    Slash = 'Slash',
    Percent = 'Percent',
    Ampersand = 'Ampersand',
    Pipe = 'Pipe',
    Caret = 'Caret',
    Tilde = 'Tilde',
    ShiftLeft = 'ShiftLeft',
    ShiftRight = 'ShiftRight',
    Less = 'Less',
    Greater = 'Greater',
    Dollar = 'Dollar',
    Equals = 'Equals',
    Newline = 'Newline',
    Unknown = 'Unknown'
}

export interface Token {
    type: TokenType;
    value: string;
    start: number;
    length: number;
    unterminated?: boolean;
    quote?: "'" | '"';
    invalidEscape?: boolean;
}

export class ParseError extends Error {
    constructor(message: string, public token: Token | null | undefined) {
        super(message);
    }
}

export class Lexer {
    private source: string;
    private position: number = 0;

    constructor(source: string) {
        this.source = source;
    }

    public tokenize(): Token[] {
        const tokens: Token[] = [];
        while (this.position < this.source.length) {
            this.skipWhitespace();
            if (this.position >= this.source.length) {
                break;
            }

            const token = this.nextToken();
            if (token) {
                tokens.push(token);
            } else {
                // Should not happen as nextToken catches Unknown
                break;
            }
        }
        return tokens;
    }

    private skipWhitespace(): void {
        while (this.position < this.source.length) {
            const c = this.source[this.position];
            if (c === ' ' || c === '\t') {
                this.position++;
            } else {
                break;
            }
        }
    }

    private nextToken(): Token | null {
        if (this.position >= this.source.length) {
            return null;
        }

        const c = this.source[this.position];
        const start = this.position;

        if (c === '\n' || c === '\r') {
            if (c === '\r' && this.source[this.position + 1] === '\n') {
                this.position += 2;
            } else {
                this.position++;
            }
            return this.createToken(TokenType.Newline, this.source.substring(start, this.position), start);
        }

        if (c === ';') {
            return this.lexComment();
        }

        if (c === '"' || c === '\'') {
            // Need to make sure it's not af'
            if (c === '\'' && start >= 2) {
                const prev2 = this.source.substring(start - 2, start).toLowerCase();
                if (prev2 === 'af' && !this.isIdentChar(this.source[start + 1] || ' ')) {
                    // This is af', it should have been consumed as part of identifier.
                    // But if we are here, it means it wasn't. Wait, our identifier lexer handles af'.
                }
            }
            return this.lexString();
        }

        if (c === '$' || c === '%' || (c >= '0' && c <= '9')) {
            const numToken = this.lexNumber();
            if (numToken) return numToken;
        }

        if (c === '<' && this.source[this.position + 1] === '<') {
            this.position += 2;
            return this.createToken(TokenType.ShiftLeft, '<<', start);
        }

        if (c === '>' && this.source[this.position + 1] === '>') {
            this.position += 2;
            return this.createToken(TokenType.ShiftRight, '>>', start);
        }

        if (this.isPunctuation(c)) {
            this.position++;
            return this.createToken(this.getPunctuationType(c), c, start);
        }

        if (c === '$') {
            this.position++;
            return this.createToken(TokenType.Dollar, '$', start);
        }

        if (this.isIdentStart(c)) {
            return this.lexIdentifier();
        }

        // Fallback
        this.position++;
        return this.createToken(TokenType.Unknown, c, start);
    }

    private lexComment(): Token {
        const start = this.position;
        while (this.position < this.source.length && this.source[this.position] !== '\n' && this.source[this.position] !== '\r') {
            this.position++;
        }
        return this.createToken(TokenType.Comment, this.source.substring(start, this.position), start);
    }

    private lexString(): Token {
        const start = this.position;
        const quote = this.source[this.position] as "'" | '"';
        let terminated = false;
        this.position++;
        while (this.position < this.source.length && this.source[this.position] !== '\n' && this.source[this.position] !== '\r') {
            if (this.source[this.position] === '\\' &&
                this.position + 1 < this.source.length &&
                this.source[this.position + 1] !== '\n' &&
                this.source[this.position + 1] !== '\r') {
                this.position += 2;
            } else if (this.source[this.position] === quote) {
                this.position++;
                terminated = true;
                break;
            } else {
                this.position++;
            }
        }
        const rawValue = this.source.substring(start + 1, terminated ? this.position - 1 : this.position);
        const token = this.createToken(TokenType.String, quote === "'" ? this.decodeCharacterLiteral(rawValue) : rawValue, start);
        token.quote = quote;
        if (quote === "'" && this.hasInvalidCharacterEscape(rawValue)) {
            token.invalidEscape = true;
        }
        if (!terminated) {
            token.unterminated = true;
        }
        return token;
    }

    private decodeCharacterLiteral(value: string): string {
        return value.replace(/\\([abefnrtv\\'"?])/g, (_, escape: string) => {
            const escapes: Record<string, string> = {
                a: '\x07', b: '\x08', e: '\x1b', f: '\x0c', n: '\n', r: '\r',
                t: '\t', v: '\x0b', '\\': '\\', "'": "'", '"': '"', '?': '?'
            };
            return escapes[escape];
        });
    }

    private hasInvalidCharacterEscape(value: string): boolean {
        for (let i = 0; i < value.length; i++) {
            if (value[i] !== '\\') continue;
            if (i + 1 >= value.length || !/[abefnrtv\\'"?]/.test(value[i + 1])) return true;
            i++;
        }
        return false;
    }

    private lexNumber(): Token | null {
        const start = this.position;
        
        let matchLen = 0;
        const substr = this.source.substring(this.position);

        // $Hex
        const hexMatch = substr.match(/^\$[0-9a-fA-F]+/);
        if (hexMatch) matchLen = hexMatch[0].length;
        
        // 0xHex
        const hex0xMatch = substr.match(/^0x[0-9a-fA-F]+/i);
        if (hex0xMatch && hex0xMatch[0].length > matchLen) matchLen = hex0xMatch[0].length;

        // %Bin
        const binMatch = substr.match(/^%[01]+/);
        if (binMatch && binMatch[0].length > matchLen) matchLen = binMatch[0].length;

        // HexH
        const hexHMatch = substr.match(/^[0-9][0-9a-fA-F]*h/i);
        if (hexHMatch && hexHMatch[0].length > matchLen) matchLen = hexHMatch[0].length;

        // BinB
        const binBMatch = substr.match(/^[01]+b/i);
        if (binBMatch && binBMatch[0].length > matchLen) matchLen = binBMatch[0].length;

        // Dec
        const decMatch = substr.match(/^[0-9]+/);
        if (decMatch && decMatch[0].length > matchLen) matchLen = decMatch[0].length;

        if (matchLen > 0) {
            this.position += matchLen;
            return this.createToken(TokenType.Number, this.source.substring(start, this.position), start);
        }

        return null;
    }

    private lexIdentifier(): Token {
        const start = this.position;
        while (this.position < this.source.length && this.isIdentChar(this.source[this.position])) {
            this.position++;
        }
        
        // Special case for af'
        if (this.source.substring(start, this.position).toLowerCase() === 'af' && this.source[this.position] === '\'') {
            this.position++;
        }

        return this.createToken(TokenType.Identifier, this.source.substring(start, this.position), start);
    }

    private isIdentStart(c: string): boolean {
        return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || c === '_' || c === '@';
    }

    private isIdentChar(c: string): boolean {
        return this.isIdentStart(c) || (c >= '0' && c <= '9');
    }

    private isPunctuation(c: string): boolean {
        return [':', ',', '+', '-', '(', ')', '[', ']', '.', '*', '/', '%', '&', '|', '^', '~', '<', '>', '='].includes(c);
    }

    private getPunctuationType(c: string): TokenType {
        switch (c) {
            case ':': return TokenType.Colon;
            case ',': return TokenType.Comma;
            case '+': return TokenType.Plus;
            case '-': return TokenType.Minus;
            case '(': return TokenType.LParen;
            case ')': return TokenType.RParen;
            case '[': return TokenType.LBracket;
            case ']': return TokenType.RBracket;
            case '.': return TokenType.Dot;
            case '*': return TokenType.Asterisk;
            case '/': return TokenType.Slash;
            case '%': return TokenType.Percent;
            case '&': return TokenType.Ampersand;
            case '|': return TokenType.Pipe;
            case '^': return TokenType.Caret;
            case '~': return TokenType.Tilde;
            case '<': return TokenType.Less;
            case '>': return TokenType.Greater;
            case '=': return TokenType.Equals;
            default: return TokenType.Unknown;
        }
    }

    private createToken(type: TokenType, value: string, start: number): Token {
        return {
            type,
            value,
            start,
            length: this.position - start
        };
    }
}
