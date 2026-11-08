import { Token, TokenType, ParseError } from "./lexer";
import { CpuDialect, getDirectiveMetadata, getInstructionMetadata, isEz80Suffix } from "./metadata";
import { TokenCursor } from "./token-cursor";


export interface LineNode {
    label?: string;
    labelToken?: Token;
    mnemonic?: string;
    mnemonicToken?: Token;
    suffix?: string;
    suffixToken?: Token;
    invalidSuffix?: boolean;
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


export class LineParser extends TokenCursor {
    private dialect: CpuDialect;
    private isAsmsx: boolean;

    constructor(tokens: Token[], dialect: CpuDialect = CpuDialect.EZ80, isAsmsx: boolean = false) {
        super(tokens);
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

        // A block comment (asMSX `/* ... */` or `{ ... }`) can open before any
        // code on this line or continue from an earlier line. Skip its leading
        // segment so code after the closing delimiter still parses.
        if (this.check(TokenType.Comment) && this.peek()?.block) {
            const blockComment = this.consume(TokenType.Comment);
            line.commentToken = blockComment;
            line.comment = blockComment.value;
        }

        try {
            this.parseLabel(line);
            const invalidSuffixError = this.parseMnemonic(line);
            this.parseOperands(line);

            if (this.check(TokenType.Comment)) {
                line.commentToken = this.consume(TokenType.Comment);
                line.comment = line.commentToken.value;
            }

            // Surface suffix errors only after operands are consumed so the
            // recovered line keeps its operand shape for diagnostics.
            if (invalidSuffixError) {
                throw invalidSuffixError;
            }

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

    // Zips parsed lines 1:1 against physical line starts. parseLine consumes
    // exactly one Newline token per call, so the parser can only exhaust
    // early at the trailing empty physical line that follows a final
    // newline; exhausting anywhere else means lexer and line counters
    // disagree and must fail loudly instead of silently filling empty
    // LineNodes (which used to shift every later line's diagnostics).
    public zipPhysicalLines(lineStarts: number[]): LineNode[] {
        const lines: LineNode[] = [];
        for (let lineNum = 0; lineNum < lineStarts.length; lineNum++) {
            let line: LineNode;
            if (this.isAtEnd()) {
                if (lineNum !== lineStarts.length - 1) {
                    throw new Error(`LineParser physical line desync at line ${lineNum} of ${lineStarts.length}: parser output exhausted early`);
                }
                line = { tokens: [], isAsmsx: this.isAsmsx };
            } else {
                line = this.parseLine();
            }
            line.start = lineStarts[lineNum];
            lines.push(line);
        }
        return lines;
    }

    // One label shape covers dotted/undotted x colon/equals: optional dot
    // prefix, identifier, then ':' (plain label) or '=' (equate). A
    // terminator-less identifier before a known directive/instruction is the
    // asMSX colonless label form.
    private parseLabel(line: LineNode): void {
        let numDots = 0;
        while (this.peek(numDots)?.type === TokenType.Dot) {
            numDots++;
        }

        const afterDotsIsIdentifier = this.peek(numDots)?.type === TokenType.Identifier;
        const terminatorType = this.peek(numDots + 1)?.type;
        const terminated = afterDotsIsIdentifier &&
            (terminatorType === TokenType.Colon || terminatorType === TokenType.Equals);

        if (terminated) {
            let prefix = "";
            for (let i = 0; i < numDots; i++) {
                this.consume(TokenType.Dot);
                prefix += ".";
            }
            line.labelToken = this.consume(TokenType.Identifier);
            line.label = prefix + line.labelToken.value;
            if (terminatorType === TokenType.Colon) {
                this.consume(TokenType.Colon);
            } else {
                line.mnemonicToken = this.consume(TokenType.Equals);
                line.mnemonic = 'equ';
                line.isDirective = true;
            }
            return;
        }

        if (numDots === 0 && afterDotsIsIdentifier && terminatorType === TokenType.Identifier) {
            const nextVal = this.peek(1)!.value.toLowerCase();
            const isColonlessDirectiveLabel = this.isDirectiveSupported(nextVal);
            const isColonlessInstructionLabel = this.isAtLineStart() && getInstructionMetadata(nextVal) !== undefined;
            if (isColonlessDirectiveLabel || isColonlessInstructionLabel) {
                if (this.dialect === CpuDialect.EZ80 && !this.isAsmsx) {
                    throw new ParseError("eZ80 labels must end with ':'", this.peek());
                }
                line.labelToken = this.consume(TokenType.Identifier);
                line.label = line.labelToken.value;
            }
        }
    }

    private parseMnemonic(line: LineNode): ParseError | undefined {
        let invalidSuffixError: ParseError | undefined;

        if (line.mnemonic !== undefined || !(this.check(TokenType.Identifier) || this.check(TokenType.Dot))) {
            return invalidSuffixError;
        }

        // Capture before consuming the mnemonic: isAtLineStart() only
        // works while the cursor still sits at the line's first token.
        const atLineStart = this.isAtLineStart();
        // Directives often start with a dot, e.g. .org, .db
        const isDot = this.check(TokenType.Dot);
        if (isDot) {
            this.position++;
        }

        if (this.check(TokenType.Identifier)) {
            const identToken = this.consume(TokenType.Identifier);
            line.mnemonicToken = identToken;
            const mnemonic = identToken.value.toLowerCase();

            // Check for suffix like `ld.lil`
            if (this.check(TokenType.Dot) && this.peek()?.start === identToken.start + identToken.length && this.peek(1)?.type === TokenType.Identifier) {
                this.position++; // consume dot
                const suffixToken = this.consume(TokenType.Identifier);
                const suffix = suffixToken.value.toLowerCase();

                line.mnemonic = mnemonic;
                line.suffix = suffix;
                line.suffixToken = suffixToken;
                if (!isEz80Suffix(suffix, this.dialect)) {
                    line.invalidSuffix = true;
                    invalidSuffixError = new ParseError(`Invalid suffix '${suffix}' for dialect ${this.dialect}`, suffixToken);
                }
            } else {
                line.mnemonic = mnemonic;
            }

            const isKnownDirective = this.isDirectiveSupported(line.mnemonic!);
            const isKnownDottedDirective = isDot && this.isDirectiveSupported(line.mnemonic!);
            const isAsmsxReserveLongDirective = this.isAsmsx && line.mnemonic === 'rl' && line.label !== undefined;
            if (!isDot && this.dialect === CpuDialect.EZ80 && atLineStart && isKnownDirective && !getDirectiveMetadata(line.mnemonic!)?.allowedColumn0) {
                throw new ParseError(`Undotted directive '${line.mnemonic}' must have leading whitespace in eZ80 mode`, identToken);
            }
            if (isKnownDottedDirective || (!isDot && isKnownDirective && (!this.isAsmsx || line.mnemonic !== 'rl' || isAsmsxReserveLongDirective))) {
                line.isDirective = true;
            }
            // .zilog switches only bracket/paren indirection roles
            // (manual 2.5); diagnostics tracks that per-line state.
            // Parse mode must not change: flipping would reclassify
            // labels, rl, and macros in eZ80 files.
        } else if (isDot) {
            throw new ParseError("Unexpected dot", this.peek());
        }

        return invalidSuffixError;
    }

    private parseOperands(line: LineNode): void {
        if (!line.mnemonic) {
            return;
        }

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
        // A trailing comma yields an empty final operand so that
        // "ld a," and "ld ,b" present the same arity shape to
        // downstream validation.
        if (currentOperand.length > 0 || line.operands.length > 0) {
            line.operands.push(currentOperand);
        }
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
}
