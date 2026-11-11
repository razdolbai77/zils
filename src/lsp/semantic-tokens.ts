import { SemanticTokens, SemanticTokensBuilder, SemanticTokensLegend, SemanticTokenTypes } from "vscode-languageserver/node";
import { AsmDocument, getLineStarts } from "../asm/document";
import { Token, TokenType } from "../asm/lexer";
import { LineNode } from "../asm/line-parser";
import { getCachedCollector } from "../asm/symbol-cache";
import { COMMON_REGISTERS, EZ80_REGISTERS, CONDITION_CODES, CONDITIONAL_INSTRUCTIONS, CpuDialect } from "../asm/metadata";

const tokenTypesList = [
  SemanticTokenTypes.comment,
  SemanticTokenTypes.function,
  SemanticTokenTypes.macro,
  SemanticTokenTypes.keyword,
  SemanticTokenTypes.string,
  SemanticTokenTypes.number,
  SemanticTokenTypes.operator,
  SemanticTokenTypes.variable,
  SemanticTokenTypes.property,
  SemanticTokenTypes.enumMember
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
  keyword: tokenTypesList.indexOf(SemanticTokenTypes.property),
  register: tokenTypesList.indexOf(SemanticTokenTypes.property),
  condition: tokenTypesList.indexOf(SemanticTokenTypes.enumMember),
  string: tokenTypesList.indexOf(SemanticTokenTypes.string),
  numericLiteral: tokenTypesList.indexOf(SemanticTokenTypes.number),
  modifier: tokenTypesList.indexOf(SemanticTokenTypes.operator),
  expressionOperator: tokenTypesList.indexOf(SemanticTokenTypes.operator),
  identifier: tokenTypesList.indexOf(SemanticTokenTypes.variable)
};

const DIRECT_TOKEN_TYPE_MAP = new Map<TokenType, number>([
  [TokenType.Comment, tokenTypeMap.comment],
  [TokenType.String, tokenTypeMap.string],
  [TokenType.Number, tokenTypeMap.numericLiteral],
  [TokenType.Dollar, tokenTypeMap.numericLiteral],
  [TokenType.Plus, tokenTypeMap.expressionOperator],
  [TokenType.Minus, tokenTypeMap.expressionOperator],
  [TokenType.Asterisk, tokenTypeMap.expressionOperator],
  [TokenType.Slash, tokenTypeMap.expressionOperator],
  [TokenType.Percent, tokenTypeMap.expressionOperator],
  [TokenType.Ampersand, tokenTypeMap.expressionOperator],
  [TokenType.Pipe, tokenTypeMap.expressionOperator],
  [TokenType.Caret, tokenTypeMap.expressionOperator],
  [TokenType.Tilde, tokenTypeMap.expressionOperator],
  [TokenType.ShiftLeft, tokenTypeMap.expressionOperator],
  [TokenType.ShiftRight, tokenTypeMap.expressionOperator],
  [TokenType.Less, tokenTypeMap.expressionOperator],
  [TokenType.Greater, tokenTypeMap.expressionOperator]
]);

const EZ80_SPECIAL_LABELS = new Set(["@b", "@f", "@n", "@p", "@@"]);

function isConditionToken(lineNode: LineNode, token: Token): boolean {
  if (!lineNode.mnemonic) {
    return false;
  }
  const condMeta = CONDITIONAL_INSTRUCTIONS[lineNode.mnemonic];
  if (!condMeta) {
    return false;
  }
  if (!lineNode.operands || lineNode.operands.length === 0) {
    return false;
  }
  const firstOp = lineNode.operands[0];
  if (firstOp.length === 1 && firstOp[0] === token) {
    return condMeta.conditionCodes.includes(token.value.toLowerCase());
  }
  return false;
}

function classifyIdentifier(
  token: Token,
  lineNode: LineNode,
  allSymbols: Set<string>,
  registers: Set<string>,
  conditions: Set<string>,
  dialect: CpuDialect
): number {
  const val = token.value.toLowerCase();
  if (isConditionToken(lineNode, token)) return tokenTypeMap.condition;
  if (registers.has(val)) return tokenTypeMap.register;
  if (conditions.has(val)) return tokenTypeMap.condition;
  if (allSymbols.has(token.value) || allSymbols.has("." + token.value)) return tokenTypeMap.label;
  if (dialect === CpuDialect.EZ80 && EZ80_SPECIAL_LABELS.has(token.value)) return tokenTypeMap.label;
  return tokenTypeMap.identifier;
}

function classifyToken(
  token: Token,
  lineNode: LineNode,
  allSymbols: Set<string>,
  registers: Set<string>,
  conditions: Set<string>,
  dialect: CpuDialect
): number | undefined {
  const direct = DIRECT_TOKEN_TYPE_MAP.get(token.type);
  if (direct !== undefined) return direct;
  if (token === lineNode.labelToken) return tokenTypeMap.label;
  if (token === lineNode.mnemonicToken || token === lineNode.suffixToken) {
    return lineNode.isDirective ? tokenTypeMap.directive : tokenTypeMap.mnemonic;
  }
  if (token.type === TokenType.Identifier) {
    return classifyIdentifier(token, lineNode, allSymbols, registers, conditions, dialect);
  }
  return undefined;
}

function collectWorkspaceSymbols(indexedDocuments: Iterable<AsmDocument>): Set<string> {
  const allSymbols = new Set<string>();
  for (const doc of indexedDocuments) {
    const collector = getCachedCollector(doc);
    for (const sym of collector.getSymbols()) {
      allSymbols.add(sym.name);
    }
  }
  return allSymbols;
}

export function buildSemanticTokens(indexedDocuments: Map<string, AsmDocument>, uri: string): SemanticTokens {
  const document = indexedDocuments.get(uri);
  if (!document) {
    return { data: [] };
  }

  const builder = new SemanticTokensBuilder();
  const allSymbols = collectWorkspaceSymbols(indexedDocuments.values());
  const registers = new Set<string>([
    ...COMMON_REGISTERS,
    ...(document.dialect === CpuDialect.EZ80 ? EZ80_REGISTERS : [])
  ]);
  const conditions = new Set<string>([...CONDITION_CODES]);
  const lineOffsets = getLineStarts(document.source);

  for (let lineNum = 0; lineNum < document.lines.length; lineNum++) {
    const lineNode = document.lines[lineNum];
    const lineOffset = lineOffsets[lineNum] ?? 0;

    for (const token of lineNode.tokens) {
      const typeIndex = classifyToken(token, lineNode, allSymbols, registers, conditions, document.dialect);
      if (typeIndex !== undefined) {
        builder.push(
          lineNum,
          token.start - lineOffset,
          token.length,
          typeIndex,
          0
        );
      }
    }
  }

  return builder.build();
}
