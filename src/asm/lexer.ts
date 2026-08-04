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
    LessEqual = 'LessEqual',
    GreaterEqual = 'GreaterEqual',
    EqualEqual = 'EqualEqual',
    NotEqual = 'NotEqual',
    LessGreater = 'LessGreater',
    LogicalAnd = 'LogicalAnd',
    LogicalOr = 'LogicalOr',
    Exclamation = 'Exclamation',
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
    rawValue?: string;
    block?: boolean;
}

export class ParseError extends Error {
    constructor(message: string, public token: Token | null | undefined) {
        super(message);
    }
}

export class Lexer {
    private source: string;
    private isAsmsx: boolean;
    private position: number = 0;
    private pendingTokens: Token[] = [];
    constructor(source: string, isAsmsx: boolean = false) {
        this.source = source;
        this.isAsmsx = isAsmsx;
    }

    public tokenize(): Token[] {
        const tokens: Token[] = [];
        while (this.position < this.source.length || this.pendingTokens.length > 0) {
            this.skipWhitespace();
            if (this.position >= this.source.length && this.pendingTokens.length === 0) {
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
        if (this.pendingTokens.length > 0) {
            return this.pendingTokens.shift()!;
        }

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

        if (this.isAsmsx && ((c === '/' && this.source[this.position + 1] === '/') ||
            (c === '-' && this.source[this.position + 1] === '-'))) {
            return this.lexComment();
        }

        if (this.isAsmsx && c === '/' && this.source[this.position + 1] === '*') {
            return this.lexBlockComment(2, '*/');
        }

        if (this.isAsmsx && c === '{') {
            return this.lexBlockComment(1, '}');
        }


        if (c === '"' || c === '\'') {
            return this.lexString();
        }

        if (c === '$' || c === '%' || c === '#' || (c >= '0' && c <= '9')) {
            const numToken = this.lexNumber();
            if (numToken) return numToken;
        }

        const randomMatch = this.isAsmsx ? this.source.substring(this.position).match(/^\.random(?=\s*\()/i) : null;
        if (randomMatch) {
            this.position += randomMatch[0].length;
            return this.createToken(TokenType.Identifier, '.random', start);
        }

        if (c === '<' && this.source[this.position + 1] === '<') {
            this.position += 2;
            return this.createToken(TokenType.ShiftLeft, '<<', start);
        }
        if (c === '>' && this.source[this.position + 1] === '>') {
            this.position += 2;
            return this.createToken(TokenType.ShiftRight, '>>', start);
        }
        if (c === '<' && this.source[this.position + 1] === '=') {
            this.position += 2;
            return this.createToken(TokenType.LessEqual, '<=', start);
        }
        if (c === '>' && this.source[this.position + 1] === '=') {
            this.position += 2;
            return this.createToken(TokenType.GreaterEqual, '>=', start);
        }
        if (c === '=' && this.source[this.position + 1] === '=') {
            this.position += 2;
            return this.createToken(TokenType.EqualEqual, '==', start);
        }
        if (c === '!' && this.source[this.position + 1] === '=') {
            this.position += 2;
            return this.createToken(TokenType.NotEqual, '!=', start);
        }
        if (c === '<' && this.source[this.position + 1] === '>') {
            this.position += 2;
            return this.createToken(TokenType.LessGreater, '<>', start);
        }
        if (c === '&' && this.source[this.position + 1] === '&') {
            this.position += 2;
            return this.createToken(TokenType.LogicalAnd, '&&', start);
        }
        if (c === '|' && this.source[this.position + 1] === '|') {
            this.position += 2;
            return this.createToken(TokenType.LogicalOr, '||', start);
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

    private lexBlockComment(openingLength: number, closingDelimiter: string): Token {
        const tokens = this.lexBlockCommentTokens(openingLength, closingDelimiter);
        for (let i = 1; i < tokens.length; i++) {
            this.pendingTokens.push(tokens[i]);
        }
        return tokens[0];
    }

    private lexBlockCommentTokens(openingLength: number, closingDelimiter: string): Token[] {
        const tokens: Token[] = [];
        let segmentStart = this.position;
        this.position += openingLength;
        while (true) {
            while (this.position < this.source.length &&
                !this.source.startsWith(closingDelimiter, this.position) &&
                this.source[this.position] !== '\n' &&
                this.source[this.position] !== '\r') {
                this.position++;
            }

            if (this.position < this.source.length &&
                this.source.startsWith(closingDelimiter, this.position)) {
                this.position += closingDelimiter.length;
                tokens.push(this.createBlockCommentToken(segmentStart, this.position));
                return tokens;
            }

            if (this.position >= this.source.length) {
                const lastSegment = this.createBlockCommentToken(segmentStart, this.position);
                if (tokens.length === 0) {
                    lastSegment.unterminated = true;
                } else {
                    // Point the diagnostic at the comment's opening line.
                    tokens[0].unterminated = true;
                }
                tokens.push(lastSegment);
                return tokens;
            }

            // Newline inside the comment: close the current segment and emit a
            // Newline token so LineNodes stay aligned with physical lines.
            tokens.push(this.createBlockCommentToken(segmentStart, this.position));
            const newlineStart = this.position;
            if (this.source[this.position] === '\r' && this.source[this.position + 1] === '\n') {
                this.position += 2;
            } else {
                this.position++;
            }
            tokens.push(this.createToken(TokenType.Newline, this.source.substring(newlineStart, this.position), newlineStart));
            segmentStart = this.position;
        }
    }

    private createBlockCommentToken(start: number, end: number): Token {
        const token = this.createToken(TokenType.Comment, this.source.substring(start, end), start);
        token.block = true;
        return token;
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
        const decodeEscapes = quote === "'" || !this.isAsmsx;
        const token = this.createToken(TokenType.String, decodeEscapes ? this.decodeEscapes(rawValue) : rawValue, start);
        token.rawValue = rawValue;
        token.quote = quote;
        if (decodeEscapes && this.hasInvalidEscape(rawValue)) {
            token.invalidEscape = true;
        }
        if (!terminated) {
            token.unterminated = true;
        }
        return token;
    }

    private decodeEscapes(value: string): string {
        return value.replace(/\\([abefnrtv\\'"?])/g, (_, escape: string) => {
            const escapes: Record<string, string> = {
                a: '\x07', b: '\x08', e: '\x1b', f: '\x0c', n: '\n', r: '\r',
                t: '\t', v: '\x0b', '\\': '\\', "'": "'", '"': '"', '?': '?'
            };
            return escapes[escape];
        });
    }

    private hasInvalidEscape(value: string): boolean {
        for (let i = 0; i < value.length; i++) {
            if (value[i] !== '\\') continue;
            if (i + 1 >= value.length || !/[abefnrtv\\'"?]/.test(value[i + 1])) return true;
            i++;
        }
        return false;
    }

    private lexNumber(): Token | null {
        const start = this.position;
        const substr = this.source.substring(this.position);

        // Handle eZ80 prefixed hex and bin explicitly first (they consume invalid suffixes as Unknown)
        const prefixedHexPayload = substr.match(/^#[A-Za-z0-9_]*/)?.[0];
        if (prefixedHexPayload !== undefined && prefixedHexPayload.length > 0) {
            this.position += prefixedHexPayload.length;
            if (!this.isAsmsx && /^#[0-9a-fA-F]+$/.test(prefixedHexPayload)) {
                return this.createToken(TokenType.Number, prefixedHexPayload, start);
            } else {
                // asMSX keeps #payload as Identifier (macro parameters);
                // eZ80 treats malformed # numbers like every other prefix.
                return this.createToken(this.isAsmsx ? TokenType.Identifier : TokenType.Unknown, prefixedHexPayload, start);
            }
        }

        const prefixedBinPayload = substr.match(/^0[bB][A-Za-z0-9]*/)?.[0];
        if (prefixedBinPayload !== undefined && prefixedBinPayload.length > 0) {
            this.position += prefixedBinPayload.length;
            return this.createToken(
                !this.isAsmsx && /^0[bB][01]+$/.test(prefixedBinPayload) ? TokenType.Number : TokenType.Unknown,
                prefixedBinPayload,
                start
            );
        }

        // For $, %, and normal numbers, we want to match the whole prefix + alphanumeric block.
        // But if it's JUST $ or %, we must return null so punctuation can handle it.
        let numMatchStr = "";
        if (substr.startsWith('$')) {
            const m = substr.match(/^\$[a-zA-Z0-9]+/); // must have at least one following char
            if (m) numMatchStr = m[0];
        } else if (substr.startsWith('%')) {
            const m = substr.match(/^%[a-zA-Z0-9]+/); // must have at least one following char
            if (m) numMatchStr = m[0];
        } else {
            const m = substr.match(/^[0-9]+(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?[a-zA-Z0-9_]*/);
            if (m) numMatchStr = m[0];
        }

        if (!numMatchStr) {
            return null;
        }

        this.position += numMatchStr.length;

        let isValid = false;
        if (numMatchStr.match(/^\$[0-9a-fA-F]+$/)) isValid = true;
        else if (!this.isAsmsx && numMatchStr.match(/^%[01]+$/)) isValid = true;
        else if (numMatchStr.match(/^0x[0-9a-fA-F]+$/i)) isValid = true;
        else if (numMatchStr.match(/^[0-9][0-9a-fA-F]*h$/i)) isValid = true;
        else if (numMatchStr.match(/^[01]+b$/i)) isValid = true;
        else if (numMatchStr.match(/^[0-7]+[oO]$/)) isValid = true;
        else if (numMatchStr.match(/^0[0-7]+$/)) isValid = true;
        else if (numMatchStr === "0") isValid = true;
        else if (numMatchStr.match(/^0[0-9]+$/)) isValid = false; // invalid octal
        else if (numMatchStr.match(/^[0-9]+$/)) isValid = true;
        else if (numMatchStr.match(/^[0-9]+\.[0-9]+$/)) isValid = true;
        else if (!this.isAsmsx && numMatchStr.match(/^[0-9]+\.[0-9]+(?:[eE][+-]?[0-9]+)$/)) isValid = true;

        return this.createToken(isValid ? TokenType.Number : TokenType.Unknown, numMatchStr, start);
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
        return [':', ',', '+', '-', '(', ')', '[', ']', '.', '*', '/', '%', '&', '|', '^', '~', '<', '>', '=', '!'].includes(c);
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
            case '!': return TokenType.Exclamation;
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
