import { Token, TokenType, ParseError } from './lexer';
import { CpuDialect, getDirectiveMetadata, getInstructionMetadata, isEz80Suffix } from './metadata';

export interface LineNode {
    label?: string;
    labelToken?: Token;
    mnemonic?: string;
    mnemonicToken?: Token;
    suffix?: string;
    suffixToken?: Token;
    operands?: Token[][];
    comment?: string;
    commentToken?: Token;
    isDirective?: boolean;
    error?: string;
    errorToken?: Token;
    tokens: Token[];
    start?: number; // Absolute file offset of the start of the line (including whitespace)
    isInactive?: boolean;
    isAsmsx?: boolean;
}


export class LineParser {
    private tokens: Token[];
    private dialect: CpuDialect;
    private isAsmsx: boolean;
    private position: number = 0;

    constructor(tokens: Token[], dialect: CpuDialect = CpuDialect.EZ80, isAsmsx: boolean = false) {
        this.tokens = tokens;
        this.dialect = dialect;
        this.isAsmsx = isAsmsx;
    }

    private isDirectiveSupported(name: string): boolean {
        return getDirectiveMetadata(name)?.supportedDialects.includes(this.dialect) ?? false;
    }

    private isAtLineStart(): boolean {
        if (this.position === 0) {
            return (this.peek()?.start ?? 0) === 0;
        }

        const previousToken = this.tokens[this.position - 1];
        if (previousToken.type !== TokenType.Newline) {
            return false;
        }

        return (this.peek()?.start ?? 0) === previousToken.start + previousToken.length;
    }


    public parseLine(): LineNode {
        const line: LineNode = { tokens: [], isAsmsx: this.isAsmsx };

        if (this.isAtEnd()) {
            return line;
        }

        const startPosition = this.position;

        try {
            let numDots = 0;
            while (this.peek(numDots)?.type === TokenType.Dot) {
                numDots++;
            }

            if (numDots > 0 && this.peek(numDots)?.type === TokenType.Identifier && this.peek(numDots + 1)?.type === TokenType.Colon) {
                let dots = "";
                for (let i = 0; i < numDots; i++) {
                    this.consume(TokenType.Dot);
                    dots += ".";
                }
                line.labelToken = this.consume(TokenType.Identifier);
                line.label = dots + line.labelToken.value;
                this.consume(TokenType.Colon);
            } else if (numDots > 0 && this.peek(numDots)?.type === TokenType.Identifier && this.peek(numDots + 1)?.type === TokenType.Equals) {
                let dots = "";
                for (let i = 0; i < numDots; i++) {
                    this.consume(TokenType.Dot);
                    dots += ".";
                }
                line.labelToken = this.consume(TokenType.Identifier);
                line.label = dots + line.labelToken.value;
                line.mnemonicToken = this.consume(TokenType.Equals);
                line.mnemonic = 'equ';
                line.isDirective = true;
            } else if (numDots === 0 && this.check(TokenType.Identifier) && this.peek(1)?.type === TokenType.Colon) {
                line.labelToken = this.consume(TokenType.Identifier);
                line.label = line.labelToken.value;
                this.consume(TokenType.Colon);
            } else if (numDots === 0 && this.check(TokenType.Identifier) && this.peek(1)?.type === TokenType.Equals) {
                line.labelToken = this.consume(TokenType.Identifier);
                line.label = line.labelToken.value;
                line.mnemonicToken = this.consume(TokenType.Equals);
                line.mnemonic = 'equ';
                line.isDirective = true;
            } else if (numDots === 0 && this.check(TokenType.Identifier) && this.peek(1)?.type === TokenType.Identifier) {
                const nextVal = this.peek(1)!.value.toLowerCase();
                const isColonlessDirectiveLabel = this.isDirectiveSupported(nextVal);
                const isColonlessInstructionLabel = this.isAtLineStart() && getInstructionMetadata(nextVal) !== undefined;
                if (isColonlessDirectiveLabel || isColonlessInstructionLabel) {
                    line.labelToken = this.consume(TokenType.Identifier);
                    line.label = line.labelToken.value;
                }
            } 
            // Some assemblers support labels without colons if they are at the start of the line, but we'll strictly require colons or rely on heuristics if needed.
            // For this task, let's assume `Label:` is standard.

            // Next could be mnemonic or directive
            if (line.mnemonic === undefined && (this.check(TokenType.Identifier) || this.check(TokenType.Dot))) {
                let isDot = false;
                if (this.check(TokenType.Dot)) {
                    isDot = true;
                    this.position++;
                }

                if (this.check(TokenType.Identifier)) {
                    const identToken = this.consume(TokenType.Identifier);
                    line.mnemonicToken = identToken;
                    const mnemonic = identToken.value.toLowerCase();
                    
                    if (isDot) {
                        // Directives often start with dot, e.g. .org, .db
                        // Just keep it as mnemonic
                    }

                    // Check for suffix like `ld.lil`
                    if (this.check(TokenType.Dot) && this.peek(1)?.type === TokenType.Identifier) {
                        this.position++; // consume dot
                        const suffixToken = this.consume(TokenType.Identifier);
                        const suffix = suffixToken.value.toLowerCase();
                        
                        if (isEz80Suffix(suffix, this.dialect)) {
                            line.mnemonic = mnemonic;
                            line.suffix = suffix;
                            line.suffixToken = suffixToken;
                        } else {
                            throw new ParseError(`Invalid suffix '${suffix}' for dialect ${this.dialect}`, suffixToken);
                        }
                    } else {
                        line.mnemonic = mnemonic;
                    }

                    const isKnownDirective = this.isDirectiveSupported(line.mnemonic!);
                    const isKnownDottedDirective = isDot && this.isDirectiveSupported(line.mnemonic!);
                    const isAsmsxReserveLongDirective = this.isAsmsx && line.mnemonic === 'rl' && line.label !== undefined;
                    if (!isDot && this.dialect === CpuDialect.EZ80 && identToken.start === 0 && isKnownDirective) {
                        throw new ParseError(`Undotted directive '${line.mnemonic}' must have leading whitespace in eZ80 mode`, identToken);
                    }
                    if (isKnownDottedDirective || (!isDot && isKnownDirective && (!this.isAsmsx || line.mnemonic !== 'rl' || isAsmsxReserveLongDirective))) {
                        line.isDirective = true;
                    }
                    if (line.mnemonic === 'zilog') {
                        this.isAsmsx = true;
                    }
                } else if (isDot) {
                    throw new ParseError("Unexpected dot", this.peek());
                }
            }

            // Operands
            if (line.mnemonic) {
                line.operands = [];
                let currentOperand: Token[] = [];
                
                while (!this.isAtEnd() && !this.check(TokenType.Comment) && !this.check(TokenType.Newline)) {
                    if (this.check(TokenType.Comma)) {
                        this.position++;
                        line.operands.push(currentOperand);
                        currentOperand = [];
                    } else {
                        currentOperand.push(this.consumeAny());
                    }
                }
                if (currentOperand.length > 0) {
                    line.operands.push(currentOperand);
                }
            }

            // Comment
            if (this.check(TokenType.Comment)) {
                line.commentToken = this.consume(TokenType.Comment);
                line.comment = line.commentToken.value;
            }

            // End of line
            if (this.check(TokenType.Newline)) {
                this.position++;
            } else if (!this.isAtEnd()) {
                throw new ParseError(`Unexpected token at end of line: ${this.peek()?.value}`, this.peek());
            }

        } catch (e: unknown) {
            line.error = e instanceof Error ? e.message : String(e);
            if (e instanceof ParseError && e.token) {
                line.errorToken = e.token;
            }
            // Recover by consuming rest of line
            while (!this.isAtEnd() && !this.check(TokenType.Newline)) {
                this.position++;
            }
            if (this.check(TokenType.Newline)) {
                this.position++;
            }
        }

        line.tokens = this.tokens.slice(startPosition, this.position);
        return line;
    }

    private check(type: TokenType): boolean {
        if (this.isAtEnd()) return false;
        return this.tokens[this.position].type === type;
    }

    private peek(offset: number = 0): Token | null {
        if (this.position + offset >= this.tokens.length) return null;
        return this.tokens[this.position + offset];
    }

    private throwIfUnterminatedString(token: Token): void {
        if (token.type === TokenType.String && token.unterminated) {
            throw new ParseError("Unterminated string literal", token);
        }
    }


    private consume(type: TokenType): Token {
        if (this.check(type)) {
            const token = this.tokens[this.position++];
            this.throwIfUnterminatedString(token);
            return token;
        }
        throw new ParseError(`Expected token ${type}, got ${this.peek()?.type}`, this.peek());
    }

    private consumeAny(): Token {
        const token = this.tokens[this.position++];
        this.throwIfUnterminatedString(token);
        return token;
    }

    public isAtEnd(): boolean {
        return this.position >= this.tokens.length;
    }
}
