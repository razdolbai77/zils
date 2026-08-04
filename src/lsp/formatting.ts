import { FormattingOptions, TextEdit, Range, Position } from "vscode-languageserver/node";
import { AsmDocument } from "../asm/document";
import { LineNode } from "../asm/line-parser";
import { TokenType } from "../asm/lexer";
import { isRegister, isConditionCode, CpuDialect, getInstructionMetadata } from "../asm/metadata";
import { clampLine, clampLineRange } from "./positions";

const UNDOTTED_DIRECTIVES = new Set(["macro", "endm", "endmacro"]);
const COLUMN_0_DIRECTIVES = new Set(["macro", "endm", "endmacro", "if", "else", "endif"]);

const EZ80_UNDOTTED_DATA_DIRECTIVES = new Set([
  "db", "defb", "ascii", "asciz", "byte", "dw", "defw", "dl", "dw24", "dw32", "ds", "defs", "blkb", "blkw", "blkp", "blkl"
]);

const Z80_UNDOTTED_DATA_DIRECTIVES = new Set([
  "db", "defb", "dt", "deft", "dw", "defw", "ds", "defs", "byte", "word"
]);

function isUndottedDirective(mnemonic: string, dialect: CpuDialect): boolean {
  const lower = mnemonic.toLowerCase();
  if (lower === "equ" || UNDOTTED_DIRECTIVES.has(lower)) {
    return true;
  }
  if (dialect === CpuDialect.EZ80) {
    return EZ80_UNDOTTED_DATA_DIRECTIVES.has(lower);
  }
  return Z80_UNDOTTED_DATA_DIRECTIVES.has(lower);
}

export function formatDocument(
  document: AsmDocument,
  options: FormattingOptions
): TextEdit[] {
  return formatLines(document, options, 0, document.lines.length - 1);
}

export function formatRange(
  document: AsmDocument,
  options: FormattingOptions,
  range: Range
): TextEdit[] {
  const { startLine, endLine } = clampLineRange(range, document.lines.length);
  return formatLines(document, options, startLine, endLine);
}

export function formatOnType(
  document: AsmDocument,
  options: FormattingOptions,
  position: Position,
  ch: string
): TextEdit[] {
  if (ch === "\n" && position.line > 0) {
    const targetLine = clampLine(position.line - 1, document.lines.length);
    return formatLines(document, options, targetLine, targetLine);
  }
  return [];
}

function formatLines(
  document: AsmDocument,
  options: FormattingOptions,
  startLine: number,
  endLine: number
): TextEdit[] {
  const edits: TextEdit[] = [];
  const { insertSpaces, tabSize } = options;

  const col1 = 8;
  const col2 = 16;
  const col3 = 32;


  const linesSource = document.source.split(/\r?\n/);


  for (let lineIndex = startLine; lineIndex <= endLine; lineIndex++) {
    const lineNode = document.lines[lineIndex];
    if (lineNode === undefined) {
      continue;
    }

    // Only format malformed lines when parser recovered an invalid suffix.
    if (lineNode.error && !lineNode.invalidSuffix) {
      continue;
    }

    const originalText = linesSource[lineIndex] ?? "";
    const newText = formatLineNode(lineNode, originalText, insertSpaces, tabSize, col1, col2, col3, document.dialect);

    if (newText !== null && newText !== originalText) {
      edits.push(
        TextEdit.replace(
          {
            start: { line: lineIndex, character: 0 },
            end: { line: lineIndex, character: originalText.length }
          },
          newText
        )
      );
    }
  }

  return edits;
}

function visualLength(text: string, tabSize: number): number {
  let len = 0;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "\t") {
      len += tabSize - (len % tabSize);
    } else {
      len += 1;
    }
  }
  return len;
}

function padTo(currentText: string, targetCol: number, insertSpaces: boolean, tabSize: number): string {
  const vLen = visualLength(currentText, tabSize);

  if (!insertSpaces) {
    if (targetCol > vLen) {
      // How many tabs to reach targetCol?
      // Since targetCol is usually a multiple of tabSize, we can just use a simple loop
      let newLen = vLen;
      let tabs = "";
      while (newLen < targetCol) {
        tabs += "\t";
        newLen += tabSize - (newLen % tabSize);
      }
      return currentText + tabs;
    }
    return currentText + "\t";
  }

  if (vLen >= targetCol) {
    return currentText + " ";
  }
  return currentText + " ".repeat(targetCol - vLen);
}

function formatLineNode(
  line: LineNode,
  originalText: string,
  insertSpaces: boolean,
  tabSize: number,
  col1: number,
  col2: number,
  col3: number,
  dialect: CpuDialect
): string | null {
  // Empty line
  if (!line.label && !line.mnemonic && !line.comment) {
    return "";
  }

  // Comment-only line: place at col 0 when `;` starts in columns 0-7, else at opcode column.
  if (!line.label && !line.mnemonic && line.comment) {
    const semicolonCol = visualLength(originalText.substring(0, originalText.indexOf(";")), tabSize);
    if (semicolonCol < col1) {
      return line.comment.trimEnd();
    } else {
      return padTo("", col1, insertSpaces, tabSize) + line.comment.trimEnd();
    }
  }

  let result = "";

  // 1. Label
  if (line.label) {
    // Check if it's just a local label and colon, reconstruct cleanly
    let labelText = line.label;
    if (line.tokens.some(t => t.type === TokenType.Colon && t.start > (line.labelToken?.start ?? -1))) {
       if (!labelText.endsWith(":")) {
         labelText += ":";
       }
    } else {
        // Directives like `LABEL equ 10` might not have colon.
    }
    result += labelText;
  }

  // 2. Mnemonic / Directive
  if (line.mnemonic) {
    if (!(line.isDirective && COLUMN_0_DIRECTIVES.has(line.mnemonic.toLowerCase()) && !line.label)) {
      result = padTo(result, col1, insertSpaces, tabSize);
    }
    let mnemonicText = line.mnemonic;
    
    if (line.isDirective) {
      if (isUndottedDirective(mnemonicText, dialect)) {
        mnemonicText = mnemonicText.toUpperCase();
      } else {
        mnemonicText = "." + mnemonicText.toUpperCase();
      }
    } else {
      const sourceMnemonic = line.mnemonicToken?.value ?? mnemonicText;
      mnemonicText = getInstructionMetadata(mnemonicText) === undefined
        ? sourceMnemonic
        : mnemonicText.toLowerCase();
      // Add dot if original had it? (e.g. .equ vs equ)
      if (line.tokens.some(t => t.type === TokenType.Dot && t.start < (line.mnemonicToken?.start ?? Infinity) && (!line.labelToken || t.start > line.labelToken.start + line.labelToken.length))) {
          mnemonicText = "." + mnemonicText;
      }
    }

    if (line.suffix) {
      if (line.isDirective) {
        mnemonicText += "." + line.suffix.toUpperCase();
      } else {
        mnemonicText += "." + line.suffix.toLowerCase();
      }
    }
    result += mnemonicText;
  }

  // 3. Operands
  if (line.operands && line.operands.length > 0) {
    if (line.isDirective && line.mnemonic && COLUMN_0_DIRECTIVES.has(line.mnemonic.toLowerCase()) && !line.label) {
      result += " ";
    } else {
      result = padTo(result, col2, insertSpaces, tabSize);
    }
    
    const operandStrings = line.operands.map(opTokens => {
        let opStr = "";
        for (let i = 0; i < opTokens.length; i++) {
            const t = opTokens[i];
            let val = t.type === TokenType.String
                ? originalText.substring(t.start - (line.start ?? 0), t.start - (line.start ?? 0) + t.length)
                : t.value;

            if (line.isDirective && t.type === TokenType.Identifier) {
                const lower = val.toLowerCase();
                if (lower === 'at' || lower === 'skip' || lower === 'size') {
                    val = val.toUpperCase();
                }
            } else if (!line.isDirective && t.type === TokenType.Identifier) {
                if (isRegister(val, dialect) || isConditionCode(val)) {
                    val = val.toLowerCase();
                }
            }

            if (i > 0) {
                const prev = opTokens[i - 1];
                const prevIsAlnum = prev.type === TokenType.Identifier || prev.type === TokenType.Number || prev.type === TokenType.String;
                const currIsAlnum = t.type === TokenType.Identifier || t.type === TokenType.Number || t.type === TokenType.String;
                const prevIsKeyword = prev.type === TokenType.Identifier && ['at', 'skip', 'size'].includes(prev.value.toLowerCase());
                const currIsKeyword = t.type === TokenType.Identifier && ['at', 'skip', 'size'].includes(t.value.toLowerCase());
                
                if ((prevIsAlnum && currIsAlnum) || prevIsKeyword || currIsKeyword) {
                    opStr += " ";
                }
            }
            opStr += val;
        }
        return opStr;
    });
    
    // Operands are comma-separated without spaces: "A,B" not "A, B".
    result += operandStrings.join(",");
  }

  // 4. Comment
  if (line.comment) {
    result = padTo(result, col3, insertSpaces, tabSize);
    result += line.comment;
  }

  return result.trimEnd();
}
