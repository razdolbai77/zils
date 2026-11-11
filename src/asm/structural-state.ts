import { AsmDocument, Diagnostic } from "./document";
import { Token, TokenType } from "./lexer";
import { CpuDialect, CpuTarget, ZILOG_DIRECTIVE } from "./metadata";
import { LineNode } from "./line-parser";

// Structural state machine for cpu/relocate/if/macro/zilog tracking,
// extracted from collectDiagnostics so the control-flow bookkeeping lives
// in one explicit object instead of closure-local variables.

const CPU_TARGETS: ReadonlyMap<string, CpuTarget> = new Map([
    ['z80', CpuTarget.Z80],
    ['z180', CpuTarget.Z180],
    ['ez80', CpuTarget.EZ80]
]);

export interface StructuralFrame {
    line: number;
    token: Token | undefined;
}

export interface MacroFrame extends StructuralFrame {
    name?: string;
    parameters: ReadonlySet<string>;
    localDefs: Set<string>;
}

export interface StructuralState {
    isAsmsxSyntax: boolean;
    scopeLabel: string;
    cpu: CpuTarget;
    relocateStack: StructuralFrame[];
    reptStack: StructuralFrame[];
    ifDepth: number;
    ifStack: StructuralFrame[];
    macroDepth: number;
    macroStack: MacroFrame[];
    invalidMacros: Set<string>;
    deferredMacroInvocations: { line: number; token: Token | undefined; name: string }[];
}

export function createStructuralState(document: AsmDocument): StructuralState {
    return {
        isAsmsxSyntax: document.isAsmsx,
        scopeLabel: "",
        cpu: document.dialect === CpuDialect.EZ80 ? CpuTarget.EZ80 : CpuTarget.Z80,
        relocateStack: [],
        reptStack: [],
        ifDepth: 0,
        ifStack: [],
        macroDepth: 0,
        macroStack: [],
        invalidMacros: new Set(),
        deferredMacroInvocations: []
    };
}

// Every diagnostic reported inside a macro body invalidates the enclosing
// macro definitions so later invocations are refused.
export function markOpenMacrosInvalid(state: StructuralState): void {
    for (const frame of state.macroStack) {
        if (frame.name) {
            state.invalidMacros.add(frame.name);
        }
    }
}

export interface StructuralStep {
    line: LineNode;
    lineIndex: number;
    emit: (diag: Diagnostic) => void;
    // Like emit, but also marks enclosing macros invalid.
    emitMarking: (diag: Diagnostic) => void;
}

function advanceMacroTransition(
    state: StructuralState,
    document: AsmDocument,
    step: StructuralStep
): void {
    const { line, lineIndex: i, emit, emitMarking } = step;

    // Push even without a name so the terminator still pairs and later
    // endm/endmacro lines are not reported as unmatched. The missing
    // name itself is diagnosed by validateGenericDirectiveOperands.
    if (line.mnemonic === 'macro') {
        const currentMacroName = getMacroName(line);
        const pushHeaderDiag = (diag: Diagnostic) => {
            emitMarking(diag);
            if (currentMacroName) {
                state.invalidMacros.add(currentMacroName);
            }
        };

        if (state.macroDepth > 0) {
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
        state.macroDepth++;
        state.macroStack.push({ line: i, token: line.mnemonicToken, name: currentMacroName, parameters: getMacroParameters(line, document.dialect), localDefs: collectMacroLocalDefs(document, i, document.dialect) });
    }

    const isEndMacro = line.mnemonic && (document.dialect === CpuDialect.EZ80 ? line.mnemonic === 'endmacro' : (line.mnemonic === 'endm' || line.mnemonic === 'endmacro'));
    if (isEndMacro && line.mnemonic) {
        if (state.macroDepth === 0) {
            emit({
                line: i,
                message: `${line.mnemonic.toUpperCase()} without matching MACRO`,
                startCharacter: line.mnemonicToken ? line.mnemonicToken.start - line.start! : undefined,
                length: line.mnemonicToken?.length
            });
        } else {
            state.macroDepth--;
            state.macroStack.pop();
        }
    }
}

function advanceConditionalState(state: StructuralState, step: StructuralStep): boolean {
    const { line, lineIndex: i, emit } = step;

    if (line.mnemonic === 'if' || line.mnemonic === 'ifdef' || line.mnemonic === 'ifndef') {
        state.ifDepth++;
        state.ifStack.push({ line: i, token: line.mnemonicToken });
        return true;
    }
    if (line.mnemonic === 'else') {
        if (state.ifDepth === 0) {
            emit({
                line: i,
                message: "ELSE without matching IF",
                startCharacter: line.mnemonicToken ? line.mnemonicToken.start - line.start! : undefined,
                length: line.mnemonicToken?.length
            });
        }
        return true;
    }
    if (line.mnemonic === 'endif') {
        if (state.ifDepth === 0) {
            emit({
                line: i,
                message: "ENDIF without matching IF",
                startCharacter: line.mnemonicToken ? line.mnemonicToken.start - line.start! : undefined,
                length: line.mnemonicToken?.length
            });
        } else {
            state.ifDepth--;
            state.ifStack.pop();
        }
        return true;
    }

    return false;
}

// Applies one line to the state machine. Returns 'continue' when the line
// is purely structural (the caller must skip its remaining per-line checks)
// and 'fell-through' when the caller must keep validating the line.
export function advanceStructuralState(state: StructuralState, document: AsmDocument, step: StructuralStep): 'continue' | 'fell-through' {
    const { line, lineIndex: i, emit } = step;

    if (line.label && !line.label.startsWith('@') && !line.label.startsWith('.')) {
        state.scopeLabel = line.label;
    }
    if (line.mnemonic === ZILOG_DIRECTIVE) {
        state.isAsmsxSyntax = false;
    }
    if (line.mnemonic === 'cpu') {
        const operand = line.operands?.[0];
        const cpu = operand?.length === 1 && operand[0].type === TokenType.Identifier
            ? CPU_TARGETS.get(operand[0].value.toLowerCase())
            : undefined;
        if (cpu === undefined) {
            emit({
                line: i,
                message: "CPU directive expects Z80, Z180, or EZ80",
                startCharacter: line.mnemonicToken ? line.mnemonicToken.start - line.start! : undefined,
                length: line.mnemonicToken?.length
            });
        } else {
            state.cpu = cpu;
        }
        return 'continue';
    }
    if (line.mnemonic === 'relocate') {
        state.relocateStack.push({ line: i, token: line.mnemonicToken });
        return 'continue';
    }
    if (line.mnemonic === 'endrelocate') {
        if (state.relocateStack.length === 0) {
            emit({
                line: i,
                message: "ENDRELOCATE without matching RELOCATE",
                startCharacter: line.mnemonicToken ? line.mnemonicToken.start - line.start! : undefined,
                length: line.mnemonicToken?.length
            });
        } else if (state.relocateStack.length > 1) {
            const nested = state.relocateStack.pop()!;
            emit({
                line: nested.line,
                message: "RELOCATE blocks cannot be nested",
                startCharacter: nested.token ? nested.token.start - document.lines[nested.line].start! : undefined,
                length: nested.token?.length
            });
        } else {
            state.relocateStack.pop();
        }
        return 'continue';
    }
    if (advanceConditionalState(state, step)) {
        return 'continue';
    }
    if (line.mnemonic === 'rept') {
        state.reptStack.push({ line: i, token: line.mnemonicToken });
    }
    if (line.mnemonic === 'endr') {
        if (state.reptStack.length === 0) {
            emit({
                line: i,
                message: "ENDR without matching REPT",
                startCharacter: line.mnemonicToken ? line.mnemonicToken.start - line.start! : undefined,
                length: line.mnemonicToken?.length
            });
        } else {
            state.reptStack.pop();
        }
    }
    advanceMacroTransition(state, document, step);
    return 'fell-through';
}

// Reports blocks left open at end of file and defers macro-invocation
// diagnostics until every definition has been seen.
export function finalizeStructuralState(
    state: StructuralState,
    document: AsmDocument,
    emit: (diag: Diagnostic) => void,
    emitMarking: (diag: Diagnostic) => void
): void {
    for (const unclosed of state.relocateStack) {
        emit({
            line: unclosed.line,
            message: "RELOCATE without matching ENDRELOCATE",
            startCharacter: unclosed.token ? unclosed.token.start - document.lines[unclosed.line].start! : undefined,
            length: unclosed.token?.length
        });
    }
    for (const unclosed of state.reptStack) {
        emit({
            line: unclosed.line,
            message: "REPT without matching ENDR",
            startCharacter: unclosed.token ? unclosed.token.start - document.lines[unclosed.line].start! : undefined,
            length: unclosed.token?.length
        });
    }


    for (const unclosed of state.ifStack) {
        emit({
            line: unclosed.line,
            message: "IF without matching ENDIF",
            startCharacter: unclosed.token ? unclosed.token.start - document.lines[unclosed.line].start! : undefined,
            length: unclosed.token?.length
        });
    }

    for (const unclosed of state.macroStack) {
        const expectedTerminator = document.dialect === CpuDialect.EZ80 ? "ENDMACRO" : "ENDM";
        emitMarking({
            line: unclosed.line,
            message: `MACRO without matching ${expectedTerminator}`,
            startCharacter: unclosed.token ? unclosed.token.start - document.lines[unclosed.line].start! : undefined,
            length: unclosed.token?.length
        });
    }
    for (const invocation of state.deferredMacroInvocations) {
        if (!state.invalidMacros.has(invocation.name)) {
            continue;
        }
        emitMarking({
            line: invocation.line,
            message: `Cannot invoke macro '${invocation.name}' because its definition contains errors`,
            startCharacter: invocation.token ? invocation.token.start - document.lines[invocation.line].start! : undefined,
            length: invocation.token?.length
        });
    }
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
