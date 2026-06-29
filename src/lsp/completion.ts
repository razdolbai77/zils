import {
  CompletionItem,
  CompletionItemKind
} from "vscode-languageserver/node";

import { AsmDocument } from "../asm/document";
import { Lexer, TokenType } from "../asm/lexer";
import {
  CpuDialect,
  INSTRUCTIONS,
  COMMON_REGISTERS,
  EZ80_REGISTERS,
  CONDITION_CODES
} from "../asm/metadata";
import { SymbolCollector } from "../asm/symbols";

const DIRECTIVES = [
  'equ', 'db', 'defb', 'dw', 'defw', 'ds', 'defs', 'org', 'assume', 'include', 'macro', 'endm', 'dl', 'defl'
];

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

  // Very simple context inference based on token position
  // If we're at the very beginning of the line or only whitespace before us, it's likely an instruction/directive
  // Otherwise, it might be an operand (register, condition code, symbol).
  let isOperandContext = false;
  let hasMnemonic = false;

  for (const token of tokens) {
    if (token.start < character) {
      if (token.type === TokenType.Identifier) {
         hasMnemonic = true;
      }
      if (token.type === TokenType.Comma || hasMnemonic) {
         isOperandContext = true;
      }
      if (token.type === TokenType.Comment) {
         if (character <= token.start + token.length) {
            return []; // Inside comment
         }
      }
    }
  }

  const completions: CompletionItem[] = [];
  const seen = new Set<string>();

  const addCompletion = (label: string, kind: CompletionItemKind) => {
    if (!seen.has(label)) {
      seen.add(label);
      completions.push({ label, kind });
    }
  };

  if (!isOperandContext) {
    // Instructions
    for (const [mnemonic, meta] of INSTRUCTIONS.entries()) {
      if (!meta.isDialectSpecific || meta.supportedDialects.includes(document.dialect)) {
        addCompletion(mnemonic, CompletionItemKind.Keyword);
      }
    }

    // Directives
    for (const directive of DIRECTIVES) {
      addCompletion(directive, CompletionItemKind.Keyword);
      addCompletion(`.${directive}`, CompletionItemKind.Keyword);
    }
  } else {
    // Registers
    const registers = document.dialect === CpuDialect.EZ80 ? EZ80_REGISTERS : COMMON_REGISTERS;
    for (const reg of registers) {
      addCompletion(reg, CompletionItemKind.Variable);
    }

    // Condition codes
    for (const cc of CONDITION_CODES) {
      addCompletion(cc, CompletionItemKind.EnumMember);
    }

    // Symbols from all documents
    for (const [uriStr, doc] of openDocuments.entries()) {
      const collector = new SymbolCollector(doc);
      for (const sym of collector.getSymbols()) {
        if (!sym.isLocal || uriStr === uri) {
          addCompletion(sym.name, CompletionItemKind.Value);
        }
      }
    }
  }

  return completions;
}
