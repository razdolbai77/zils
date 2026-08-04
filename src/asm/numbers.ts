// Numeric literal formats shared by the lexer (token validity) and the
// expression parser (value parsing). One ordered table drives both so the
// two layers can never drift: the first matching entry decides validity and
// value extraction alike. Entries marked ez80Only are rejected in asMSX
// mode; the invalid entry pins leading-zero decimals (08, 09) as errors in
// both dialects.
interface NumberFormat {
    // Capture group 1 holds the digit payload passed to parseInt.
    pattern: RegExp;
    // Base of the captured payload, or 'float' to parseFloat the literal.
    radix: number | 'float';
    ez80Only?: boolean;
    invalid?: boolean;
}

const NUMBER_FORMATS: readonly NumberFormat[] = [
    { pattern: /^\$([0-9a-fA-F]+)$/, radix: 16 },
    { pattern: /^#([0-9a-fA-F]+)$/, radix: 16, ez80Only: true },
    { pattern: /^0x([0-9a-fA-F]+)$/i, radix: 16 },
    { pattern: /^([0-9][0-9a-fA-F]*)h$/i, radix: 16 },
    { pattern: /^0[bB]([01]+)$/, radix: 2, ez80Only: true },
    { pattern: /^%([01]+)$/, radix: 2, ez80Only: true },
    { pattern: /^0[bB]$/, radix: 2, invalid: true },
    { pattern: /^([01]+)b$/i, radix: 2 },
    { pattern: /^([0-7]+)[oO]$/, radix: 8 },
    { pattern: /^0([0-7]+)$/, radix: 8 },
    { pattern: /^(0)$/, radix: 10 },
    { pattern: /^0[0-9]+$/, radix: 10, invalid: true },
    { pattern: /^([0-9]+)$/, radix: 10 },
    { pattern: /^([0-9]+\.[0-9]+)$/, radix: 'float' },
    { pattern: /^([0-9]+\.[0-9]+(?:[eE][+-]?[0-9]+))$/, radix: 'float', ez80Only: true },
];

function matchFormat(value: string, isAsmsx: boolean): NumberFormat | undefined {
    for (const format of NUMBER_FORMATS) {
        if (!format.pattern.test(value)) continue;
        // An eZ80-only format claimed by an asMSX source is not a number;
        // no later entry may rescue it.
        if (format.ez80Only && isAsmsx) return undefined;
        return format;
    }
    return undefined;
}

export function isValidNumberLiteral(value: string, isAsmsx: boolean): boolean {
    const format = matchFormat(value, isAsmsx);
    return format !== undefined && !format.invalid;
}

// Called only on tokens the lexer has already validated for the active
// dialect, so dialect gating is not needed here.
export function parseNumberValue(value: string): number {
    const format = matchFormat(value, false);
    if (format !== undefined && !format.invalid) {
        if (format.radix === 'float') return parseFloat(value);
        const payload = format.pattern.exec(value)?.[1];
        if (payload !== undefined) return parseInt(payload, format.radix);
    }
    throw new Error(`Unparseable numeric literal: ${value}`);
}
