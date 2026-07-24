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
import { SymbolCollector } from "../asm/symbols";

const EZ80_ONLY_DIRECTIVES: Record<string, true> = {
  assume: true,
  cpu: true,
  dl: true,
  defl: true,
  align: true,
  maclib: true,
  incbin: true,
  ascii: true,
  asciz: true,
  byte: true,
  blkb: true,
  blkw: true,
  blkp: true,
  blkl: true,
  dw24: true,
  dw32: true,
  fillbyte: true
};

const ASMSX_ONLY_DIRECTIVES: Record<string, true> = {
  megas: true,
  bios: true,
  biosvars: true,
  fpos: true,
  rb: true,
  rw: true,
  rl: true,
  rs: true,
  insert: true,
  phase: true,
  dephase: true,
  zilog: true,
  page: true,
  rom: true,
  megarom: true,
  basic: true,
  msxdos: true,
  start: true,
  search: true,
  subpage: true,
  select: true,
  callbios: true,
  calldos: true,
  size: true,
  debug: true,
  break: true,
  breakpoint: true,
  rept: true,
  endr: true,
  printtext: true,
  printstring: true,
  print: true,
  printdec: true,
  printhex: true,
  printfix: true,
  cas: true,
  cassette: true,
  wav: true,
  filename: true,
  sinclair: true
};

function isDirectiveSupported(document: AsmDocument, directive: string): boolean {
  return document.isAsmsx ? !EZ80_ONLY_DIRECTIVES[directive] : !ASMSX_ONLY_DIRECTIVES[directive];
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
  if (
    tokenIndex <= 0 ||
    !tokens.slice(0, tokenIndex).some((token) => token.type === TokenType.Identifier)
  ) {
    return undefined;
  }

  const token = tokens[tokenIndex];
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
      if (token.type === TokenType.Comment && character <= token.start + token.length) {
        return [];
      }
    }
  }

  const completions: CompletionItem[] = [];
  const seen = new Set<string>();

  const addCompletion = (
    label: string,
    kind: CompletionItemKind,
    insertText: string | undefined = undefined
  ) => {
    if (!seen.has(label)) {
      seen.add(label);
      completions.push(insertText === undefined ? { label, kind } : { label, kind, insertText });
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
        const collector = new SymbolCollector(doc);
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
          addCompletion(label, CompletionItemKind.Value);
        }
      }
    }
  }

  return completions;
}
