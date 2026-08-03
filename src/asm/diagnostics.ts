import { IndexedWorkspace } from "./workspace";
import { Diagnostic, AsmDocument } from "./document";
import { getInstructionMetadata, getDirectiveMetadata, isRegister, isConditionCode, CpuDialect, CpuTarget, MAX_ADDR_Z80, MAX_ADDR_EZ80 } from "./metadata";
import { ExpressionParser, ASTNode, SymbolNode, UnaryOpNode, BinaryOpNode, isConstantExpression, evaluate } from "./expressions";
import { Token, TokenType, ParseError } from "./lexer";
import { LineNode } from "./line-parser";

function validateConstantExpression(
    tokens: Token[],
    lineIndex: number,
    lineStart: number,
    dialect: CpuDialect,
    validateFn: (val: number) => string | null
): Diagnostic[] {
    const diagnostics: Diagnostic[] = [];
    if (tokens.length === 0) return diagnostics;
    try {
        const parser = new ExpressionParser(tokens, dialect);
        const ast = parser.parse();
        if (isConstantExpression(ast)) {
            const val = evaluate(ast, () => undefined, 0);
            const error = validateFn(val);
            if (error) {
                diagnostics.push({
                    line: lineIndex,
                    message: error,
                    startCharacter: tokens[0].start - lineStart,
                    length: tokens[tokens.length - 1].start + tokens[tokens.length - 1].length - tokens[0].start
                });
            }
        }
    } catch {
        // ignore parse errors
    }
    return diagnostics;
}

export interface ValidationResult {
    error: string | null;
    errorIndex?: number;
    sigOps: string[] | null;
}

const TEMPORARY_LOCAL_LABELS: Record<string, true> = {
    '@@': true,
    '@b': true,
    '@f': true,
    '@n': true,
    '@p': true
};

function hasMatchingAnonymousLabel(
    document: AsmDocument,
    lineIndex: number,
    target: string,
    macroStartLine?: number
): boolean {
    if (target === '@b' || target === '@p') {
        const limitLine = macroStartLine ?? 0;
        for (let i = lineIndex - 1; i >= limitLine; i--) {
            const l = document.lines[i];
            if (l && l.label === '@@' && !l.isInactive) {
                return true;
            }
        }
        return false;
    }
    if (target === '@f' || target === '@n') {
        const endLimitLine = document.lines.length - 1;
        for (let i = lineIndex + 1; i <= endLimitLine; i++) {
            const l = document.lines[i];
            if (macroStartLine !== undefined && l && l.mnemonic && (l.mnemonic === 'endmacro' || l.mnemonic === 'endm')) {
                break;
            }
            if (l && l.label === '@@' && !l.isInactive) {
                return true;
            }
        }
        return false;
    }
    return true;
}
const CPU_TARGETS: ReadonlyMap<string, CpuTarget> = new Map([
    ['z80', CpuTarget.Z80],
    ['z180', CpuTarget.Z180],
    ['ez80', CpuTarget.EZ80]
]);

function usesZ80OnlyRegister(operands: Token[][] | undefined, registers: readonly string[]): boolean {
    if (operands === undefined || registers.length === 0) return false;

    for (const operand of operands) {
        for (const token of operand) {
            if (token.type === TokenType.Identifier && registers.includes(token.value.toLowerCase())) {
                return true;
            }
        }
    }

    return false;
}

function qualifyScopedLabel(name: string, currentGlobalLabel: string): string {
    if ((!name.startsWith('@') && !name.startsWith('.')) || TEMPORARY_LOCAL_LABELS[name] || currentGlobalLabel.length === 0) {
        return name;
    }

    return `${currentGlobalLabel}${name}`;
}

const AGON_LABEL_MAX_LENGTH = 32;

const DATA_WIDTHS: Readonly<Record<string, number>> = {
    db: 255, defb: 255, dw: 65535, defw: 65535,
    dl: MAX_ADDR_EZ80, dw24: MAX_ADDR_EZ80, dw32: 0xffffffff
};
const STRING_DATA_DIRECTIVES = new Set(['db', 'defb', 'byte', 'dt', 'deft', 'ascii', 'asciz']);
const BLOCK_WIDTHS: Readonly<Record<string, number>> = {
    blkb: 255, blkw: 65535, blkp: MAX_ADDR_EZ80, blkl: 0xffffffff
};

function validateAgonLabel(name: string): string | undefined {
    if (name.length > AGON_LABEL_MAX_LENGTH) {
        return `Label '${name}' exceeds the ${AGON_LABEL_MAX_LENGTH}-character limit`;
    }

    if (getInstructionMetadata(name)?.supportedDialects.includes(CpuDialect.EZ80)) {
        return `Label '${name}' conflicts with an eZ80 mnemonic`;
    }

    if (getDirectiveMetadata(name)?.supportedDialects.includes(CpuDialect.EZ80)) {
        return `Label '${name}' conflicts with an eZ80 directive`;
    }

    if (isConditionCode(name)) {
        return `Label '${name}' conflicts with an eZ80 condition code`;
    }
}


export function collectDiagnostics(workspace: IndexedWorkspace, uri: string): Diagnostic[] {
    const document = workspace.documents.get(uri);
    if (!document) return [];

    const diagnostics: Diagnostic[] = [];
    const localDefinitions = new Set<string>();

    
    // First pass: collect local definitions and detect duplicates within file
    let currentGlobalLabel = "";
    for (let i = 0; i < document.lines.length; i++) {
        const line = document.lines[i];
        if (line.isInactive) continue;
        if (line.label) {
            let name = line.label;
            if (document.dialect === CpuDialect.EZ80 && !document.isAsmsx) {
                const validationError = validateAgonLabel(name);
                if (validationError) {
                    diagnostics.push({ line: i, message: validationError, startCharacter: line.tokens[0] ? (line.tokens[0].start - line.start!) : undefined, length: line.labelToken ? (line.labelToken.start + line.labelToken.length - line.tokens[0].start) : undefined });
                }
            }
            if (name.startsWith('@') && !name.startsWith('@@') && document.dialect === CpuDialect.Z80) {
                diagnostics.push({ line: i, message: `Local label starting with a single '@' is an ez80asm feature, but file is asMSX (.z80)`, startCharacter: line.tokens[0] ? (line.tokens[0].start - line.start!) : undefined, length: line.labelToken ? (line.labelToken.start + line.labelToken.length - line.tokens[0].start) : undefined });
            } else if (name.startsWith('.') && document.dialect === CpuDialect.EZ80 && !document.isAsmsx) {
                diagnostics.push({ line: i, message: `Local label starting with '.' is an asMSX feature, but file is ez80asm (.ez80)`, startCharacter: line.tokens[0] ? (line.tokens[0].start - line.start!) : undefined, length: line.labelToken ? (line.labelToken.start + line.labelToken.length - line.tokens[0].start) : undefined });
            }

            if (name.startsWith('@') || name.startsWith('.')) {
                name = qualifyScopedLabel(name, currentGlobalLabel);
            } else {
                currentGlobalLabel = name;
            }

            if (line.label !== '@@') {
                if (localDefinitions.has(name)) {
                    diagnostics.push({ line: i, message: `Duplicate symbol definition: ${line.label}`, startCharacter: line.tokens[0] ? (line.tokens[0].start - line.start!) : undefined, length: line.labelToken ? (line.labelToken.start + line.labelToken.length - line.tokens[0].start) : undefined });
                } else {
                    localDefinitions.add(name);
                }
            }
        }
    }

    let currentIsAsmsxSyntax = document.isAsmsx;
    let currentScopeLabel = "";
    let currentCpu = document.dialect === CpuDialect.EZ80 ? CpuTarget.EZ80 : CpuTarget.Z80;
    const relocateStack: { line: number; token: Token | undefined }[] = [];
    let ifDepth = 0;
    const ifStack: { line: number; token: Token | undefined }[] = [];
    let macroDepth = 0;
    const macroStack: { line: number; token: Token | undefined; name?: string; parameters: ReadonlySet<string>; localDefs: Set<string> }[] = [];
    const invalidMacros = new Set<string>();
    const deferredMacroInvocations: { line: number; token: Token | undefined; name: string }[] = [];

    const addDiagnostic = (diag: Diagnostic) => {
        diagnostics.push(diag);
        if (macroStack.length > 0) {
            for (const macroItem of macroStack) {
                if (macroItem.name) {
                    invalidMacros.add(macroItem.name);
                }
            }
        }
    };

    for (let i = 0; i < document.lines.length; i++) {
        let hasBlockingOperandDiagnostic = false;
        const line = document.lines[i];

        if (line.error) {
            diagnostics.push({ 
                line: i, 
                message: line.error,
                startCharacter: line.errorToken ? (line.errorToken.start - line.start!) : undefined,
                length: line.errorToken?.length
            });
            continue;
        }
        const unterminatedCommentToken = line.tokens.find(
            (token) => token.type === TokenType.Comment && token.unterminated
        );
        if (unterminatedCommentToken) {
            diagnostics.push({
                line: i,
                message: "Unterminated block comment",
                startCharacter: unterminatedCommentToken.start - line.start!,
                length: unterminatedCommentToken.length
            });
            continue;
        }
        const invalidEscapeToken = line.mnemonic !== 'include'
            ? line.tokens.find((token) => token.type === TokenType.String
                && token.invalidEscape
                && (token.quote === "'" || !currentIsAsmsxSyntax && token.quote === '"'))
            : undefined;
        if (invalidEscapeToken) {
            diagnostics.push({
                line: i,
                message: "Invalid escape sequence in string literal",
                startCharacter: invalidEscapeToken.start - line.start!,
                length: invalidEscapeToken.length
            });
            continue;
        }
        // Inactive conditional blocks are not assembled. Control-flow lines
        // (if/else/endif) are never marked inactive, so their nesting balance
        // still tracks while inactive content cannot flip cpu/zilog/macro
        // state or capture label scope. Syntax errors above are still
        // surfaced from inactive lines.
        if (line.isInactive) {
            continue;
        }
        // Macro-local labels are pre-collected at macro-open
        // (collectMacroLocalDefs) so forward references resolve too.
        if (line.label && !line.label.startsWith('@') && !line.label.startsWith('.')) {
            currentScopeLabel = line.label;
        }
        if (line.mnemonic === 'zilog') {
            currentIsAsmsxSyntax = false;
        }
        if (line.mnemonic === 'cpu') {
            const operand = line.operands?.[0];
            const cpu = operand?.length === 1 && operand[0].type === TokenType.Identifier
                ? CPU_TARGETS.get(operand[0].value.toLowerCase())
                : undefined;
            if (cpu === undefined) {
                diagnostics.push({
                    line: i,
                    message: "CPU directive expects Z80, Z180, or EZ80",
                    startCharacter: line.mnemonicToken ? line.mnemonicToken.start - line.start! : undefined,
                    length: line.mnemonicToken?.length
                });
            } else {
                currentCpu = cpu;
            }
            continue;
        }
        if (line.mnemonic === 'relocate') {
            relocateStack.push({ line: i, token: line.mnemonicToken });
            continue;
        }
        if (line.mnemonic === 'endrelocate') {
            if (relocateStack.length === 0) {
                diagnostics.push({
                    line: i,
                    message: "ENDRELOCATE without matching RELOCATE",
                    startCharacter: line.mnemonicToken ? line.mnemonicToken.start - line.start! : undefined,
                    length: line.mnemonicToken?.length
                });
            } else if (relocateStack.length > 1) {
                const nested = relocateStack.pop()!;
                diagnostics.push({
                    line: nested.line,
                    message: "RELOCATE blocks cannot be nested",
                    startCharacter: nested.token ? nested.token.start - document.lines[nested.line].start! : undefined,
                    length: nested.token?.length
                });
            } else {
                relocateStack.pop();
            }
            continue;
        }
        if (line.mnemonic === 'if' || line.mnemonic === 'ifdef' || line.mnemonic === 'ifndef') {
            ifDepth++;
            ifStack.push({ line: i, token: line.mnemonicToken });
            continue;
        }
        if (line.mnemonic === 'else') {
            if (ifDepth === 0) {
                diagnostics.push({
                    line: i,
                    message: "ELSE without matching IF",
                    startCharacter: line.mnemonicToken ? line.mnemonicToken.start - line.start! : undefined,
                    length: line.mnemonicToken?.length
                });
            }
            continue;
        }
        if (line.mnemonic === 'endif') {
            if (ifDepth === 0) {
                diagnostics.push({
                    line: i,
                    message: "ENDIF without matching IF",
                    startCharacter: line.mnemonicToken ? line.mnemonicToken.start - line.start! : undefined,
                    length: line.mnemonicToken?.length
                });
            } else {
                ifDepth--;
                ifStack.pop();
            }
            continue;
        }
        // Push even without a name so the terminator still pairs and later
        // endm/endmacro lines are not reported as unmatched. The missing
        // name itself is diagnosed by validateGenericDirectiveOperands.
        if (line.mnemonic === 'macro') {
            const currentMacroName = getMacroName(line);
            const pushHeaderDiag = (diag: Diagnostic) => {
                diagnostics.push(diag);
                if (currentMacroName) {
                    invalidMacros.add(currentMacroName);
                }
                for (const macroItem of macroStack) {
                    if (macroItem.name) {
                        invalidMacros.add(macroItem.name);
                    }
                }
            };

            if (macroDepth > 0) {
                pushHeaderDiag({
                    line: i,
                    message: "Nested macro definitions are not allowed",
                    startCharacter: line.mnemonicToken ? line.mnemonicToken.start - line.start! : undefined,
                    length: line.mnemonicToken?.length
                });
            }
            if (line.isAsmsx) {
                const labelToken = line.labelToken;
                if (
                    labelToken !== undefined &&
                    !line.tokens.some((token) =>
                        token.type === TokenType.Colon &&
                        token.start === labelToken.start + labelToken.length
                    )
                ) {
                    pushHeaderDiag({
                        line: i,
                        message: "asMSX MACRO name must be followed by ':'",
                        startCharacter: labelToken.start - line.start!,
                        length: labelToken.length
                    });
                }
            }

            const paramGroups = getMacroParameterGroups(line);
            for (const group of paramGroups) {
                if (group.length > 1) {
                    const firstUnexpectedToken = group[1];
                    const lastToken = group[group.length - 1];
                    pushHeaderDiag({
                        line: i,
                        message: line.isAsmsx ? "asMSX MACRO parameters must be separated by commas" : "MACRO parameters must be separated by commas",
                        startCharacter: firstUnexpectedToken.start - line.start!,
                        length: lastToken.start + lastToken.length - firstUnexpectedToken.start
                    });
                }
                if (line.isAsmsx) {
                    const firstToken = group[0];
                    if (firstToken !== undefined && !firstToken.value.startsWith('#')) {
                        pushHeaderDiag({
                            line: i,
                            message: "asMSX MACRO parameter must start with '#'",
                            startCharacter: firstToken.start - line.start!,
                            length: group[group.length - 1].start + group[group.length - 1].length - firstToken.start
                        });
                    }
                }
            }
            macroDepth++;
            macroStack.push({ line: i, token: line.mnemonicToken, name: currentMacroName, parameters: getMacroParameters(line, document.dialect), localDefs: collectMacroLocalDefs(document, i, document.dialect) });
        }
        
        const isEndMacro = line.mnemonic && (document.dialect === CpuDialect.EZ80 ? line.mnemonic === 'endmacro' : (line.mnemonic === 'endm' || line.mnemonic === 'endmacro'));
        if (isEndMacro && line.mnemonic) {
            if (macroDepth === 0) {
                diagnostics.push({
                    line: i,
                    message: `${line.mnemonic.toUpperCase()} without matching MACRO`,
                    startCharacter: line.mnemonicToken ? line.mnemonicToken.start - line.start! : undefined,
                    length: line.mnemonicToken?.length
                });
            } else {
                macroDepth--;
                macroStack.pop();
            }
        }
        const macroParameters = macroStack.at(-1)?.parameters;
        if (macroParameters !== undefined) {
            for (const token of line.tokens) {
                if (token.type === TokenType.Identifier && token.value.startsWith('#') && !macroParameters.has(token.value)) {
                    diagnostics.push({
                        line: i,
                        message: `Unknown macro parameter: ${token.value}`,
                        startCharacter: token.start - line.start!,
                        length: token.length
                    });
                }
            }
        }
        if (line.mnemonic && !line.isDirective) {
            const mnemonicToken = line.mnemonicToken;
            const hasDirectiveDot = mnemonicToken !== undefined && line.tokens.some((token) =>
                token.type === TokenType.Dot &&
                token.start + token.length === mnemonicToken.start
            );
            const dirMeta = getDirectiveMetadata(line.mnemonic);
            if (hasDirectiveDot && mnemonicToken !== undefined && (!dirMeta || !dirMeta.supportedDialects.includes(document.dialect))) {
                diagnostics.push({
                    line: i,
                    message: `Unknown directive: .${line.mnemonic}`,
                    startCharacter: mnemonicToken.start - line.start! - 1,
                    length: mnemonicToken.length + 1
                });
            } else {
                const meta = getInstructionMetadata(line.mnemonic);
                if (!meta) {
                    const macro = line.mnemonicToken === undefined
                        ? undefined
                        : workspace.symbols.get(line.mnemonicToken.value);
                    if (macro?.kind !== 'macro') {
                        addDiagnostic({ line: i, message: `Unknown instruction: ${line.mnemonicToken?.value ?? line.mnemonic}`, startCharacter: line.mnemonicToken ? (line.mnemonicToken.start - line.start!) : undefined, length: line.mnemonicToken?.length });
                    } else {
                        const macroName = line.mnemonicToken?.value ?? line.mnemonic;
                        if (invalidMacros.has(macroName)) {
                            addDiagnostic({
                                line: i,
                                message: `Cannot invoke macro '${macroName}' because its definition contains errors`,
                                startCharacter: line.mnemonicToken ? (line.mnemonicToken.start - line.start!) : undefined,
                                length: line.mnemonicToken?.length
                            });
                        } else if (macroDepth > 0) {
                            addDiagnostic({
                                line: i,
                                message: `Macro invocation '${macroName}' is not allowed inside a macro body`,
                                startCharacter: line.mnemonicToken ? (line.mnemonicToken.start - line.start!) : undefined,
                                length: line.mnemonicToken?.length
                            });
                        } else {
                            deferredMacroInvocations.push({ line: i, token: line.mnemonicToken, name: macroName });
                        }
                        hasBlockingOperandDiagnostic = true;
                    }
                } else {
                    if (!meta.supportedDialects.includes(document.dialect)) {
                        diagnostics.push({ line: i, message: `Instruction '${line.mnemonic}' is not supported in dialect ${document.dialect}`, startCharacter: line.mnemonicToken ? (line.mnemonicToken.start - line.start!) : undefined, length: line.mnemonicToken?.length });
                    } else if (!meta.supportedCpus.includes(currentCpu) || (currentCpu !== CpuTarget.Z80 && usesZ80OnlyRegister(line.operands, meta.z80OnlyRegisters))) {
                        diagnostics.push({ line: i, message: `Instruction '${line.mnemonic}' is not supported by CPU ${currentCpu.toUpperCase()}`, startCharacter: line.mnemonicToken ? (line.mnemonicToken.start - line.start!) : undefined, length: line.mnemonicToken?.length });
                    }
                }
            }
        }

        if (line.mnemonic === 'assume') {
            for (const diag of validateAssumeOperands(line.operands || [], i, line.start!)) {
                diagnostics.push(diag);
            }
            continue;
        }

        if (line.mnemonic === 'megas') {
            for (const diag of validateMegasOperands(line.operands || [], i, line.start!, line.mnemonicToken)) {
                diagnostics.push(diag);
            }
            continue;
        }

        if (line.isDirective && line.mnemonic) {
            const result = validateGenericDirectiveOperands(line, i, document.dialect);
            if (result.handled) {
                for (const diag of result.diagnostics) {
                    diagnostics.push(diag);
                }
                
                const mnem = line.mnemonic.toLowerCase().replace('.', '');
                if (mnem === 'subpage' || mnem === 'select') {
                    if (line.operands && line.operands.length === 1 && result.diagnostics.length === 0) {
                        let atIndex = -1;
                        for (let j = 0; j < line.operands[0].length; j++) {
                            if (line.operands[0][j].type === TokenType.Identifier && line.operands[0][j].value.toLowerCase() === 'at') {
                                atIndex = j;
                                break;
                            }
                        }
                        if (atIndex > 0 && atIndex < line.operands[0].length - 1) {
                            const nTokens = line.operands[0].slice(0, atIndex);
                            const xTokens = line.operands[0].slice(atIndex + 1);
                            
                            diagnostics.push(...validateConstantExpression(nTokens, i, line.start!, document.dialect, val => {
                                return (val < 0 || val > 255) ? `Subpage number must be an 8-bit unsigned integer (0-255), but was ${val}` : null;
                            }));

                            diagnostics.push(...validateConstantExpression(xTokens, i, line.start!, document.dialect, val => {
                                return (val < 0 || val > MAX_ADDR_Z80) ? `Execution entry point must be a 16-bit unsigned address (0-${MAX_ADDR_Z80}), but was ${val}` : null;
                            }));
                        }
                    }
                }

                if (!result.expectsExpression || result.diagnostics.length > 0) {
                    continue;
                }
                
                if (mnem === 'page' && line.operands && line.operands.length === 1) {
                    diagnostics.push(...validateConstantExpression(line.operands[0], i, line.start!, document.dialect, val => {
                        return (val < 0 || val > 3) ? `Page number must be between 0 and 3, but was ${val}` : null;
                    }));
                }

                if ((mnem === 'org' || mnem === 'phase' || mnem === 'start') && line.operands && line.operands.length === 1) {
                    const maxVal = document.dialect === CpuDialect.EZ80 ? MAX_ADDR_EZ80 : MAX_ADDR_Z80;
                    const maxBits = document.dialect === CpuDialect.EZ80 ? '24-bit' : '16-bit';
                    diagnostics.push(...validateConstantExpression(line.operands[0], i, line.start!, document.dialect, val => {
                        return (val < 0 || val > maxVal) ? `Address must be a ${maxBits} unsigned integer (0-${maxVal}), but was ${val}` : null;
                    }));
                }

                if ((mnem === 'callbios' || mnem === 'calldos') && line.operands && line.operands.length === 1) {
                    const maxVal = mnem === 'calldos' ? 255 : MAX_ADDR_Z80;
                    const maxBits = mnem === 'calldos' ? '8-bit' : '16-bit';
                    const argName = mnem === 'calldos' ? 'Function number' : 'Address';
                    diagnostics.push(...validateConstantExpression(line.operands[0], i, line.start!, document.dialect, val => {
                        return (val < 0 || val > maxVal) ? `${argName} must be an ${maxBits} unsigned integer (0-${maxVal}), but was ${val}` : null;
                    }));
                }

                if (mnem === 'size' && line.operands && line.operands.length === 1) {
                    diagnostics.push(...validateConstantExpression(line.operands[0], i, line.start!, document.dialect, val => {
                        return (val <= 0 || val > 8192) ? `Size in kilobytes must be between 1 and 8192 (8MB), but was ${val}` : null;
                    }));
                }
            }
        }


        if (line.operands) {

            // In eZ80: [reg] is wrong (indirect needs parens); expression grouping [expr] is fine.
            // In asMSX: (reg) is wrong (indirect needs brackets); expression grouping (expr) is fine.
            const wrongOpen   = currentIsAsmsxSyntax ? TokenType.LParen   : TokenType.LBracket;
            const wrongClose  = currentIsAsmsxSyntax ? TokenType.RParen   : TokenType.RBracket;
            const correct     = currentIsAsmsxSyntax ? 'square brackets' : 'parentheses';
            const wrong       = currentIsAsmsxSyntax ? 'parentheses'     : 'square brackets';

            for (const operand of line.operands) {
                // If the operand is purely a string, don't parse it as an expression
                if (operand.length === 1 && operand[0].type === TokenType.String) continue;

                if (isWrongIndirectSyntax(operand, wrongOpen, wrongClose, document.dialect)) {
                    hasBlockingOperandDiagnostic = true;
                    diagnostics.push({
                        line: i,
                        message: `${wrong[0].toUpperCase() + wrong.slice(1)} around a register indicate indirect addressing; use ${correct} instead`,
                        startCharacter: operand[0] ? (operand[0].start - line.start!) : undefined,
                        length: operand.length > 0 ? (operand[operand.length - 1].start + operand[operand.length - 1].length - operand[0].start) : undefined
                    });
                    continue;
                }

                const badReg = invalidIndirectRegister(operand, document.dialect);
                if (badReg !== null) {
                    hasBlockingOperandDiagnostic = true;
                    diagnostics.push({
                        line: i,
                        message: `Register '${badReg}' cannot be used for indirect addressing; expected a register pair such as HL, BC, DE, SP, IX, or IY`,
                        startCharacter: operand[0] ? (operand[0].start - line.start!) : undefined,
                        length: operand.length > 0 ? (operand[operand.length - 1].start + operand[operand.length - 1].length - operand[0].start) : undefined
                    });
                    continue;
                }

                const badOffsetReg = invalidIndirectOffset(operand);
                if (badOffsetReg !== null) {
                    hasBlockingOperandDiagnostic = true;
                    diagnostics.push({
                        line: i,
                        message: `Register '${badOffsetReg}' cannot be used with an offset in indirect addressing; only IX and IY support offsets`,
                        startCharacter: line.mnemonicToken ? (line.mnemonicToken.start - line.start!) : undefined,
                        length: line.mnemonicToken?.length
                    });
                    continue;
                }

                try {
                    const parser = new ExpressionParser(operand, document.dialect);
                    const ast = parser.parse();
                    
                    const unresolved = findUnresolvedSymbols(ast, document, workspace, localDefinitions, currentScopeLabel, macroDepth > 0);
                    for (const sym of unresolved) {
                        if (macroParameters?.has(sym)) {
                            continue;
                        }
                        if (macroDepth > 0) {
                            if (document.dialect === CpuDialect.EZ80) {
                                const isAtLocal = sym.startsWith('@') || sym.includes('@');
                                if (isAtLocal) {
                                    if (sym === '@@') {
                                        continue;
                                    }
                                    if (sym === '@b' || sym === '@f' || sym === '@n' || sym === '@p') {
                                        const macroStartLine = macroStack.at(-1)?.line;
                                        if (hasMatchingAnonymousLabel(document, i, sym, macroStartLine)) {
                                            continue;
                                        }
                                        addDiagnostic({
                                            line: i,
                                            message: `Anonymous label target '${sym}' referenced in macro is not defined within the macro`,
                                            startCharacter: operand[0] ? (operand[0].start - line.start!) : undefined,
                                            length: operand.length > 0 ? (operand[operand.length - 1].start + operand[operand.length - 1].length - operand[0].start) : undefined
                                        });
                                        continue;
                                    }
                                    const unstripped = sym.includes('@') ? sym.substring(sym.indexOf('@')) : sym;
                                    if (macroStack.at(-1)?.localDefs.has(sym) || macroStack.at(-1)?.localDefs.has(unstripped)) {
                                        continue;
                                    }
                                    addDiagnostic({
                                        line: i,
                                        message: `Local label '${sym}' referenced in macro is not defined within the macro`,
                                        startCharacter: operand[0] ? (operand[0].start - line.start!) : undefined,
                                        length: operand.length > 0 ? (operand[operand.length - 1].start + operand[operand.length - 1].length - operand[0].start) : undefined
                                    });
                                    continue;
                                }
                            } else {
                                if (sym.startsWith('#') || isMacroLocalOperand(operand)) {
                                    continue;
                                }
                            }
                        } else {
                            if (sym === '@b' || sym === '@f' || sym === '@n' || sym === '@p') {
                                if (!hasMatchingAnonymousLabel(document, i, sym)) {
                                    addDiagnostic({
                                        line: i,
                                        message: `Unresolved symbol: ${sym}`,
                                        startCharacter: operand[0] ? (operand[0].start - line.start!) : undefined,
                                        length: operand.length > 0 ? (operand[operand.length - 1].start + operand[operand.length - 1].length - operand[0].start) : undefined
                                    });
                                    continue;
                                }
                                continue;
                            }
                        }
                        addDiagnostic({ 
                            line: i, 
                            message: `Unresolved symbol: ${sym}`,
                            startCharacter: operand[0] ? (operand[0].start - line.start!) : undefined,
                            length: operand.length > 0 ? (operand[operand.length - 1].start + operand[operand.length - 1].length - operand[0].start) : undefined
                        });
                    }
                } catch (e: unknown) {
                    // The try block only throws from ExpressionParser.parse().
                    // Multi-dot local-label references (jr ..local_label) are
                    // legal macro labels the expression grammar cannot parse,
                    // so tolerate exactly that shape; every other failure is a
                    // genuine syntax error and surfaces even inside macros
                    // (addDiagnostic marks enclosing macros invalid).
                    if (macroDepth > 0 && isDottedLabelReference(operand)) {
                        hasBlockingOperandDiagnostic = true;
                        continue;
                    }
                    hasBlockingOperandDiagnostic = true;
                    const diag: Diagnostic = { line: i, message: `Wrong operand form: ${e instanceof Error ? e.message : String(e)}` };
                    if (e instanceof ParseError && e.token) {
                        diag.startCharacter = e.token.start - line.start!;
                        diag.length = e.token.length;
                    } else if (operand.length > 0) {
                        diag.startCharacter = operand[0].start - line.start!;
                        diag.length = operand[operand.length - 1].start + operand[operand.length - 1].length - operand[0].start;
                    }
                    addDiagnostic(diag);
                }
            }
        }

        if (!hasBlockingOperandDiagnostic && line.mnemonic && !line.isDirective) {
            const meta = getInstructionMetadata(line.mnemonic);
            if (meta && meta.supportedDialects.includes(document.dialect)) {
                let result: ValidationResult = { error: null, sigOps: null };
                if (line.operands && line.mnemonicToken) {
                    result = validateInstructionOperands(line.operands, line.mnemonic, meta, document.dialect, currentIsAsmsxSyntax);
                } else if (!line.operands && meta.signature.includes(' ') && line.mnemonicToken) {
                    result = validateInstructionOperands([], line.mnemonic, meta, document.dialect, currentIsAsmsxSyntax);
                }

                if (result.error && line.mnemonicToken) {
                    let startChar = line.mnemonicToken.start - line.start!;
                    let len = line.mnemonicToken.length;
                    
                    if (result.errorIndex !== undefined && line.operands && line.operands[result.errorIndex] && line.operands[result.errorIndex].length > 0) {
                        const operandTokens = line.operands[result.errorIndex];
                        startChar = operandTokens[0].start - line.start!;
                        len = operandTokens[operandTokens.length - 1].start + operandTokens[operandTokens.length - 1].length - operandTokens[0].start;
                    }

                    diagnostics.push({
                        line: i,
                        message: result.error,
                        startCharacter: startChar,
                        length: len
                    });
                } else if (!result.error && result.sigOps && line.operands) {
                    // Valid syntax, now check for range errors if they are constant expressions
                    for (let j = 0; j < line.operands.length; j++) {
                        const operand = line.operands[j];
                        const sigPart = result.sigOps[j].toLowerCase();
                        
                        try {
                            const parser = new ExpressionParser(operand, document.dialect);
                            const ast = parser.parse();
                            if (isConstantExpression(ast)) {
                                const val = evaluate(ast, () => undefined, 0);
                                let rangeError: string | null = null;
                                
                                // Strip indirect for range checks
                                const isIndirect = isIndirectOperand(operand, currentIsAsmsxSyntax);
                                const actualSigPart = isIndirect && sigPart.startsWith('(') && sigPart.endsWith(')') ? sigPart.slice(1, -1) : sigPart;
                                
                                if (actualSigPart === 'b') {
                                    if (val < 0 || val > 7) rangeError = `Bit index must be between 0 and 7, but was ${val}`;
                                } else if (actualSigPart === 'n' || actualSigPart === 's' || actualSigPart === 'r/n') {
                                    if (val < 0 || val > 255) rangeError = `8-bit unsigned literal must be between 0 and 255, but was ${val}`;
                                } else if (actualSigPart === 'p') {
                                    if (val < 0 || val > 56 || val % 8 !== 0) rangeError = `Restart vector literal must be one of 0, 8, 16, 24, 32, 40, 48, 56, but was ${val}`;
                                } else if (actualSigPart === 'm' || actualSigPart === 'r') {
                                    rangeError = `Operand must be a register or memory reference, not a literal`;
                                } else if (actualSigPart === 'd') {
                                    if (val < -128 || val > 127) rangeError = `8-bit signed literal must be between -128 and 127, but was ${val}`;
                                } else if (actualSigPart === 'nn') {
                                    const maxVal = document.dialect === CpuDialect.EZ80 ? MAX_ADDR_EZ80 : MAX_ADDR_Z80;
                                    const bitsStr = document.dialect === CpuDialect.EZ80 ? '24-bit' : '16-bit';
                                    if (val < 0 || val > maxVal) rangeError = `${bitsStr} unsigned literal must be between 0 and ${maxVal}, but was ${val}`;
                                }
                                
                                if (rangeError) {
                                    diagnostics.push({
                                        line: i,
                                        message: rangeError,
                                        startCharacter: operand[0] ? (operand[0].start - line.start!) : undefined,
                                        length: operand.length > 0 ? (operand[operand.length - 1].start + operand[operand.length - 1].length - operand[0].start) : undefined
                                    });
                                }
                            } else {
                                const isIndirect = isIndirectOperand(operand, currentIsAsmsxSyntax);
                                const actualSigPart = isIndirect && sigPart.startsWith('(') && sigPart.endsWith(')') ? sigPart.slice(1, -1) : sigPart;
                                if (actualSigPart.endsWith('+d') || actualSigPart.endsWith('-d')) {
                                    const offsetVal = extractIndexOffset(ast);
                                    if (offsetVal !== null && (offsetVal < -128 || offsetVal > 127)) {
                                        diagnostics.push({
                                            line: i,
                                            message: `Index offset must be between -128 and 127, but was ${offsetVal}`,
                                            startCharacter: operand[0] ? (operand[0].start - line.start!) : undefined,
                                            length: operand.length > 0 ? (operand[operand.length - 1].start + operand[operand.length - 1].length - operand[0].start) : undefined
                                        });
                                    }
                                }
                            }
                        } catch {
                            // Ignored, parse errors handled earlier
                        }
                    }
                }
            }
        }
    }

    for (const unclosed of relocateStack) {
        diagnostics.push({
            line: unclosed.line,
            message: "RELOCATE without matching ENDRELOCATE",
            startCharacter: unclosed.token ? unclosed.token.start - document.lines[unclosed.line].start! : undefined,
            length: unclosed.token?.length
        });
    }

    for (const unclosed of ifStack) {
        diagnostics.push({
            line: unclosed.line,
            message: "IF without matching ENDIF",
            startCharacter: unclosed.token ? unclosed.token.start - document.lines[unclosed.line].start! : undefined,
            length: unclosed.token?.length
        });
    }


    for (const unclosed of macroStack) {
        const expectedTerminator = document.dialect === CpuDialect.EZ80 ? "ENDMACRO" : "ENDM";
        addDiagnostic({
            line: unclosed.line,
            message: `MACRO without matching ${expectedTerminator}`,
            startCharacter: unclosed.token ? unclosed.token.start - document.lines[unclosed.line].start! : undefined,
            length: unclosed.token?.length
        });
    }
    for (const invocation of deferredMacroInvocations) {
        if (!invalidMacros.has(invocation.name)) {
            continue;
        }
        addDiagnostic({
            line: invocation.line,
            message: `Cannot invoke macro '${invocation.name}' because its definition contains errors`,
            startCharacter: invocation.token ? invocation.token.start - document.lines[invocation.line].start! : undefined,
            length: invocation.token?.length
        });
    }
    return diagnostics;
}

// Registers that may appear inside indirect-addressing brackets.
// Single 8-bit registers (h, l, a, b, d, e, i, r, ixh, etc.) are NOT in this set.
const INDIRECT_CAPABLE_REGISTERS = new Set([
    'hl', 'bc', 'de', 'sp', 'ix', 'iy',
    'c',      // (C) is valid for IN/OUT port addressing
    'mbase',  // eZ80 extension
]);

function isWrongIndirectSyntax(
    operand: Token[],
    openType: TokenType,
    closeType: TokenType,
    dialect: CpuDialect
): boolean {
    // Must be fully wrapped: first token is the wrong open, last is the wrong close.
    if (operand.length < 3) return false;
    if (operand[0].type !== openType) return false;
    if (operand[operand.length - 1].type !== closeType) return false;
    // Only flag when the inner content contains an indirect-capable register.
    // 8-bit registers are handled separately by invalidIndirectRegister so
    // that we never suggest "use parentheses" for something like [h] where
    // even the correct bracket form (h) would still be wrong.
    const inner = operand.slice(1, -1);
    return inner.some(t =>
        t.type === TokenType.Identifier &&
        isRegister(t.value, dialect) &&
        INDIRECT_CAPABLE_REGISTERS.has(t.value.toLowerCase())
    );
}

/**
 * Returns the register name if the operand is `<open> <non-indirect-reg> <close>` with
 * either bracket pair — i.e. the register cannot be dereferenced regardless of bracket style.
 * Returns null otherwise.
 */
function invalidIndirectRegister(
    operand: Token[],
    dialect: CpuDialect
): string | null {
    if (operand.length !== 3) return null;
    const first = operand[0].type;
    const last  = operand[2].type;
    const isParen   = first === TokenType.LParen   && last === TokenType.RParen;
    const isBracket = first === TokenType.LBracket && last === TokenType.RBracket;
    if (!isParen && !isBracket) return null;
    if (operand[1].type !== TokenType.Identifier) return null;
    const name = operand[1].value.toLowerCase();
    if (!isRegister(name, dialect)) return null;
    if (INDIRECT_CAPABLE_REGISTERS.has(name)) return null;
    return operand[1].value; // return original casing for the message
}

/**
 * Returns the register name if the operand is `<open> <reg> <+ or -> ... <close>`
 * where <reg> is NOT ix or iy. Only ix and iy support offset addressing.
 */
function invalidIndirectOffset(
    operand: Token[]
): string | null {
    if (operand.length < 4) return null;
    
    const first = operand[0].type;
    const last = operand[operand.length - 1].type;
    const isParen   = first === TokenType.LParen   && last === TokenType.RParen;
    const isBracket = first === TokenType.LBracket && last === TokenType.RBracket;
    if (!isParen && !isBracket) return null;
    
    // Check if the second token is a register
    if (operand[1].type !== TokenType.Identifier) return null;
    
    // Check if the third token is a plus or minus sign
    if (operand[2].type !== TokenType.Plus && operand[2].type !== TokenType.Minus) return null;
    
    const name = operand[1].value.toLowerCase();
    // In Z80/eZ80, only ix and iy can have an offset.
    if (name === 'ix' || name === 'iy') return null;
    
    // Check if it's a register pair that is invalid with offsets
    if (INDIRECT_CAPABLE_REGISTERS.has(name) || name === 'hl' || name === 'de' || name === 'bc' || name === 'sp') {
        return operand[1].value;
    }
    
    return null;
}

/**
 * Checks if an operand has the outer syntax of an indirect memory access.
 */
function isIndirectOperand(operand: Token[], isAsmsx: boolean): boolean {
    if (operand.length < 3) return false;
    const first = operand[0].type;
    const last = operand[operand.length - 1].type;
    
    if (isAsmsx) {
        // In asMSX, only [] represents indirect memory access; () is purely for math grouping.
        return first === TokenType.LBracket && last === TokenType.RBracket;
    } else {
        // In standard Z80/eZ80, both () and [] might be used (even if [] is wrong, the intent is indirect).
        return (first === TokenType.LParen && last === TokenType.RParen) ||
               (first === TokenType.LBracket && last === TokenType.RBracket);
    }
}

function findUnresolvedSymbols(
    node: ASTNode,
    document: AsmDocument,
    workspace: IndexedWorkspace,
    localDefs: Set<string>,
    currentGlobalLabel: string,
    inMacro: boolean = false
): string[] {
    const unresolved: string[] = [];

    function traverse(n: ASTNode) {
        if (n.type === 'Symbol') {
            const name = (n as SymbolNode).name;
            const qualifiedName = qualifyScopedLabel(name, currentGlobalLabel);
            const isLocalInMacro = document.dialect === CpuDialect.EZ80 && inMacro && name.startsWith('@') && !TEMPORARY_LOCAL_LABELS[name];
            if (!isRegister(name, document.dialect) &&
                !isConditionCode(name) &&
                name !== '@@' &&
                (!workspace.symbols.has(qualifiedName) || isLocalInMacro) &&
                (!localDefs.has(qualifiedName) || isLocalInMacro)) {
                unresolved.push(qualifiedName);
            }
        } else if (n.type === 'UnaryOp') {
            traverse((n as UnaryOpNode).expr);
        } else if (n.type === 'BinaryOp') {
            traverse((n as BinaryOpNode).left);
            traverse((n as BinaryOpNode).right);
        }
    }

    traverse(node);
    return unresolved;
}

// Known assume keys and their valid values for ez80asm
const ASSUME_KEYS: ReadonlyMap<string, readonly number[]> = new Map([
    ['adl', [0, 1]],
]);

function validateAssumeOperands(operands: Token[][], line: number, lineStart: number): Diagnostic[] {
    const diagnostics: Diagnostic[] = [];

    for (const operand of operands) {
        // Expect: Identifier(key) Equals Number(value)
        const keyToken = operand[0];
        const equalsToken = operand[1];
        const valueToken = operand[2];

        if (
            !keyToken || keyToken.type !== TokenType.Identifier ||
            !equalsToken || equalsToken.type !== TokenType.Equals ||
            !valueToken || valueToken.type !== TokenType.Number ||
            operand.length !== 3
        ) {
            diagnostics.push({ 
                line, 
                message: `Malformed assume operand: expected 'key=value'`,
                startCharacter: operand[0] ? (operand[0].start - lineStart) : undefined,
                length: operand.length > 0 ? (operand[operand.length - 1].start + operand[operand.length - 1].length - operand[0].start) : undefined
            });
            continue;
        }

        const key = keyToken.value.toLowerCase();
        const validValues = ASSUME_KEYS.get(key);
        if (validValues === undefined) {
            diagnostics.push({ 
                line, 
                message: `Unknown assume key: '${keyToken.value}'`,
                startCharacter: keyToken.start - lineStart,
                length: keyToken.length
            });
            continue;
        }

        const value = parseInt(valueToken.value, 10);
        if (!validValues.includes(value)) {
            diagnostics.push({ 
                line, 
                message: `Invalid value for assume '${key}': must be ${validValues.join(' or ')}`,
                startCharacter: valueToken.start - lineStart,
                length: valueToken.length
            });
        }
    }

    return diagnostics;
}

const MEGAS_TYPES = new Set(['konami', 'konami_scc', 'ascii8', 'ascii16']);

function validateMegasOperands(operands: Token[][], line: number, lineStart: number, directiveToken?: Token): Diagnostic[] {
    const diagnostics: Diagnostic[] = [];
    if (operands.length !== 1) {
        diagnostics.push({ 
            line, 
            message: `Directive 'megas' requires exactly one operand`,
            startCharacter: directiveToken ? (directiveToken.start - lineStart) : undefined,
            length: directiveToken?.length
        });
        return diagnostics;
    }
    const operand = operands[0];
    if (operand.length !== 1 || operand[0].type !== TokenType.Identifier) {
        diagnostics.push({
            line,
            message: `Invalid operand for 'megas'. Expected a MegaROM type identifier.`,
            startCharacter: operand[0] ? (operand[0].start - lineStart) : undefined,
            length: operand.length > 0 ? (operand[operand.length - 1].start + operand[operand.length - 1].length - operand[0].start) : undefined
        });
        return diagnostics;
    }
    const typeValue = operand[0].value.toLowerCase();
    if (!MEGAS_TYPES.has(typeValue)) {
        diagnostics.push({
            line,
            message: `Unknown MegaROM type: '${operand[0].value}'. Valid types are usually KONAMI, KONAMI_SCC, ASCII8, ASCII16.`,
            startCharacter: operand[0].start - lineStart,
            length: operand[0].length
        });
    }
    return diagnostics;
}



function validateNumericDirectiveOperands(
    operands: Token[][],
    minimumOperands: number,
    maximumOperands: number,
    line: number,
    lineStart: number,
    mnemonic: string,
    minimumValue: number,
    maximumValue: number,
    valueName: string,
    allowStrings: boolean = false,
    dialect: CpuDialect = CpuDialect.EZ80
): Diagnostic[] {
    const diagnostics: Diagnostic[] = [];
    if (operands.length < minimumOperands || operands.length > maximumOperands) {
        const countText = minimumOperands === maximumOperands
            ? `exactly ${minimumOperands}`
            : maximumOperands >= Number.MAX_SAFE_INTEGER
                ? `at least ${minimumOperands}`
                : `between ${minimumOperands} and ${maximumOperands}`;
        const plural = (minimumOperands === 1 && (maximumOperands === 1 || maximumOperands >= Number.MAX_SAFE_INTEGER)) ? '' : 's';

        diagnostics.push({
            line,
            message: `Directive '${mnemonic}' requires ${countText} operand${plural}`,
            startCharacter: undefined,
            length: undefined
        });
        return diagnostics;
    }

    for (const operand of operands) {
        if (operand.length === 1 && operand[0].type === TokenType.String) {
            if (allowStrings) continue;
            diagnostics.push({
                line,
                message: `Directive '${mnemonic}' expects a numeric ${valueName}, not a string`,
                startCharacter: operand[0].start - lineStart,
                length: operand[0].length
            });
            continue;
        }
        diagnostics.push(...validateConstantExpression(operand, line, lineStart, dialect, value => {
            return value < minimumValue || value > maximumValue
                ? `${valueName} must be between ${minimumValue} and ${maximumValue}, but was ${value}`
                : null;
        }));
    }
    return diagnostics;
}

function hasMacroName(line: LineNode): boolean {
    return line.label !== undefined || (line.operands?.length ?? 0) > 0;
}
function getMacroName(line: LineNode): string | undefined {
    if (line.label) return line.label;
    if (!line.label && line.operands && line.operands[0]?.[0]?.type === TokenType.Identifier) {
        return line.operands[0][0].value;
    }
    return undefined;
}

function getMacroParameterGroups(line: LineNode): Token[][] {
    if (!line.operands || line.operands.length === 0) return [];
    if (line.label === undefined) {
        const firstGroupRemaining = line.operands[0].slice(1);
        const groups: Token[][] = [];
        if (firstGroupRemaining.length > 0) {
            groups.push(firstGroupRemaining);
        }
        groups.push(...line.operands.slice(1));
        return groups;
    } else {
        return line.operands;
    }
}

function getMacroParameters(line: LineNode, dialect: CpuDialect): ReadonlySet<string> {
    const groups = getMacroParameterGroups(line);
    const set = new Set<string>();
    for (const group of groups) {
        for (const token of group) {
            if (token.type === TokenType.Identifier && (dialect === CpuDialect.EZ80 || token.value.startsWith('#'))) {
                set.add(token.value);
                set.add(token.value.toLowerCase());
            }
        }
    }
    return set;
}

function isMacroLocalOperand(operand: readonly Token[]): boolean {
    return operand.some((token) =>
        token.type === TokenType.Dot ||
        token.type === TokenType.Identifier && token.value.startsWith('@')
    );
}

// A pure dotted local-label reference (`..name`, `.name`): every token but
// the last is a Dot and the last is an Identifier. The expression grammar
// cannot parse multi-dot refs, but they are legal macro-local label
// references, so operand-syntax failures on exactly this shape are
// tolerated while any other malformed operand is a genuine syntax error.
function isDottedLabelReference(operand: readonly Token[]): boolean {
    if (operand.length === 0) return false;
    const last = operand[operand.length - 1];
    if (last.type !== TokenType.Identifier) return false;
    return operand.slice(0, -1).every((token) => token.type === TokenType.Dot);
}

// Macro-local labels resolve regardless of where in the body they are
// defined (the reference assembler is two-pass), so collect the whole
// body's labels when the macro opens instead of accumulating them as
// the scan progresses.
function collectMacroLocalDefs(document: AsmDocument, macroLine: number, dialect: CpuDialect): Set<string> {
    const defs = new Set<string>();
    const isTerminator = (mnemonic: string | undefined) =>
        mnemonic !== undefined &&
        (dialect === CpuDialect.EZ80 ? mnemonic === 'endmacro' : (mnemonic === 'endm' || mnemonic === 'endmacro'));
    let depth = 1;
    for (let i = macroLine + 1; i < document.lines.length; i++) {
        const bodyLine = document.lines[i];
        if (bodyLine.isInactive) continue;
        if (bodyLine.mnemonic === 'macro') {
            depth++;
            continue;
        }
        if (isTerminator(bodyLine.mnemonic)) {
            depth--;
            if (depth === 0) break;
            continue;
        }
        if (bodyLine.label && bodyLine.label !== '@@' && (bodyLine.label.startsWith('@') || bodyLine.label.startsWith('.'))) {
            defs.add(bodyLine.label);
        }
    }
    return defs;
}

function validateGenericDirectiveOperands(line: LineNode, lineIndex: number, dialect: CpuDialect): { diagnostics: Diagnostic[], handled: boolean, expectsExpression: boolean } {
    const diagnostics: Diagnostic[] = [];
    const operands = line.operands || [];
    const mnemonic = line.mnemonic!.toLowerCase().replace('.', '');
    const lineStart = line.start!;

    if (operands.some((operand) => operand.length === 0)) {
        diagnostics.push({
            line: lineIndex,
            message: `Directive '${mnemonic}' has an empty operand`,
            startCharacter: line.mnemonicToken ? (line.mnemonicToken.start - lineStart) : line.tokens[0]?.start !== undefined ? line.tokens[0].start - lineStart : undefined,
            length: line.mnemonicToken?.length ?? line.tokens[0]?.length
        });
        return { diagnostics, handled: true, expectsExpression: false };
    }

    const noParamDirectives = new Set(['bios', 'biosvars', 'rom', 'basic', 'msxdos', 'search', 'dephase', 'sinclair', 'zilog', 'endr', 'endm', 'endmacro', 'endrelocate', 'relocate', 'else', 'endif']);
    const oneParamDirectives = new Set(['org', 'page', 'start', 'phase', 'callbios', 'calldos', 'size', 'rept', 'print', 'printdec', 'printhex', 'equ']);
    const stringParamDirectives = new Set(['include', 'debug', 'printtext', 'printstring']);
    const optStringParamDirectives = new Set(['cas', 'cassette', 'wav', 'filename']);
    const optParamDirectives = new Set(['break', 'breakpoint']);
    if (line.isAsmsx && (mnemonic === 'byte' || mnemonic === 'word')) {
        if (operands.length > 0) {
            diagnostics.push({
                line: lineIndex,
                message: `Directive '${mnemonic}' does not take any operands`,
                startCharacter: line.mnemonicToken ? (line.mnemonicToken.start - lineStart) : undefined,
                length: line.mnemonicToken?.length
            });
        }
        return { diagnostics, handled: true, expectsExpression: false };
    }
    if (noParamDirectives.has(mnemonic)) {
        if (operands.length > 0) {
            diagnostics.push({
                line: lineIndex,
                message: `Directive '${mnemonic}' does not take any operands`,
                startCharacter: line.mnemonicToken ? (line.mnemonicToken.start - lineStart) : undefined,
                length: line.mnemonicToken?.length
            });
        }
        return { diagnostics, handled: true, expectsExpression: false };
    }

    if (mnemonic === 'macro') {
        if (!hasMacroName(line)) {
            diagnostics.push({
                line: lineIndex,
                message: "MACRO requires a macro name",
                startCharacter: line.mnemonicToken ? line.mnemonicToken.start - lineStart : undefined,
                length: line.mnemonicToken?.length
            });
        }
        return { diagnostics, handled: true, expectsExpression: false };
    }

    if (Object.hasOwn(DATA_WIDTHS, mnemonic) || STRING_DATA_DIRECTIVES.has(mnemonic)) {
        const maximumValue = DATA_WIDTHS[mnemonic] ?? 255;
        diagnostics.push(...validateNumericDirectiveOperands(
            operands, 1, Number.MAX_SAFE_INTEGER, lineIndex, lineStart, mnemonic, 0, maximumValue, "data value",
            STRING_DATA_DIRECTIVES.has(mnemonic), dialect
        ));
        return { diagnostics, handled: true, expectsExpression: true };
    }

    if (mnemonic === 'ds' || mnemonic === 'defs') {
        diagnostics.push(...validateNumericDirectiveOperands(
            operands, 1, 2, lineIndex, lineStart, mnemonic, 0, MAX_ADDR_EZ80, "storage count", false, dialect
        ));
        if (operands.length === 2) {
            diagnostics.push(...validateNumericDirectiveOperands(
                [operands[1]], 1, 1, lineIndex, lineStart, mnemonic, 0, 255, "fill byte", false, dialect
            ));
        }
        return { diagnostics, handled: true, expectsExpression: true };
    }

    if (Object.hasOwn(BLOCK_WIDTHS, mnemonic)) {
        diagnostics.push(...validateNumericDirectiveOperands(
            operands, 1, 2, lineIndex, lineStart, mnemonic, 0, MAX_ADDR_EZ80, "storage count", false, dialect
        ));
        if (operands.length === 2) {
            diagnostics.push(...validateNumericDirectiveOperands(
                [operands[1]], 1, 1, lineIndex, lineStart, mnemonic, 0, BLOCK_WIDTHS[mnemonic], "fill value", false, dialect
            ));
        }
        return { diagnostics, handled: true, expectsExpression: true };
    }

    if (mnemonic === 'align') {
        diagnostics.push(...validateNumericDirectiveOperands(
            operands, 1, 2, lineIndex, lineStart, mnemonic, 1, MAX_ADDR_EZ80, "alignment boundary", false, dialect
        ));
        if (operands.length === 2) {
            diagnostics.push(...validateNumericDirectiveOperands(
                [operands[1]], 1, 1, lineIndex, lineStart, mnemonic, 0, 255, "fill byte", false, dialect
            ));
        }
        return { diagnostics, handled: true, expectsExpression: true };
    }

    if (mnemonic === 'fillbyte') {
        diagnostics.push(...validateNumericDirectiveOperands(
            operands, 1, 1, lineIndex, lineStart, mnemonic, 0, 255, "fill byte", false, dialect
        ));
        return { diagnostics, handled: true, expectsExpression: true };
    }

    if (mnemonic === 'fpos') {
        diagnostics.push(...validateNumericDirectiveOperands(
            operands, 1, 1, lineIndex, lineStart, mnemonic, 0, MAX_ADDR_Z80, "file offset", false, dialect
        ));
        return { diagnostics, handled: true, expectsExpression: true };
    }

    if (mnemonic === 'rb' || mnemonic === 'rw' || mnemonic === 'rl' || mnemonic === 'rs') {
        if (!line.label) {
            diagnostics.push({
                line: lineIndex,
                message: `Directive '${mnemonic}' requires a label`,
                startCharacter: line.mnemonicToken ? line.mnemonicToken.start - lineStart : undefined,
                length: line.mnemonicToken?.length
            });
        }
        diagnostics.push(...validateNumericDirectiveOperands(
            operands, 1, 1, lineIndex, lineStart, mnemonic, 0, MAX_ADDR_Z80, "reservation count", false, dialect
        ));
        return { diagnostics, handled: true, expectsExpression: true };
    }
    
    if (mnemonic === 'printfix') {
        if (operands.length !== 1) {
            diagnostics.push({
                line: lineIndex,
                message: `Directive '${mnemonic}' requires exactly one floating point operand`,
                startCharacter: line.mnemonicToken ? (line.mnemonicToken.start - lineStart) : undefined,
                length: line.mnemonicToken?.length
            });
        } else if (operands[0].length === 1 && operands[0][0].type === TokenType.String) {
            diagnostics.push({
                line: lineIndex,
                message: `Directive '${mnemonic}' expects a floating point value, not a string`,
                startCharacter: operands[0][0].start - lineStart,
                length: operands[0][0].length
            });
        }
        return { diagnostics, handled: true, expectsExpression: false };
    }

    if (oneParamDirectives.has(mnemonic)) {
        if (operands.length !== 1) {
            diagnostics.push({
                line: lineIndex,
                message: `Directive '${mnemonic}' requires exactly one operand`,
                startCharacter: line.mnemonicToken ? (line.mnemonicToken.start - lineStart) : undefined,
                length: line.mnemonicToken?.length
            });
        } else if (operands[0].length === 1 && operands[0][0].type === TokenType.String) {
            diagnostics.push({
                line: lineIndex,
                message: `Directive '${mnemonic}' expects a numeric expression, not a string`,
                startCharacter: operands[0][0].start - lineStart,
                length: operands[0][0].length
            });
        }
        return { diagnostics, handled: true, expectsExpression: true };
    }

    if (stringParamDirectives.has(mnemonic)) {
        if (operands.length !== 1) {
            diagnostics.push({
                line: lineIndex,
                message: `Directive '${mnemonic}' requires exactly one string operand`,
                startCharacter: line.mnemonicToken ? (line.mnemonicToken.start - lineStart) : undefined,
                length: line.mnemonicToken?.length
            });
        } else if (operands[0].length !== 1 || operands[0][0].type !== TokenType.String) {
            diagnostics.push({
                line: lineIndex,
                message: `Directive '${mnemonic}' expects a string operand`,
                startCharacter: operands[0][0].start - lineStart,
                length: operands[0][operands[0].length - 1].start + operands[0][operands[0].length - 1].length - operands[0][0].start
            });
        }
        return { diagnostics, handled: true, expectsExpression: false };
    }

    if (optStringParamDirectives.has(mnemonic)) {
        if (operands.length > 1) {
            diagnostics.push({
                line: lineIndex,
                message: `Directive '${mnemonic}' takes at most one string operand`,
                startCharacter: line.mnemonicToken ? (line.mnemonicToken.start - lineStart) : undefined,
                length: line.mnemonicToken?.length
            });
        } else if (operands.length === 1 && (operands[0].length !== 1 || operands[0][0].type !== TokenType.String)) {
            diagnostics.push({
                line: lineIndex,
                message: `Directive '${mnemonic}' expects a string operand if provided`,
                startCharacter: operands[0][0].start - lineStart,
                length: operands[0][operands[0].length - 1].start + operands[0][operands[0].length - 1].length - operands[0][0].start
            });
        }
        return { diagnostics, handled: true, expectsExpression: false };
    }

    if (optParamDirectives.has(mnemonic)) {
        if (operands.length > 1) {
            diagnostics.push({
                line: lineIndex,
                message: `Directive '${mnemonic}' takes at most one operand`,
                startCharacter: line.mnemonicToken ? (line.mnemonicToken.start - lineStart) : undefined,
                length: line.mnemonicToken?.length
            });
        } else if (operands.length === 1 && operands[0].length === 1 && operands[0][0].type === TokenType.String) {
            diagnostics.push({
                line: lineIndex,
                message: `Directive '${mnemonic}' expects a numeric expression if provided, not a string`,
                startCharacter: operands[0][0].start - lineStart,
                length: operands[0][0].length
            });
        }
        return { diagnostics, handled: true, expectsExpression: true };
    }

    if (mnemonic === 'megarom') {
        if (operands.length === 0) {
            diagnostics.push({
                line: lineIndex,
                message: `Directive 'megarom' requires a mapper type operand`,
                startCharacter: line.mnemonicToken ? (line.mnemonicToken.start - lineStart) : undefined,
                length: line.mnemonicToken?.length
            });
        } else if (operands.length > 1) {
            diagnostics.push({
                line: lineIndex,
                message: `Directive 'megarom' takes exactly one operand`,
                startCharacter: line.mnemonicToken ? (line.mnemonicToken.start - lineStart) : undefined,
                length: line.mnemonicToken?.length
            });
        } else if (operands[0].length !== 1 || operands[0][0].type !== TokenType.Identifier || !['konami', 'konamiscc', 'ascii8', 'ascii16'].includes(operands[0][0].value.toLowerCase())) {
            diagnostics.push({
                line: lineIndex,
                message: `Invalid mapper type. Expected KONAMI, KONAMISCC, ASCII8, or ASCII16`,
                startCharacter: operands[0][0].start - lineStart,
                length: operands[0][operands[0].length - 1].start + operands[0][operands[0].length - 1].length - operands[0][0].start
            });
        }
        return { diagnostics, handled: true, expectsExpression: false };
    }

    if (mnemonic === 'subpage' || mnemonic === 'select') {
        const formatDiagnostic = () => ({
            line: lineIndex,
            message: `Directive '${mnemonic}' requires format: <n> at <address>`,
            startCharacter: line.mnemonicToken ? (line.mnemonicToken.start - lineStart) : undefined,
            length: line.mnemonicToken?.length
        });
        if (operands.length !== 1 || operands[0].length < 3) {
            diagnostics.push(formatDiagnostic());
            return { diagnostics, handled: true, expectsExpression: false };
        }
        // Reference grammar (dura.y): PSEUDO_SUBPAGE value PSEUDO_AT value —
        // exactly one 'at', strictly interior, with parseable expressions
        // on both sides.
        const tokens = operands[0];
        const atIndices: number[] = [];
        for (let j = 0; j < tokens.length; j++) {
            if (tokens[j].type === TokenType.Identifier && tokens[j].value.toLowerCase() === 'at') {
                atIndices.push(j);
            }
        }
        const parsesAsExpression = (side: Token[]) => {
            try {
                new ExpressionParser(side, dialect).parse();
                return true;
            } catch {
                return false;
            }
        };
        if (atIndices.length !== 1 || atIndices[0] === 0 || atIndices[0] === tokens.length - 1) {
            diagnostics.push(formatDiagnostic());
            return { diagnostics, handled: true, expectsExpression: false };
        }
        const atIndex = atIndices[0];
        if (!parsesAsExpression(tokens.slice(0, atIndex)) || !parsesAsExpression(tokens.slice(atIndex + 1))) {
            diagnostics.push(formatDiagnostic());
            return { diagnostics, handled: true, expectsExpression: false };
        }
        for (const token of tokens) {
            if (token.type === TokenType.String) {
                diagnostics.push({
                    line: lineIndex,
                    message: `Directive '${mnemonic}' expects numeric expressions, not strings`,
                    startCharacter: token.start - lineStart,
                    length: token.length
                });
            }
        }
        return { diagnostics, handled: true, expectsExpression: false };
    }

    if (mnemonic === 'incbin' || mnemonic === 'insert') {
        if (operands.length === 0) {
            diagnostics.push({
                line: lineIndex,
                message: `Directive '${mnemonic}' requires a string filename`,
                startCharacter: line.mnemonicToken ? (line.mnemonicToken.start - lineStart) : undefined,
                length: line.mnemonicToken?.length
            });
            return { diagnostics, handled: true, expectsExpression: false };
        }
        if (operands[0][0].type !== TokenType.String) {
             diagnostics.push({
                line: lineIndex,
                message: `Directive '${mnemonic}' expects a string filename as first argument`,
                startCharacter: operands[0][0].start - lineStart,
                length: operands[0][0].length
            });
        }
        let j = 1;
        while (j < operands[0].length) {
            const token = operands[0][j];
            if (token.type === TokenType.String) {
                diagnostics.push({
                    line: lineIndex,
                    message: `Directive '${mnemonic}' optional parameters skip and size must be numeric`,
                    startCharacter: token.start - lineStart,
                    length: token.length
                });
                j++;
            } else if (token.type === TokenType.Identifier) {
                const val = token.value.toLowerCase();
                if (val === 'skip' || val === 'size') {
                    if (j + 1 >= operands[0].length) {
                        diagnostics.push({
                            line: lineIndex,
                            message: `Directive '${mnemonic}' parameter '${val}' expects a numeric value`,
                            startCharacter: token.start - lineStart,
                            length: token.length
                        });
                        break;
                    }
                    
                    j++;
                    const exprTokens: Token[] = [];
                    while (j < operands[0].length && !(operands[0][j].type === TokenType.Identifier && (operands[0][j].value.toLowerCase() === 'skip' || operands[0][j].value.toLowerCase() === 'size'))) {
                        exprTokens.push(operands[0][j]);
                        j++;
                    }
                    
                    if (exprTokens.length > 0) {
                        try {
                            const parser = new ExpressionParser(exprTokens, dialect);
                            const ast = parser.parse();
                            if (isConstantExpression(ast)) {
                                const evalValue = evaluate(ast, () => undefined, 0);
                                if (val === 'skip' && evalValue < 0) {
                                    diagnostics.push({
                                        line: lineIndex,
                                        message: `SKIP parameter cannot be negative`,
                                        startCharacter: exprTokens[0].start - lineStart,
                                        length: exprTokens[exprTokens.length - 1].start + exprTokens[exprTokens.length - 1].length - exprTokens[0].start
                                    });
                                } else if (val === 'size' && evalValue <= 0) {
                                    diagnostics.push({
                                        line: lineIndex,
                                        message: `SIZE parameter must be strictly positive`,
                                        startCharacter: exprTokens[0].start - lineStart,
                                        length: exprTokens[exprTokens.length - 1].start + exprTokens[exprTokens.length - 1].length - exprTokens[0].start
                                    });
                                }
                            }
                        } catch (err: unknown) {
                            const msg = err instanceof Error ? err.message : String(err);
                            diagnostics.push({
                                line: lineIndex,
                                message: `Invalid expression for parameter '${val}': ${msg}`,
                                startCharacter: exprTokens[0].start - lineStart,
                                length: exprTokens[exprTokens.length - 1].start + exprTokens[exprTokens.length - 1].length - exprTokens[0].start
                            });
                        }
                    } else {
                        diagnostics.push({
                            line: lineIndex,
                            message: `Directive '${mnemonic}' parameter '${val}' expects a numeric value`,
                            startCharacter: token.start - lineStart,
                            length: token.length
                        });
                    }
                } else {
                    diagnostics.push({
                        line: lineIndex,
                        message: `Unknown parameter '${val}' for directive '${mnemonic}'. Expected SKIP or SIZE.`,
                        startCharacter: token.start - lineStart,
                        length: token.length
                    });
                    j++;
                }
            } else {
                diagnostics.push({
                    line: lineIndex,
                    message: `Unexpected token in '${mnemonic}' directive`,
                    startCharacter: token.start - lineStart,
                    length: token.length
                });
                j++;
            }
        }
        return { diagnostics, handled: true, expectsExpression: false };
    }
    
    return { diagnostics, handled: false, expectsExpression: false };
}

export function validateInstructionOperands(
    operands: Token[][],
    mnemonic: string,
    meta: { signature: string },
    dialect: CpuDialect,
    isAsmsxSyntax: boolean
): ValidationResult {
    if (!meta.signature) return { error: null, sigOps: null };

    const overloads = meta.signature.split('|').map(s => s.trim());
    const expectedCounts = new Set<number>();
    const parsedOverloads: string[][] = [];
    
    for (const overload of overloads) {
        const parts = overload.split(/\s+/);
        // "ADC" "A," "s" -> skip mnemonic
        const sigOpsStr = parts.slice(1).join('');
        const sigOps = sigOpsStr ? sigOpsStr.split(',') : [];
        expectedCounts.add(sigOps.length);
        parsedOverloads.push(sigOps);
        
        if (matchOverload(operands, sigOps, mnemonic, dialect, isAsmsxSyntax)) {
            return { error: null, sigOps }; // found a match!
        }
    }

    if (!expectedCounts.has(operands.length)) {
        const counts = Array.from(expectedCounts).sort((a, b) => a - b);
        const expectedCountStr = counts.length === 1 ? counts[0].toString() : counts.join(' or ');
        return { error: `Instruction '${mnemonic}' expects ${expectedCountStr} operand${expectedCountStr === '1' ? '' : 's'}, but got ${operands.length}`, sigOps: null };
    }

    const matchingCountOverloads = parsedOverloads.filter(sigOps => sigOps.length === operands.length);
    if (matchingCountOverloads.length === 1) {
        const sigOps = matchingCountOverloads[0];
        for (let i = 0; i < operands.length; i++) {
            if (!matchOperand(operands[i], sigOps[i], mnemonic, dialect, isAsmsxSyntax)) {
                return { error: `Operand ${i + 1} of '${mnemonic}' must be ${sigOps[i]}`, errorIndex: i, sigOps: null };
            }
        }
    } else if (matchingCountOverloads.length > 1) {
        for (let prefixLen = operands.length - 1; prefixLen >= 0; prefixLen--) {
            const partialMatches = matchingCountOverloads.filter(sigOps => {
                for (let i = 0; i < prefixLen; i++) {
                    if (!matchOperand(operands[i], sigOps[i], mnemonic, dialect, isAsmsxSyntax)) return false;
                }
                return true;
            });
            if (partialMatches.length > 0) {
                const expectedOpts = Array.from(new Set(partialMatches.map(sigOps => sigOps[prefixLen])));
                return { error: `Operand ${prefixLen + 1} of '${mnemonic}' must be ${expectedOpts.join(' or ')}`, errorIndex: prefixLen, sigOps: null };
            }
        }
    }

    return { error: `Invalid operands for '${mnemonic}'. Expected one of: ${meta.signature}`, sigOps: null };
}

function matchOverload(operands: Token[][], sigOps: string[], mnemonic: string, dialect: CpuDialect, isAsmsxSyntax: boolean): boolean {
    if (operands.length !== sigOps.length) return false;
    for (let i = 0; i < operands.length; i++) {
        if (!matchOperand(operands[i], sigOps[i], mnemonic, dialect, isAsmsxSyntax)) {
            return false;
        }
    }
    return true;
}

function stringify(operand: Token[]): string {
    return operand.map(t => t.value).join('').toLowerCase();
}

function stripIndirect(operand: Token[]): Token[] {
    return operand.slice(1, -1);
}

function isExpr(operand: Token[], dialect: CpuDialect): boolean {
    if (operand.length === 0) return false;
    if (operand.length === 1) {
        const t = operand[0];
        if (t.type === TokenType.Number) return true;
        if (t.type === TokenType.String) return t.quote === "'" && !t.invalidEscape && t.value.length === 1;
        if (t.type === TokenType.Identifier) {
            if (isRegister(t.value, dialect)) return false;
            if (isConditionCode(t.value)) return false;
            return true;
        }
        return false;
    }

    try {
        new ExpressionParser(operand, dialect).parse();
        return true;
    } catch {
        return false;
    }
}

function isGroupedExpression(operand: Token[], dialect: CpuDialect, isAsmsxSyntax: boolean): boolean {
    if (operand.length < 3) return false;

    const first = operand[0].type;
    const last = operand[operand.length - 1].type;
    const isParenthesized = first === TokenType.LParen && last === TokenType.RParen;
    const isBracketed = first === TokenType.LBracket && last === TokenType.RBracket;
    if (!isParenthesized && !isBracketed) return false;
    if (isAsmsxSyntax && !isParenthesized) return false;

    const inner = stripIndirect(operand);
    return isExpr(inner, dialect) && !inner.some(token =>
        token.type === TokenType.Identifier &&
        INDIRECT_CAPABLE_REGISTERS.has(token.value.toLowerCase())
    );
}


function isSingleReg(operand: Token[], validRegs: string[]): boolean {
    if (operand.length !== 1) return false;
    if (operand[0].type !== TokenType.Identifier) return false;
    return validRegs.includes(operand[0].value.toLowerCase());
}

const REG_8 = ['a', 'b', 'c', 'd', 'e', 'h', 'l'];
const REG_INDEX_IX = ['ixh', 'ixl'];
const REG_INDEX_IY = ['iyh', 'iyl'];
const REG_DD = ['bc', 'de', 'hl', 'sp'];
const REG_SS = ['bc', 'de', 'hl', 'sp'];
const REG_PP = ['bc', 'de', 'ix', 'sp'];
const REG_RR = ['bc', 'de', 'iy', 'sp'];
const REG_QQ = ['af', 'bc', 'de', 'hl'];
const REG_LEA = ['bc', 'de', 'hl'];

function matchOperand(operand: Token[], sigPart: string, mnemonic: string, dialect: CpuDialect, isAsmsxSyntax: boolean): boolean {
    const indirect = isIndirectOperand(operand, isAsmsxSyntax);
    const inner = indirect ? stripIndirect(operand) : operand;
    const innerStr = stringify(inner);
    const opStr = stringify(operand);

    const groupedExpression = isGroupedExpression(operand, dialect, isAsmsxSyntax);

    const s = sigPart.toLowerCase();

    switch (s) {
        case 'a': case 'af': case 'af\'': case 'de': case 'hl': case 'sp':
        case 'ix': case 'iy':
            return !indirect && opStr === s;
            
        case '0':
            return !indirect && opStr === '0';

        case 'r': case 'r\'':
            if (sigPart === 'R') {
                return !indirect && opStr === 'r';
            }
            return !indirect && isSingleReg(operand, REG_8);
            
        case 'ss':
            return !indirect && isSingleReg(operand, REG_SS);
            
        case 'pp':
            return !indirect && isSingleReg(operand, REG_PP);
            
        case 'rr':
            return !indirect && isSingleReg(operand, REG_RR);
            
        case 'qq':
            return !indirect && isSingleReg(operand, REG_QQ);
        case 'kk':
            return !indirect && isSingleReg(operand, REG_LEA);


        case 'dd/pp/rr':
            return !indirect && (isSingleReg(operand, REG_DD) || isSingleReg(operand, REG_PP) || isSingleReg(operand, REG_RR));

        case 'n': case 'nn': case 'd': case 'e': case 'p': case 'b':
            return (!indirect || groupedExpression) && isExpr(operand, dialect);

        case 'nz/z/nc/c':
            return !indirect && operand.length === 1 && ['nz', 'z', 'nc', 'c'].includes(operand[0].value.toLowerCase());

        case 'cc':
            return !indirect && operand.length === 1 && isConditionCode(operand[0].value);

        case 's':
            if ((!indirect || groupedExpression) && (isSingleReg(operand, REG_8) || isSingleReg(operand, REG_INDEX_IX) || isSingleReg(operand, REG_INDEX_IY))) return true;
            if ((!indirect || groupedExpression) && isExpr(operand, dialect)) return true;
            if (indirect) {
                if (innerStr === 'hl') return true;
                if (innerStr.startsWith('ix') || innerStr.startsWith('iy')) return true;
            }
            return false;

        case 'm':
            if (!indirect && isSingleReg(operand, REG_8)) return true;
            if (indirect) {
                if (innerStr === 'hl') return true;
                if (innerStr.startsWith('ix') || innerStr.startsWith('iy')) return true;
            }
            return false;

        case 'x':
            return !indirect && isSingleReg(operand, REG_INDEX_IX);

        case 'x\'':
            return !indirect && isSingleReg(operand, REG_INDEX_IX);

        case 'y':
            return !indirect && isSingleReg(operand, REG_INDEX_IY);

        case 'y\'':
            return !indirect && isSingleReg(operand, REG_INDEX_IY);

        case '(hl)': return indirect && innerStr === 'hl';
        case '(bc)': return indirect && innerStr === 'bc';
        case '(de)': return indirect && innerStr === 'de';
        case '(ix)': return indirect && innerStr === 'ix';
        case '(iy)': return indirect && innerStr === 'iy';
        case '(c)': return indirect && innerStr === 'c';
        case '(sp)': return indirect && innerStr === 'sp';

        case '(ix+d)': return indirect && innerStr.startsWith('ix');
        case '(iy+d)': return indirect && innerStr.startsWith('iy');
        case '(ix/iy+d)': return indirect && (innerStr.startsWith('ix') || innerStr.startsWith('iy'));
        case 'ix+d': return !indirect && opStr.startsWith('ix');
        case 'iy+d': return !indirect && opStr.startsWith('iy');

        case '(n)':
        case '(nn)':
            return indirect && isExpr(inner, dialect);

        case '(bc/de/nn)':
            return indirect && (innerStr === 'bc' || innerStr === 'de' || isExpr(inner, dialect));

        case 'r/n':
            return (!indirect || groupedExpression) && (isSingleReg(operand, REG_8) || isExpr(operand, dialect));

        case 'hl/ix/iy':
            return !indirect && (opStr === 'hl' || opStr === 'ix' || opStr === 'iy');

        default:
            return opStr === s;
    }
}

function extractIndexOffset(ast: ASTNode): number | null {
    if (ast.type === 'BinaryOp') {
        const bin = ast as BinaryOpNode;
        let constExpr: ASTNode | null = null;
        const isMinus = bin.op === '-';
        if (bin.op === '+' || bin.op === '-') {
            if (bin.left.type === 'Symbol' && ['ix', 'iy'].includes((bin.left as SymbolNode).name.toLowerCase())) {
                constExpr = bin.right;
            } else if (bin.op === '+' && bin.right.type === 'Symbol' && ['ix', 'iy'].includes((bin.right as SymbolNode).name.toLowerCase())) {
                constExpr = bin.left;
            }
        }
        if (constExpr && isConstantExpression(constExpr)) {
            const val = evaluate(constExpr, () => undefined, 0);
            return isMinus ? -val : val;
        }
    }
    return null;
}
