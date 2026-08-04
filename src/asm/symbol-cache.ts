import { AsmDocument } from './document';
import { SymbolCollector, SymbolInfo } from './symbols';

// AsmDocument instances are immutable after parsing (every write happens in
// the constructor), so instance identity equals content identity: a symbol
// table computed for a document never goes stale. The WeakMap keys the cache
// on the document itself, so tables vanish together with the document when
// an edit replaces it — no generation bookkeeping needed, and repeat handler
// requests over the same indexed set run one collection pass. Consumers only
// read the returned arrays, so sharing them is safe.
const tables = new WeakMap<AsmDocument, { collector: SymbolCollector; symbols: SymbolInfo[] }>();

function getEntry(document: AsmDocument): { collector: SymbolCollector; symbols: SymbolInfo[] } {
    let entry = tables.get(document);
    if (entry === undefined) {
        const collector = new SymbolCollector(document);
        entry = { collector, symbols: collector.getSymbols() };
        tables.set(document, entry);
    }
    return entry;
}

export function getCachedCollector(document: AsmDocument): SymbolCollector {
    return getEntry(document).collector;
}

export function getSymbolTable(document: AsmDocument): SymbolInfo[] {
    return getEntry(document).symbols;
}
