import { Lexer } from './lexer';
import { LineParser, LineNode } from './line_parser';
import { CpuDialect } from './metadata';

export interface Diagnostic {
    line: number;
    message: string;
}

export class AsmDocument {
    public readonly lines: LineNode[] = [];
    private diagnostics: Diagnostic[] = [];

    constructor(public readonly source: string, public readonly dialect: CpuDialect = CpuDialect.Z80) {
        this.parse();
    }

    private parse() {
        const lexer = new Lexer(this.source);
        const tokens = lexer.tokenize();
        
        const parser = new LineParser(tokens, this.dialect);
        
        let lineNum = 0;
        while (!parser.isAtEnd()) {
            const line = parser.parseLine();
            this.lines.push(line);
            
            if (line.error) {
                this.diagnostics.push({
                    line: lineNum,
                    message: line.error
                });
            }
            
            lineNum++;
        }
    }

    public getDiagnostics(): Diagnostic[] {
        return this.diagnostics;
    }
}
