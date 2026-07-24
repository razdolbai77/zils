import { Lexer } from './lexer';
import { LineParser, LineNode } from './line-parser';
import { CpuDialect } from './metadata';

export interface Diagnostic {
    line: number;
    message: string;
    startCharacter?: number;
    length?: number;
}

export class AsmDocument {
    public lines: LineNode[] = [];
    public source: string;
    public dialect: CpuDialect;
    public isAsmsx: boolean;
    private diagnostics: Diagnostic[] = [];

    constructor(source: string, dialect: CpuDialect = CpuDialect.EZ80, isAsmsx: boolean = false) {
        this.source = source;
        this.dialect = dialect;
        this.isAsmsx = isAsmsx;
        this.parse();
    }

    private parse() {
        const lineStarts: number[] = [0];
        for (let i = 0; i < this.source.length; i++) {
            if (this.source[i] === '\r') {
                if (this.source[i + 1] === '\n') {
                    i++;
                }
                lineStarts.push(i + 1);
            } else if (this.source[i] === '\n') {
                lineStarts.push(i + 1);
            }
        }

        const lexer = new Lexer(this.source, this.isAsmsx);
        const tokens = lexer.tokenize();
        
        const parser = new LineParser(tokens, this.dialect, this.isAsmsx);
        
        for (let lineNum = 0; lineNum < lineStarts.length; lineNum++) {
            const line = parser.isAtEnd() ? { tokens: [] } as LineNode : parser.parseLine();
            line.start = lineStarts[lineNum];
            this.lines.push(line);
            
            if (line.error) {
                this.diagnostics.push({
                    line: lineNum,
                    message: line.error,
                    startCharacter: line.errorToken ? (line.errorToken.start - line.start) : undefined,
                    length: line.errorToken?.length
                });
            }
        }
    }

    public getDiagnostics(): Diagnostic[] {
        return this.diagnostics;
    }
}
