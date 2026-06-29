import { SemanticTokens, SemanticTokensBuilder, SemanticTokensLegend, SemanticTokenTypes } from "vscode-languageserver/node";
import { AsmDocument } from "../asm/document";
import { TokenType } from "../asm/lexer";
import { SymbolCollector } from "../asm/symbols";
import { COMMON_REGISTERS, EZ80_REGISTERS, CONDITION_CODES, CpuDialect } from "../asm/metadata";

const tokenTypesList = [
  SemanticTokenTypes.comment,
  SemanticTokenTypes.function,
  SemanticTokenTypes.macro,
  SemanticTokenTypes.keyword,
  SemanticTokenTypes.string,
  SemanticTokenTypes.number,
  SemanticTokenTypes.operator,
  SemanticTokenTypes.variable,
  SemanticTokenTypes.parameter
];

export const semanticTokensLegend: SemanticTokensLegend = {
  tokenTypes: tokenTypesList,
  tokenModifiers: []
};

const tokenTypeMap = {
  comment: tokenTypesList.indexOf(SemanticTokenTypes.comment),
  label: tokenTypesList.indexOf(SemanticTokenTypes.function),
  localLabel: tokenTypesList.indexOf(SemanticTokenTypes.function),
  directive: tokenTypesList.indexOf(SemanticTokenTypes.macro),
  mnemonic: tokenTypesList.indexOf(SemanticTokenTypes.keyword),
  keyword: tokenTypesList.indexOf(SemanticTokenTypes.keyword),
  string: tokenTypesList.indexOf(SemanticTokenTypes.string),
  numericLiteral: tokenTypesList.indexOf(SemanticTokenTypes.number),
  modifier: tokenTypesList.indexOf(SemanticTokenTypes.operator),
  expressionOperator: tokenTypesList.indexOf(SemanticTokenTypes.operator),
  identifier: tokenTypesList.indexOf(SemanticTokenTypes.variable)
};

export function buildSemanticTokens(indexedDocuments: Map<string, AsmDocument>, uri: string): SemanticTokens {
  const document = indexedDocuments.get(uri);
  if (!document) {
    return { data: [] };
  }

  const builder = new SemanticTokensBuilder();

  // Collect symbols across workspace
  const allSymbols = new Set<string>();
  for (const doc of indexedDocuments.values()) {
    const collector = new SymbolCollector(doc);
    for (const sym of collector.getSymbols()) {
      allSymbols.add(sym.name);
    }
  }

  const registers = new Set([...COMMON_REGISTERS]);
  if (document.dialect === CpuDialect.EZ80) {
      for (const reg of EZ80_REGISTERS) registers.add(reg);
  }
  const conditions = new Set([...CONDITION_CODES]);

  for (let lineNum = 0; lineNum < document.lines.length; lineNum++) {
    const lineNode = document.lines[lineNum];
    
    for (const token of lineNode.tokens) {
      let typeIndex: number | undefined;

      if (token.type === TokenType.Comment) {
        typeIndex = tokenTypeMap.comment;
      } else if (token.type === TokenType.String) {
        typeIndex = tokenTypeMap.string;
      } else if (token.type === TokenType.Number || token.type === TokenType.Dollar) {
        typeIndex = tokenTypeMap.numericLiteral;
      } else if (
        token.type === TokenType.Plus ||
        token.type === TokenType.Minus ||
        token.type === TokenType.Asterisk ||
        token.type === TokenType.Slash ||
        token.type === TokenType.Percent ||
        token.type === TokenType.Ampersand ||
        token.type === TokenType.Pipe ||
        token.type === TokenType.Caret ||
        token.type === TokenType.Tilde ||
        token.type === TokenType.ShiftLeft ||
        token.type === TokenType.ShiftRight ||
        token.type === TokenType.Less ||
        token.type === TokenType.Greater
      ) {
        typeIndex = tokenTypeMap.expressionOperator;
      } else if (token === lineNode.labelToken) {
        typeIndex = tokenTypeMap.label;
      } else if (token === lineNode.mnemonicToken || token === lineNode.suffixToken) {
        if (lineNode.isDirective) {
            typeIndex = tokenTypeMap.directive;
        } else {
            typeIndex = tokenTypeMap.mnemonic;
        }
      } else if (token.type === TokenType.Identifier) {
        const val = token.value.toLowerCase();
        if (registers.has(val) || conditions.has(val)) {
            typeIndex = tokenTypeMap.keyword;
        } else if (allSymbols.has(token.value)) {
            typeIndex = tokenTypeMap.label;
        } else if (allSymbols.has("." + token.value)) {
            typeIndex = tokenTypeMap.label;
        } else {
            typeIndex = tokenTypeMap.identifier;
        }
      }

      if (typeIndex !== undefined) {
        builder.push(
          lineNum,
          token.start,
          token.length,
          typeIndex,
          0
        );
      }
    }
  }

  return builder.build();
}
