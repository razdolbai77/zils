import { Lexer, TokenType } from './lexer';
import { LineParser, LineNode } from './line-parser';
import { BIOS_ROUTINES, BIOS_VARS, CpuDialect } from './metadata';
import { ExpressionParser, evaluate } from './expressions';

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

    constructor(source: string, dialect: CpuDialect = CpuDialect.EZ80, isAsmsx: boolean = (dialect === CpuDialect.Z80)) {
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
        
        this.lines = parser.zipPhysicalLines(lineStarts);

        for (let lineNum = 0; lineNum < this.lines.length; lineNum++) {
            const line = this.lines[lineNum];
            if (line.error) {
                this.diagnostics.push({
                    line: lineNum,
                    message: line.error,
                    startCharacter: line.errorToken ? (line.errorToken.start - line.start!) : undefined,
                    length: line.errorToken?.length
                });
            }
        }

        this.computeInactiveLines();
    }

    // Conditional-assembly state (if/ifdef/ifndef/else/endif) is resolved
    // here, at parse time, so every consumer (diagnostics, SymbolCollector)
    // reads the same explicit `isInactive` flags instead of depending on
    // which pass happened to run first. The scan mirrors SymbolCollector's
    // symbol view: equate values feed `if` expressions, defined names feed
    // ifdef/ifndef, and BIOS injections count as defined in asMSX mode.
    private computeInactiveLines() {
        const equateValues = new Map<string, number>();
        const definedNames = new Set<string>();
        const symbolValue = (name: string): number | undefined => equateValues.get(name);
        let currentGlobalLabel = "";
        let ifDepth = 0;
        let inactiveDepth = 0;
        let currentLoc = 0;
        for (let i = 0; i < this.lines.length; i++) {
            const line = this.lines[i];

            if (line.mnemonic === 'if') {
                if (inactiveDepth === 0) {
                    let conditionTrue = false;
                    if (line.operands && line.operands.length > 0) {
                        try {
                            const parser = new ExpressionParser(line.operands[0], this.dialect);
                            conditionTrue = evaluate(parser.parse(), symbolValue, currentLoc) !== 0;
                        } catch {
                            // An unparseable condition assembles nothing.
                        }
                    }
                    ifDepth++;
                    if (!conditionTrue) inactiveDepth = ifDepth;
                } else {
                    ifDepth++;
                }
                continue;
            } else if (line.mnemonic === 'ifdef' || line.mnemonic === 'ifndef') {
                if (inactiveDepth === 0) {
                    let conditionTrue = false;
                    if (line.operands && line.operands.length > 0 && line.operands[0].length > 0) {
                        const hasSym = definedNames.has(line.operands[0][0].value);
                        conditionTrue = line.mnemonic === 'ifdef' ? hasSym : !hasSym;
                    }
                    ifDepth++;
                    if (!conditionTrue) inactiveDepth = ifDepth;
                } else {
                    ifDepth++;
                }
                continue;
            } else if (line.mnemonic === 'else') {
                if (inactiveDepth === 0) {
                    inactiveDepth = ifDepth;
                } else if (inactiveDepth === ifDepth) {
                    inactiveDepth = 0;
                }
                continue;
            } else if (line.mnemonic === 'endif') {
                if (inactiveDepth === ifDepth) {
                    inactiveDepth = 0;
                }
                if (ifDepth > 0) ifDepth--;
                continue;
            }

            if (inactiveDepth > 0) {
                line.isInactive = true;
                continue;
            }

            currentLoc = i;

            if (this.isAsmsx && line.mnemonic === 'bios' && (!line.operands || line.operands.length === 0)) {
                for (const routine of BIOS_ROUTINES) {
                    definedNames.add(routine);
                }
            } else if (this.isAsmsx && line.mnemonic === 'biosvars' && (!line.operands || line.operands.length === 0)) {
                for (const variable of BIOS_VARS) {
                    definedNames.add(variable);
                }
            }

            if (line.mnemonic === 'macro' && !line.label && line.operands && line.operands[0]?.[0]?.type === TokenType.Identifier) {
                definedNames.add(line.operands[0][0].value);
            }

            if (line.label) {
                let name = line.label;
                if (name.startsWith('@') || name.startsWith('.')) {
                    if (currentGlobalLabel) {
                        name = currentGlobalLabel + name;
                    }
                } else {
                    currentGlobalLabel = name;
                }

                if (definedNames.has(name) && line.label !== '@@') {
                    // The first definition wins, matching SymbolCollector.
                } else {
                    const storeName = line.label === '@@' ? `${name}_${i}` : name;
                    if (line.mnemonic === 'equ' && line.operands && line.operands.length > 0) {
                        try {
                            const parser = new ExpressionParser(line.operands[0], this.dialect);
                            equateValues.set(storeName, evaluate(parser.parse(), symbolValue, currentLoc));
                        } catch {
                            // Evaluation failures are reported by SymbolCollector.
                        }
                    }
                    definedNames.add(storeName);
                }
            }
        }
    }

    public getDiagnostics(): Diagnostic[] {
        return this.diagnostics;
    }
}
