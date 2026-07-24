import { Hover } from "vscode-languageserver/node";
import { AsmDocument } from "../asm/document";
import { getSymbolAtPosition, findDefinition } from "./symbol-navigation";
import { Lexer, TokenType } from "../asm/lexer";
import { getInstructionMetadata, isRegister, isConditionCode, isEz80Suffix, getDirectiveMetadata, getEz80SuffixMetadata, CpuDialect } from "../asm/metadata";

export async function buildHover(
  openDocuments: ReadonlyMap<string, AsmDocument>,
  uri: string,
  line: number,
  character: number
): Promise<Hover | null> {
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

  if (!hoveredToken || (hoveredToken.type !== TokenType.Identifier && hoveredToken.type !== TokenType.Dot)) {
    return null;
  }

  const symbolAtPos = getSymbolAtPosition(document, line, character);
  if (symbolAtPos) {
    const definitions = await findDefinition(openDocuments, uri, line, character);
    if (definitions !== null) {
      const definition = Array.isArray(definitions) ? definitions[0] : definitions;
      if (definition !== undefined) {
        let hoverName = symbolAtPos.name;
        let prefix = "Symbol";
        if (hoverName === '@b' || hoverName === '@f' || hoverName === '@n' || hoverName === '@p' || hoverName === '@@') {
            hoverName = '@@';
            prefix = "Temporary label";
        }
        
        if (definition.uri !== uri) {
          const filename = definition.uri.split("/").pop();
          return {
            contents: `${prefix} \`${hoverName}\` defined in ${filename} at line ${definition.range.start.line + 1}`
          };
        }
        return {
          contents: `${prefix} \`${hoverName}\` defined at line ${definition.range.start.line + 1}`
        };
      }
    }
  }

  if (hoveredToken.type === TokenType.Dot) {
    const index = tokens.indexOf(hoveredToken);
    if (index >= 0 && index + 1 < tokens.length) {
      const nextToken = tokens[index + 1];
      if (nextToken.type === TokenType.Identifier) {
        hoveredToken = nextToken;
      } else {
        return null;
      }
    } else {
      return null;
    }
  } else if (hoveredToken.type !== TokenType.Identifier) {
    return null;
  }

  const value = hoveredToken.value.toLowerCase();
  
  const tokenIndex = tokens.indexOf(hoveredToken);
  const isSuffixContext = tokenIndex > 1 && 
                          tokens[tokenIndex - 1].type === TokenType.Dot && 
                          tokens[tokenIndex - 2].type === TokenType.Identifier &&
                          tokens[tokenIndex - 2].start + tokens[tokenIndex - 2].length === tokens[tokenIndex - 1].start &&
                          tokens[tokenIndex - 1].start + tokens[tokenIndex - 1].length === hoveredToken.start;

  if (!isSuffixContext) {
    // Check instruction
    const instMeta = getInstructionMetadata(value);
    if (instMeta) {
      const dialects = instMeta.supportedDialects.map(d => d.toUpperCase()).join(", ");
      return {
        contents: `Instruction: \`${instMeta.mnemonic.toUpperCase()}\`\n\n${instMeta.description}\n\nSignature: \`${instMeta.signature}\`\n\nSupported dialects: ${dialects}`
      };
    }

    // Check directive
    const directiveMeta = getDirectiveMetadata(value);
    if (directiveMeta) {
      return {
        contents: `Directive: \`${directiveMeta.name.toUpperCase()}\`\n\n${directiveMeta.description}\n\nSignature: \`${directiveMeta.signature}\``
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
  }

  // Check suffix
  if (isEz80Suffix(value, CpuDialect.EZ80)) { // Pass EZ80 to check if it's a valid suffix at all
    const suffixMeta = getEz80SuffixMetadata(value);
    const suffixDesc = suffixMeta ? `\n\n${suffixMeta.description}` : '';
    if (document.dialect === CpuDialect.Z80) {
       return {
         contents: `eZ80 Suffix: \`.${value.toUpperCase()}\`${suffixDesc}\n\n*(Not supported in Z80 mode)*`
       };
    }
    return {
      contents: `eZ80 Suffix: \`.${value.toUpperCase()}\`${suffixDesc}`
    };
  }

  return null;
}
