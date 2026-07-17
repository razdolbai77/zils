import {
  CompletionItem,
  CompletionItemKind
} from "vscode-languageserver/node";

import { AsmDocument } from "../asm/document";
import { Lexer, TokenType } from "../asm/lexer";
import {
  CpuDialect,
  DIRECTIVES,
  INSTRUCTIONS,
  COMMON_REGISTERS,
  EZ80_REGISTERS,
  CONDITION_CODES
} from "../asm/metadata";
import { SymbolCollector } from "../asm/symbols";

const EZ80_ONLY_DIRECTIVES: Record<string, true> = {
  assume: true,
  dl: true,
  defl: true,
  align: true,
  maclib: true,
  incbin: true,
  dl24: true,
  ds24: true
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

  const addCompletion = (label: string, kind: CompletionItemKind) => {
    if (!seen.has(label)) {
      seen.add(label);
      completions.push({ label, kind });
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
    const registers = document.dialect === CpuDialect.EZ80 ? EZ80_REGISTERS : COMMON_REGISTERS;
    for (const reg of registers) {
      addCompletion(reg, CompletionItemKind.Variable);
    }

    for (const cc of CONDITION_CODES) {
      addCompletion(cc, CompletionItemKind.EnumMember);
    }

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
