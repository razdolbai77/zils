import { Lexer, TokenType } from "./lexer";
import { LineParser, LineNode } from "./line-parser";
import { BIOS_ROUTINES, BIOS_VARS, CpuDialect } from "./metadata";
import { tryEvaluateExpression } from "./expressions";

/**
 * Represents a diagnostic issue found during parsing or semantic analysis of an assembly file.
 */
export interface Diagnostic {
    line: number;
    message: string;
    startCharacter?: number;
    length?: number;
}

/**
 * Creates a diagnostic from an error recorded on a line AST node.
 *
 * @param line - The line node containing the error message and optional error token.
 * @param lineNum - The 0-based line number of the line in the document.
 * @returns A Diagnostic object with line coordinates and error message.
 */
export function createLineErrorDiagnostic(line: LineNode, lineNum: number): Diagnostic {
    return {
        line: lineNum,
        message: line.error!,
        startCharacter: line.errorToken ? (line.errorToken.start - (line.start ?? 0)) : undefined,
        length: line.errorToken?.length
    };
}

/**
 * Computes the 0-based character offsets where each line begins in the source text.
 *
 * @param source - The raw source text.
 * @returns An array of character offsets indicating line starting positions.
 */
export function getLineStarts(source: string): number[] {
    const lineStarts: number[] = [0];
    for (let i = 0; i < source.length; i++) {
        if (source[i] === '\r') {
            if (source[i + 1] === '\n') {
                i++;
            }
            lineStarts.push(i + 1);
        } else if (source[i] === '\n') {
            lineStarts.push(i + 1);
        }
    }
    return lineStarts;
}

/**
 * Represents a parsed assembly source document, including its line AST nodes,
 * dialect configuration, and conditional assembly state.
 */
export class AsmDocument {
    public lines: LineNode[] = [];
    public source: string;
    public dialect: CpuDialect;
    public isAsmsx: boolean;

    /**
     * Creates and parses an assembly document.
     *
     * @param source - The assembly source code.
     * @param dialect - The target CPU dialect (Z80 or eZ80).
     * @param isAsmsx - Whether asMSX compatibility mode is enabled.
     */
    constructor(source: string, dialect: CpuDialect = CpuDialect.EZ80, isAsmsx: boolean = (dialect === CpuDialect.Z80)) {
        this.source = source;
        this.dialect = dialect;
        this.isAsmsx = isAsmsx;
        this.parse();
    }

    private parse() {
        const lineStarts = getLineStarts(this.source);

        const lexer = new Lexer(this.source, this.isAsmsx);
        const tokens = lexer.tokenize();
        
        const parser = new LineParser(tokens, this.dialect, this.isAsmsx);
        
        this.lines = parser.zipPhysicalLines(lineStarts);



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
        let currentLoc: number;
        const registerLabel = (line: LineNode, lineIndex: number) => {
            if (!line.label) return;
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
                const storeName = line.label === '@@' ? `${name}_${lineIndex}` : name;
                if (line.mnemonic === 'equ' && line.operands && line.operands.length > 0) {
                    // Safe evaluation: evaluation failures are reported separately by SymbolCollector.
                    const val = tryEvaluateExpression(line.operands[0], this.dialect, symbolValue, currentLoc);
                    if (val !== undefined) {
                        equateValues.set(storeName, val);
                    }
                }
                definedNames.add(storeName);
            }
        };
        for (let i = 0; i < this.lines.length; i++) {
            const line = this.lines[i];
            // $ is the current line's index — an assembler-free approximation
            // of the program counter. Assigning here (before the conditional
            // branches continue) means an `if` condition evaluates $ against
            // its own line, not the previous active line's.
            currentLoc = i;
            const isControlLine = line.mnemonic === 'if' || line.mnemonic === 'ifdef' ||
                line.mnemonic === 'ifndef' || line.mnemonic === 'else' || line.mnemonic === 'endif';
            if (isControlLine) {
                // A label on a control line (`foo: if 1`) is visible to later
                // ifdef checks — control lines are never assembled inactive,
                // and SymbolCollector registers the label, so the scan must
                // too instead of skipping it in the branch `continue`s.
                if (inactiveDepth === 0) {
                    registerLabel(line, i);
                }
            }
            if (line.mnemonic === 'if') {
                if (inactiveDepth === 0) {
                    let conditionTrue = false;
                    if (line.operands && line.operands.length > 0) {
                        // Safe evaluation: an unparseable condition assembles nothing.
                        const condVal = tryEvaluateExpression(line.operands[0], this.dialect, symbolValue, currentLoc);
                        if (condVal !== undefined) {
                            conditionTrue = condVal !== 0;
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

            registerLabel(line, i);
        }
    }

    /**
     * Collects line-level syntax diagnostics recorded during parsing of this document.
     *
     * @returns An array of line error diagnostics.
     */
    public getDiagnostics(): Diagnostic[] {
        const diagnostics: Diagnostic[] = [];
        for (let i = 0; i < this.lines.length; i++) {
            const line = this.lines[i];
            if (line.error) {
                diagnostics.push(createLineErrorDiagnostic(line, i));
            }
        }
        return diagnostics;
    }
}
