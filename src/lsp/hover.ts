import { Hover } from "vscode-languageserver/node";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { AsmDocument } from "../asm/document";
import { getSymbolAtPosition, findSymbolDefinitions } from "./symbol-navigation";
import { Lexer, TokenType } from "../asm/lexer";
import { clampLine } from "./positions";
import { getInstructionMetadata, isRegister, isConditionCode, isEz80Suffix, getDirectiveMetadata, getDirectiveSignature, getEz80SuffixMetadata, CpuDialect } from "../asm/metadata";
import { BIOS_ROUTINE_DESCRIPTIONS } from "../asm/bios";
import { BIOS_VARIABLE_DESCRIPTIONS } from "../asm/bios-variables";
import { type DiskDocumentCache } from "../asm/workspace";

function buildBiosRoutineHover(document: AsmDocument, name: string): Hover | null {
  if (!document.isAsmsx || !document.lines.some(
    (line) => line.mnemonic === 'bios' && (!line.operands || line.operands.length === 0)
  )) {
    return null;
  }

  const routineName = name.toUpperCase();
  const description = BIOS_ROUTINE_DESCRIPTIONS.get(routineName);
  return description === undefined
    ? null
    : { contents: `MSX BIOS Routine: \`${routineName}\`\n\n${description}` };
}

function buildBiosVariableHover(document: AsmDocument, name: string): Hover | null {
  if (!document.isAsmsx || !document.lines.some(
    (line) => line.mnemonic === 'biosvars' && (!line.operands || line.operands.length === 0)
  )) {
    return null;
  }

  const variableName = name.toUpperCase();
  const description = BIOS_VARIABLE_DESCRIPTIONS.get(variableName);
  return description === undefined
    ? null
    : { contents: `MSX BIOS Variable: \`${variableName}\`\n\n${description}` };
}

export async function buildHover(
  openDocuments: ReadonlyMap<string, AsmDocument>,
  uri: string,
  line: number,
  character: number,
  diskCache?: DiskDocumentCache
): Promise<Hover | null> {
  const document = openDocuments.get(uri);
  if (document === undefined) {
    return null;
  }

  const lines = document.source.split(/\r?\n/);
  const clampedLine = clampLine(line, lines.length);
  const lineText = lines[clampedLine];
  if (lineText === undefined) {
    return null;
  }
  // A character past the line end maps onto the line's last character so the
  // end-of-line cursor still hovers the final token.
  const clampedCharacter = Math.min(Math.max(0, character), Math.max(0, lineText.length - 1));

  const lexer = new Lexer(lineText);
  const tokens = lexer.tokenize();

  let hoveredToken = null;
  for (const token of tokens) {
    if (clampedCharacter >= token.start && clampedCharacter < token.start + token.length) {
      hoveredToken = token;
      break;
    }
  }

  if (!hoveredToken || (hoveredToken.type !== TokenType.Identifier && hoveredToken.type !== TokenType.Dot)) {
    return null;
  }

  const symbolAtPos = getSymbolAtPosition(document, clampedLine, clampedCharacter);
  const biosRoutineHover = buildBiosRoutineHover(document, symbolAtPos?.name ?? "");
  if (biosRoutineHover) {
    return biosRoutineHover;
  }
  const biosVariableHover = buildBiosVariableHover(document, symbolAtPos?.name ?? "");
  if (biosVariableHover) {
    return biosVariableHover;
  }
  if (symbolAtPos) {
    const definitions = await findSymbolDefinitions(openDocuments, uri, clampedLine, clampedCharacter, diskCache);
    if (definitions !== null) {
      const definition = Array.isArray(definitions) ? definitions[0] : definitions;
      if (definition !== undefined) {
        let hoverName = symbolAtPos.name;
        let prefix = "Symbol";
        if (hoverName === '@b' || hoverName === '@f' || hoverName === '@n' || hoverName === '@p' || hoverName === '@@') {
            hoverName = '@@';
            prefix = "Temporary label";
        }

        const location = definition.location;
        let contents: string;
        if (location.uri !== uri) {
          const filename = path.basename(fileURLToPath(location.uri));
          contents = `${prefix} \`${hoverName}\` defined in ${filename} at line ${location.range.start.line + 1}`;
        } else {
          contents = `${prefix} \`${hoverName}\` defined at line ${location.range.start.line + 1}`;
        }
        if (definition.docComment !== undefined) {
          contents += `\n\n${definition.docComment}`;
        }
        return { contents };
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
      const signature = getDirectiveSignature(directiveMeta, document.dialect, document.isAsmsx);
      return {
        contents: `Directive: \`${directiveMeta.name.toUpperCase()}\`\n\n${directiveMeta.description}\n\nSignature: \`${signature}\``
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
