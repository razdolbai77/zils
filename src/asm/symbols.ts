import { AsmDocument } from './document';
import { ExpressionParser, evaluate } from './expressions';
import { BIOS_ROUTINES, BIOS_VARS } from './metadata';

export type SymbolKind = 'label' | 'equate' | 'data' | 'macro';

export interface SymbolInfo {
    name: string;
    isLocal: boolean;
    kind: SymbolKind;
    isEquate: boolean;
    value?: number;
    line: number;
}

export interface SymbolError {
    line: number;
    message: string;
}

const DATA_SYMBOL_DIRECTIVES: Record<string, true> = {
    db: true,
    defb: true,
    dw: true,
    defw: true,
    ds: true,
    defs: true,
    dl: true,
    defl: true,
    dl24: true,
    ds24: true,
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
        const currentLoc = 0;
        for (let i = 0; i < this.document.lines.length; i++) {
            const line = this.document.lines[i];

            if (line.mnemonic === 'bios' && (!line.operands || line.operands.length === 0)) {
                for (const routine of BIOS_ROUTINES) {
                    this.symbols.set(routine, { name: routine, isLocal: false, kind: 'equate', isEquate: true, value: undefined, line: i });
                }
            } else if (line.mnemonic === 'biosvars' && (!line.operands || line.operands.length === 0)) {
                for (const variable of BIOS_VARS) {
                    this.symbols.set(variable, { name: variable, isLocal: false, kind: 'equate', isEquate: true, value: undefined, line: i });
                }
            }

            if (line.mnemonic === 'macro' && !line.label && line.operands && line.operands[0]?.[0]?.type === 'Identifier') {
                const macroName = line.operands[0][0].value;
                this.symbols.set(macroName, {
                    name: macroName,
                    isLocal: false,
                    kind: 'macro',
                    isEquate: false,
                    line: i
                });
            }
            
            if (line.label) {
                let name = line.label;
                let isLocal = false;

                if (name.startsWith('@') || name.startsWith('.')) {
                    isLocal = true;
                    if (this.currentGlobalLabel) {
                        name = this.currentGlobalLabel + name;
                    } else {
                        this.addError(i, `Local label ${name} defined without a preceding global label`);
                    }
                } else {
                    this.currentGlobalLabel = name;
                }

                if (this.symbols.has(name) && line.label !== '@@') {
                    this.addError(i, `Duplicate symbol definition: ${name}`);
                } else {
                    let storeName = name;
                    if (line.label === '@@') {
                        storeName = `${name}_${i}`;
                    }

                    let kind: SymbolKind = 'label';
                    let value: number | undefined = undefined;
                    if (line.mnemonic === 'equ' || line.mnemonic === 'defl') {
                        kind = 'equate';
                        if (line.operands && line.operands.length > 0) {
                            try {
                                const parser = new ExpressionParser(line.operands[0]);
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
                        line: i
                    });
                }
            }
        }
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
