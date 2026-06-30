import { AsmDocument } from './document';
import { ExpressionParser, evaluate } from './expressions';

export interface SymbolInfo {
    name: string;
    isLocal: boolean;
    isEquate: boolean;
    value?: number;
    line: number;
}

export interface SymbolError {
    line: number;
    message: string;
}

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
        const currentLoc = 0; // Simple assumed location counter for evaluation if needed
        for (let i = 0; i < this.document.lines.length; i++) {
            const line = this.document.lines[i];
            
            if (line.label) {
                let name = line.label;
                let isLocal = false;

                if (name.startsWith('@')) {
                    isLocal = true;
                    if (this.currentGlobalLabel) {
                        name = this.currentGlobalLabel + name;
                    } else {
                        this.addError(i, `Local label ${name} defined without a preceding global label`);
                    }
                } else {
                    this.currentGlobalLabel = name;
                }

                if (this.symbols.has(name)) {
                    this.addError(i, `Duplicate symbol definition: ${name}`);
                } else {
                    let isEquate = false;
                    let value: number | undefined = undefined;

                    if (line.mnemonic && (line.mnemonic === 'equ' || line.mnemonic === 'defl') && line.operands && line.operands.length > 0) {
                        isEquate = true;
                        try {
                            const parser = new ExpressionParser(line.operands[0]);
                            const ast = parser.parse();
                            value = evaluate(ast, sym => this.symbols.get(sym)?.value, currentLoc);
                        } catch (e: unknown) {
                            this.addError(i, `Failed to evaluate equate ${name}: ${e instanceof Error ? e.message : String(e)}`);
                        }
                    }

                    this.symbols.set(name, {
                        name,
                        isLocal,
                        isEquate,
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
