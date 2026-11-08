import { AsmDocument } from "./document";
import { ExpressionParser, evaluate } from "./expressions";
import { BIOS_ROUTINES, BIOS_VARS, CpuDialect } from "./metadata";

export type SymbolKind = 'label' | 'equate' | 'data' | 'macro';

export interface SymbolInfo {
    name: string;
    isLocal: boolean;
    kind: SymbolKind;
    isEquate: boolean;
    value?: number;
    line: number;
    docComment?: string;
}

export interface SymbolError {
    line: number;
    message: string;
}

const DATA_SYMBOL_DIRECTIVES: Record<string, true> = {
    db: true,
    defb: true,
    ascii: true,
    asciz: true,
    byte: true,
    dw: true,
    defw: true,
    dw24: true,
    dw32: true,
    ds: true,
    defs: true,
    dl: true,
    blkb: true,
    blkw: true,
    blkp: true,
    blkl: true,
    rb: true,
    rw: true,
    rl: true,
    rs: true
};

const MACRO_DIRECTIVES: Record<string, true> = {
    macro: true
};

export class SymbolCollector {
    private document: AsmDocument;
    private symbols: Map<string, SymbolInfo> = new Map();
    private errors: SymbolError[] = [];
    private currentGlobalLabel: string = "";

    constructor(document: AsmDocument) {
        this.document = document;
        this.collect();
    }

    private collect() {
        // $ inside an equate refers to the definition line.
        let currentLoc: number;
        let macroDepth = 0;

        for (let i = 0; i < this.document.lines.length; i++) {
            const line = this.document.lines[i];

            // Conditional-assembly activity is computed by AsmDocument at
            // parse time; this collector only reads the explicit flags so
            // its results never depend on call order.
            if (line.isInactive) {
                continue;
            }

            currentLoc = i;

            if (line.mnemonic === 'macro') {
                macroDepth++;
            }
            const isEndMacro = line.mnemonic !== undefined &&
                (this.document.dialect === CpuDialect.EZ80
                    ? line.mnemonic === 'endmacro'
                    : (line.mnemonic === 'endm' || line.mnemonic === 'endmacro'));
            if (isEndMacro && macroDepth > 0) {
                macroDepth--;
            }

            if (this.document.isAsmsx && line.mnemonic === 'bios' && (!line.operands || line.operands.length === 0)) {
                for (const routine of BIOS_ROUTINES) {
                    this.injectBiosSymbol(routine, i);
                }
            } else if (this.document.isAsmsx && line.mnemonic === 'biosvars' && (!line.operands || line.operands.length === 0)) {
                for (const variable of BIOS_VARS) {
                    this.injectBiosSymbol(variable, i);
                }
            }

            if (line.mnemonic === 'macro' && !line.label && line.operands && line.operands[0]?.[0]?.type === 'Identifier') {
                const macroName = line.operands[0][0].value;
                this.symbols.set(macroName, {
                    name: macroName,
                    isLocal: false,
                    kind: 'macro',
                    isEquate: false,
                    line: i,
                    docComment: this.getDocComment(i),
                });
            }
            
            if (line.label) {
                let name = line.label;
                let isLocal = false;

                if (name.startsWith('@') || name.startsWith('.')) {
                    isLocal = true;
                    if (this.currentGlobalLabel) {
                        name = this.currentGlobalLabel + name;
                    } else if (line.label !== '@@' && macroDepth === 0) {
                        this.addError(i, `Local label ${name} defined without a preceding global label`);
                    }
                } else {
                    this.currentGlobalLabel = name;
                }

                if (this.symbols.has(name) && line.label !== '@@') {
                    // collectDiagnostics reports label duplicates with token
                    // anchors; recording them here would double-diagnose.
                } else {
                    let storeName = name;
                    if (line.label === '@@') {
                        storeName = `${name}_${i}`;
                    }

                    let kind: SymbolKind = 'label';
                    let value: number | undefined = undefined;
                    if (line.mnemonic === 'equ') {
                        kind = 'equate';
                        if (line.operands && line.operands.length > 0) {
                            try {
                                const parser = new ExpressionParser(line.operands[0], this.document.dialect);
                                const ast = parser.parse();
                                value = evaluate(ast, sym => this.symbols.get(sym)?.value, currentLoc);
                            } catch (e: unknown) {
                                this.addError(i, `Failed to evaluate equate ${name}: ${e instanceof Error ? e.message : String(e)}`);
                            }
                        }
                    } else if (line.mnemonic && DATA_SYMBOL_DIRECTIVES[line.mnemonic]) {
                        kind = 'data';
                    } else if (line.mnemonic && MACRO_DIRECTIVES[line.mnemonic]) {
                        kind = 'macro';
                    }

                    this.symbols.set(storeName, {
                        name: storeName === name ? name : line.label,
                        isLocal,
                        kind,
                        isEquate: kind === 'equate',
                        value,
                        line: i,
                        docComment: this.getDocComment(i),
                    });
                }
            }
        }
    }

    private getDocComment(lineIndex: number): string | undefined {
        const parts: string[] = [];

        for (let i = lineIndex - 1; i >= 0; i--) {
            const line = this.document.lines[i];
            if (line.label !== undefined || line.mnemonic !== undefined || !line.comment?.startsWith(';! ')) {
                break;
            }
            parts.unshift(line.comment.slice(3));
        }

        const inlineComment = this.document.lines[lineIndex]?.comment;
        if (inlineComment?.startsWith(';! ')) {
            parts.push(inlineComment.slice(3));
        }

        return parts.length > 0 ? parts.join('\n') : undefined;
    }

    private injectBiosSymbol(name: string, line: number) {
        if (this.symbols.has(name)) {
            this.addError(line, `Symbol '${name}' collides with an asMSX BIOS name; the user definition wins`);
            return;
        }
        this.symbols.set(name, { name, isLocal: false, kind: 'equate', isEquate: true, value: undefined, line });
    }

    private addError(line: number, message: string) {
        this.errors.push({ line, message });
    }

    public getSymbols(): SymbolInfo[] {
        return Array.from(this.symbols.values());
    }

    public getErrors(): SymbolError[] {
        return this.errors;
    }
}
