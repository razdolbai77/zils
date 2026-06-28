import { IndexedWorkspace } from "./workspace";
import { Diagnostic, AsmDocument } from "./document";
import { getInstructionMetadata, isRegister, isConditionCode } from "./metadata";
import { ExpressionParser, ASTNode, SymbolNode, UnaryOpNode, BinaryOpNode } from "./expressions";
import { TokenType } from "./lexer";

export function collectDiagnostics(workspace: IndexedWorkspace, uri: string): Diagnostic[] {
    const document = workspace.documents.get(uri);
    if (!document) return [];

    const diagnostics: Diagnostic[] = [];
    const localDefinitions = new Set<string>();
    
    // First pass: collect local definitions and detect duplicates within file
    for (let i = 0; i < document.lines.length; i++) {
        const line = document.lines[i];
        if (line.label) {
            const name = line.label;
            if (name.startsWith('.')) {
                // To keep it simple, we don't fully resolve global-local context here,
                // but rely on workspace symbols for full resolution. 
                // Just add to local definitions as a heuristic.
            }
            if (localDefinitions.has(name)) {
                diagnostics.push({ line: i, message: `Duplicate symbol definition: ${name}` });
            } else {
                localDefinitions.add(name);
            }
        }
    }

    for (let i = 0; i < document.lines.length; i++) {
        const line = document.lines[i];

        if (line.error) {
            diagnostics.push({ line: i, message: line.error });
            continue;
        }

        if (line.mnemonic && !line.isDirective) {
            const meta = getInstructionMetadata(line.mnemonic);
            if (!meta) {
                diagnostics.push({ line: i, message: `Unknown instruction: ${line.mnemonic}` });
            } else {
                if (!meta.supportedDialects.includes(document.dialect)) {
                    diagnostics.push({ line: i, message: `Instruction '${line.mnemonic}' is not supported in dialect ${document.dialect}` });
                }
            }
        }

        if (line.operands) {
            for (const operand of line.operands) {
                // If the operand is purely a string, don't parse it as an expression
                if (operand.length === 1 && operand[0].type === TokenType.String) continue;

                try {
                    const parser = new ExpressionParser(operand);
                    const ast = parser.parse();
                    
                    const unresolved = findUnresolvedSymbols(ast, document, workspace, localDefinitions);
                    for (const sym of unresolved) {
                        diagnostics.push({ line: i, message: `Unresolved symbol: ${sym}` });
                    }
                } catch (e: unknown) {
                    diagnostics.push({ line: i, message: `Wrong operand form: ${e instanceof Error ? e.message : String(e)}` });
                }
            }
        }
    }

    return diagnostics;
}

function findUnresolvedSymbols(node: ASTNode, document: AsmDocument, workspace: IndexedWorkspace, localDefs: Set<string>): string[] {
    const unresolved: string[] = [];

    function traverse(n: ASTNode) {
        if (n.type === 'Symbol') {
            const name = (n as SymbolNode).name;
            if (!isRegister(name, document.dialect) && 
                !isConditionCode(name) && 
                !workspace.symbols.has(name) &&
                !localDefs.has(name) &&
                // A very simple workaround for local labels that might be prefixed
                !name.startsWith('.')) {
                unresolved.push(name);
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
