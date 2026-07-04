import { Lexer } from './lexer';
import { LineParser, LineNode } from './line_parser';
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
        const lineOffsets: number[] = [0];
        for (let i = 0; i < this.source.length; i++) {
            if (this.source[i] === '\n') {
                lineOffsets.push(i + 1);
            }
        }

        const lexer = new Lexer(this.source);
        const tokens = lexer.tokenize();
        
        const parser = new LineParser(tokens, this.dialect, this.isAsmsx);
        
        let lineNum = 0;
        while (!parser.isAtEnd()) {
            const line = parser.parseLine();
            line.start = lineOffsets[lineNum] ?? 0;
            this.lines.push(line);
            
            if (line.error) {
                this.diagnostics.push({
                    line: lineNum,
                    message: line.error,
                    startCharacter: line.errorToken ? (line.errorToken.start - line.start) : undefined,
                    length: line.errorToken?.length
                });
            }
            
            lineNum++;
        }
    }

    public getDiagnostics(): Diagnostic[] {
        return this.diagnostics;
    }
}
