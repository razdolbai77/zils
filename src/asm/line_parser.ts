import { Token, TokenType } from './lexer';
import { CpuDialect, isEz80Suffix } from './metadata';

export interface LineNode {
    label?: string;
    mnemonic?: string;
    suffix?: string;
    operands?: Token[][];
    comment?: string;
    isDirective?: boolean;
    error?: string;
}

const DIRECTIVES = new Set([
    'equ', 'db', 'defb', 'dw', 'defw', 'ds', 'defs', 'org', 'assume', 'include', 'macro', 'endm', 'dl', 'defl'
]);

export class LineParser {
    private tokens: Token[];
    private dialect: CpuDialect;
    private position: number = 0;

    constructor(tokens: Token[], dialect: CpuDialect = CpuDialect.Z80) {
        this.tokens = tokens;
        this.dialect = dialect;
    }

    public parseLine(): LineNode {
        const line: LineNode = {};

        // Skip leading newlines if any
        while (this.check(TokenType.Newline)) {
            this.position++;
        }

        if (this.isAtEnd()) {
            return line;
        }

        try {
            // Check for label
            // Actually, we can just look for Identifier followed by Colon
            if (this.check(TokenType.Identifier) && this.peek(1)?.type === TokenType.Colon) {
                line.label = this.consume(TokenType.Identifier).value;
                this.consume(TokenType.Colon);
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
                        } else {
                            throw new Error(`Invalid suffix '${suffix}' for dialect ${this.dialect}`);
                        }
                    } else {
                        line.mnemonic = mnemonic;
                    }

                    // Is it a directive?
                    if (DIRECTIVES.has(line.mnemonic!) || isDot) {
                        line.isDirective = true;
                    }
                } else if (isDot) {
                    throw new Error("Unexpected dot");
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
                line.comment = this.consume(TokenType.Comment).value;
            }

            // End of line
            if (this.check(TokenType.Newline)) {
                this.position++;
            } else if (!this.isAtEnd()) {
                throw new Error(`Unexpected token at end of line: ${this.peek()?.value}`);
            }

        } catch (e: unknown) {
            line.error = e instanceof Error ? e.message : String(e);
            // Recover by consuming rest of line
            while (!this.isAtEnd() && !this.check(TokenType.Newline)) {
                this.position++;
            }
            if (this.check(TokenType.Newline)) {
                this.position++;
            }
        }

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
        throw new Error(`Expected token ${type}, got ${this.peek()?.type}`);
    }

    private consumeAny(): Token {
        return this.tokens[this.position++];
    }

    private isAtEnd(): boolean {
        return this.position >= this.tokens.length;
    }
}
