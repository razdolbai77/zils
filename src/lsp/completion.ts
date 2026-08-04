import {
  CompletionItem,
  CompletionItemKind
} from "vscode-languageserver/node";

import { AsmDocument } from "../asm/document";
import { Lexer, Token, TokenType } from "../asm/lexer";
import {
  DIRECTIVES,
  INSTRUCTIONS,
  CONDITIONAL_INSTRUCTIONS
} from "../asm/metadata";
import { getCachedCollector } from "../asm/symbol-cache";


function isDirectiveSupported(document: AsmDocument, directive: string): boolean {
  return DIRECTIVES.get(directive)?.supportedDialects.includes(document.dialect) ?? false;
}

function getGlobalScope(document: AsmDocument, line: number): string | undefined {
  for (let index = line; index >= 0; index--) {
    const label = document.lines[index]?.label;
    if (label !== undefined && !label.startsWith("@") && !label.startsWith(".")) {
      return label;
    }
  }

  return undefined;
}

function isLocalLabelSupported(document: AsmDocument, label: string): boolean {
  if (label.startsWith("@")) {
    return !document.isAsmsx || label.startsWith("@@");
  }

  return document.isAsmsx && label.startsWith(".");
}

function getOperandPrefix(tokens: Token[], lineText: string, character: number): string | undefined {
  const tokenIndex = tokens.findIndex(
    (token) =>
      (token.type === TokenType.Identifier || token.type === TokenType.Dot) &&
      token.start < character &&
      character <= token.start + token.length
  );
  if (tokenIndex < 0) {
    return undefined;
  }

  const token = tokens[tokenIndex];
  if (tokenIndex === 0) {
    const prefix = lineText.slice(token.start, character);
    return token.type === TokenType.Dot || prefix.startsWith("@") ? prefix : undefined;
  }

  if (!tokens.slice(0, tokenIndex).some((token) => token.type === TokenType.Identifier)) {
    return undefined;
  }
  if (token.type === TokenType.Dot) {
    return ".";
  }

  const previousToken = tokens[tokenIndex - 1];
  const prefix = lineText.slice(token.start, character);
  return previousToken?.type === TokenType.Dot &&
    previousToken.start + previousToken.length === token.start
    ? `.${prefix}`
    : prefix;
}

function matchesCompletionPrefix(label: string, prefix: string | undefined): boolean {
  return prefix === undefined || label.toLowerCase().startsWith(prefix.toLowerCase());
}

function getConditionalInstructionMetadata(
  document: AsmDocument,
  tokens: Token[],
  line: number,
  character: number
) {
  if (tokens.some((token) => token.type === TokenType.Comma && token.start < character)) {
    return undefined;
  }

  const mnemonic = document.lines[line]?.mnemonic;
  return mnemonic === undefined ? undefined : CONDITIONAL_INSTRUCTIONS[mnemonic];
}

export function buildCompletionItems(
  openDocuments: ReadonlyMap<string, AsmDocument>,
  uri: string,
  line: number,
  character: number
): CompletionItem[] {
  const document = openDocuments.get(uri);
  if (document === undefined) {
    return [];
  }

  const lines = document.source.split(/\r?\n/);
  const lineText = lines[line];
  if (lineText === undefined) {
    return [];
  }

  const lexer = new Lexer(lineText);
  const tokens = lexer.tokenize();
  const operandPrefix = getOperandPrefix(tokens, lineText, character);
  const isLocalLabelRequest = operandPrefix?.startsWith("@") === true ||
    operandPrefix?.startsWith(".") === true;
  const conditionalInstruction = getConditionalInstructionMetadata(document, tokens, line, character);

  // A cursor at or inside a comment gets no completions.
  for (const token of tokens) {
    if (token.type === TokenType.Comment && character >= token.start) {
      return [];
    }
  }

  // Classify by the parsed mnemonic token instead of "any identifier seen":
  // the cursor is in operand context only once it sits past the mnemonic.
  // LineNode token offsets are document-absolute, so subtract the line start.
  const lineNode = document.lines[line];
  const mnemonicToken = lineNode?.mnemonicToken;
  let isOperandContext: boolean;
  if (mnemonicToken === undefined) {
    isOperandContext = false;
  } else {
    const mnemonicStart = mnemonicToken.start - (lineNode?.start ?? 0);
    const mnemonicEnd = mnemonicStart + mnemonicToken.length;
    if (character > mnemonicEnd) {
      isOperandContext = true;
    } else {
      // Inside an @/.-prefixed token the user is typing a local label or
      // macro name, not a mnemonic: keep operand completions.
      isOperandContext = character > mnemonicStart &&
        (mnemonicToken.value.startsWith("@") || mnemonicToken.value.startsWith("."));
    }
  }

  const completions: CompletionItem[] = [];
  const seen = new Set<string>();

  const addCompletion = (
    label: string,
    kind: CompletionItemKind,
    insertText: string | undefined = undefined,
    textEdit: CompletionItem["textEdit"] | undefined = undefined,
    filterText: string | undefined = undefined
  ) => {
    if (!seen.has(label)) {
      seen.add(label);
      if (textEdit !== undefined) {
        completions.push({ label, kind, textEdit, filterText });
      } else {
        completions.push(insertText === undefined ? { label, kind } : { label, kind, insertText });
      }
    }
  };

  if (!isOperandContext) {
    for (const [mnemonic, meta] of INSTRUCTIONS.entries()) {
      if (!meta.isDialectSpecific || meta.supportedDialects.includes(document.dialect)) {
        addCompletion(mnemonic, CompletionItemKind.Keyword);
      }
    }

    for (const directive of DIRECTIVES.keys()) {
      if (!isDirectiveSupported(document, directive)) {
        continue;
      }
      addCompletion(directive, CompletionItemKind.Keyword);
      addCompletion(`.${directive}`, CompletionItemKind.Keyword);
    }
  } else {
    if (!isLocalLabelRequest) {
      if (conditionalInstruction !== undefined) {
        for (const cc of conditionalInstruction.conditionCodes) {
          if (matchesCompletionPrefix(cc, operandPrefix)) {
            const insertText = conditionalInstruction.requiresTargetOperand ? `${cc},` : undefined;
            addCompletion(cc, CompletionItemKind.EnumMember, insertText);
          }
        }
      }

      for (const doc of openDocuments.values()) {
        const collector = getCachedCollector(doc);
        for (const sym of collector.getSymbols()) {
          if (!sym.isLocal && matchesCompletionPrefix(sym.name, operandPrefix)) {
            addCompletion(sym.name, CompletionItemKind.Value);
          }
        }
      }
    }

    const currentScope = getGlobalScope(document, line);
    if (currentScope !== undefined) {
      for (let index = 0; index < document.lines.length; index++) {
        const label = document.lines[index]?.label;
        if (
          label !== undefined &&
          isLocalLabelSupported(document, label) &&
          matchesCompletionPrefix(label, operandPrefix) &&
          getGlobalScope(document, index) === currentScope
        ) {
          const textEdit = operandPrefix === undefined ? undefined : {
            newText: label,
            range: {
              start: { line, character: character - operandPrefix.length },
              end: { line, character }
            }
          };
          addCompletion(label, CompletionItemKind.Value, undefined, textEdit, label);
        }
      }
    }
  }

  return completions;
}
