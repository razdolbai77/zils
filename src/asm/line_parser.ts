import { Token, TokenType, ParseError } from './lexer';
import { CpuDialect, isEz80Suffix } from './metadata';

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
}

const COMMON_DIRECTIVES = new Set([
    'equ', 'db', 'defb', 'dw', 'defw', 'ds', 'defs', 'org', 'include', 'macro', 'endm'
]);

const EZ80_DIRECTIVES = new Set([
    ...COMMON_DIRECTIVES,
    'assume', 'dl', 'defl', 'align', 'maclib', 'incbin', 'dl24', 'ds24'
]);

const ASMSX_DIRECTIVES = new Set([
    ...COMMON_DIRECTIVES,
    'megas', 'bios', 'fpos', 'rb', 'rw', 'rl', 'rs', 'insert', 'phase', 'dephase'
]);

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

    private getDirectives(): Set<string> {
        if (this.isAsmsx) return ASMSX_DIRECTIVES;
        return EZ80_DIRECTIVES;
    }

    public parseLine(): LineNode {
        const line: LineNode = { tokens: [] };

        if (this.isAtEnd()) {
            return line;
        }

        const startPosition = this.position;

        try {
            if (this.check(TokenType.Dot) && this.peek(1)?.type === TokenType.Identifier && this.peek(2)?.type === TokenType.Colon) {
                this.consume(TokenType.Dot);
                line.labelToken = this.consume(TokenType.Identifier);
                line.label = "." + line.labelToken.value;
                this.consume(TokenType.Colon);
            } else if (this.check(TokenType.Identifier) && this.peek(1)?.type === TokenType.Colon) {
                line.labelToken = this.consume(TokenType.Identifier);
                line.label = line.labelToken.value;
                this.consume(TokenType.Colon);
            } else if (this.check(TokenType.Identifier) && this.peek(1)?.type === TokenType.Identifier) {
                const nextVal = this.peek(1)!.value.toLowerCase();
                if (this.getDirectives().has(nextVal)) {
                    line.labelToken = this.consume(TokenType.Identifier);
                    line.label = line.labelToken.value;
                }
            } 
            // Some assemblers support labels without colons if they are at the start of the line, but we'll strictly require colons or rely on heuristics if needed.
            // For this task, let's assume `Label:` is standard.

            // Next could be mnemonic or directive
            if (this.check(TokenType.Identifier) || this.check(TokenType.Dot)) {
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

                    // Is it a directive?
                    if (this.getDirectives().has(line.mnemonic!) || isDot) {
                        line.isDirective = true;
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

    private consume(type: TokenType): Token {
        if (this.check(type)) {
            return this.tokens[this.position++];
        }
        throw new ParseError(`Expected token ${type}, got ${this.peek()?.type}`, this.peek());
    }

    private consumeAny(): Token {
        return this.tokens[this.position++];
    }

    public isAtEnd(): boolean {
        return this.position >= this.tokens.length;
    }
}
