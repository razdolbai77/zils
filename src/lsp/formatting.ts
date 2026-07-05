import { FormattingOptions, TextEdit, Range, Position } from "vscode-languageserver/node";
import { AsmDocument } from "../asm/document";
import { LineNode } from "../asm/line_parser";
import { TokenType } from "../asm/lexer";

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
  return formatLines(document, options, range.start.line, range.end.line);
}

export function formatOnType(
  document: AsmDocument,
  options: FormattingOptions,
  position: Position,
  ch: string
): TextEdit[] {
  if (ch === "\n" && position.line > 0) {
    return formatLines(document, options, position.line - 1, position.line - 1);
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

    // Do not format malformed lines.
    if (lineNode.error) {
      continue;
    }

    const originalText = linesSource[lineIndex] ?? "";
    const newText = formatLineNode(lineNode, originalText, insertSpaces, tabSize, col1, col2, col3);

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
  col3: number
): string | null {
  // Empty line
  if (!line.label && !line.mnemonic && !line.comment) {
    return "";
  }

  // Comment-only line: place at col 0 if `;` starts in columns 1-8, else at opcode column.
  if (!line.label && !line.mnemonic && line.comment) {
    const semicolonCol = visualLength(originalText.substring(0, originalText.indexOf(";")), tabSize);
    if (semicolonCol <= 8) {
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
    result = padTo(result, col1, insertSpaces, tabSize);
    let mnemonicText = line.mnemonic;
    
    if (line.isDirective) {
      mnemonicText = "." + mnemonicText.toUpperCase();
    } else {
      mnemonicText = mnemonicText.toLowerCase();
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
    result = padTo(result, col2, insertSpaces, tabSize);
    
    const operandStrings = line.operands.map(opTokens => {
        return opTokens.map(t => t.value).join("");
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
