import { Hover } from "vscode-languageserver/node";
import { AsmDocument } from "../asm/document";
import { getSymbolAtPosition, findDefinition } from "./symbol-navigation";
import { Lexer, TokenType } from "../asm/lexer";
import { getInstructionMetadata, isRegister, isConditionCode, isEz80Suffix, CpuDialect } from "../asm/metadata";

const DIRECTIVES = new Set([
    'equ', 'db', 'defb', 'dw', 'defw', 'ds', 'defs', 'org', 'assume', 'include', 'macro', 'endm', 'dl', 'defl'
]);

export function buildHover(
  openDocuments: ReadonlyMap<string, AsmDocument>,
  uri: string,
  line: number,
  character: number
): Hover | null {
  const document = openDocuments.get(uri);
  if (document === undefined) {
    return null;
  }

  const lines = document.source.split(/\r?\n/);
  const lineText = lines[line];
  if (lineText === undefined) {
    return null;
  }

  const lexer = new Lexer(lineText);
  const tokens = lexer.tokenize();

  let hoveredToken = null;
  for (const token of tokens) {
    if (character >= token.start && character <= token.start + token.length) {
      hoveredToken = token;
      break;
    }
  }

  if (!hoveredToken || hoveredToken.type !== TokenType.Identifier) {
    return null;
  }

  const value = hoveredToken.value.toLowerCase();

  // Check instruction
  const instMeta = getInstructionMetadata(value);
  if (instMeta) {
    const dialects = instMeta.supportedDialects.map(d => d.toUpperCase()).join(", ");
    return {
      contents: `Instruction: \`${instMeta.mnemonic.toUpperCase()}\`\n\nSupported dialects: ${dialects}`
    };
  }

  // Check directive
  if (DIRECTIVES.has(value) || (value.startsWith('.') && DIRECTIVES.has(value.substring(1)))) {
    return {
      contents: `Directive: \`${value.toUpperCase()}\``
    };
  }

  // Check register
  if (isRegister(value, document.dialect)) {
    return {
      contents: `Register: \`${value.toUpperCase()}\``
    };
  }

  // Check condition code
  if (isConditionCode(value)) {
    return {
      contents: `Condition Code: \`${value.toUpperCase()}\``
    };
  }

  // Check suffix
  if (isEz80Suffix(value, CpuDialect.EZ80)) { // Pass EZ80 to check if it's a valid suffix at all
    if (document.dialect === CpuDialect.Z80) {
       return {
         contents: `eZ80 Suffix: \`.${value.toUpperCase()}\`\n\n*(Not supported in Z80 mode)*`
       };
    }
    return {
      contents: `eZ80 Suffix: \`.${value.toUpperCase()}\``
    };
  }

  // Check symbol
  const symbolAtPos = getSymbolAtPosition(document, line, character);
  if (symbolAtPos) {
    const definitions = findDefinition(openDocuments, uri, line, character);
    if (definitions !== null) {
      const definition = Array.isArray(definitions) ? definitions[0] : definitions;
      if (definition !== undefined) {
        if (definition.uri !== uri) {
          const filename = definition.uri.split("/").pop();
          return {
            contents: `Symbol \`${symbolAtPos.name}\` defined in ${filename} at line ${definition.range.start.line + 1}`
          };
        }
        return {
          contents: `Symbol \`${symbolAtPos.name}\` defined at line ${definition.range.start.line + 1}`
        };
      }
    }
  }

  return null;
}
