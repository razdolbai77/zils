import { FoldingRange, FoldingRangeKind } from "vscode-languageserver/node";
import { AsmDocument } from "../asm/document";

export function buildFoldingRanges(document: AsmDocument): FoldingRange[] {
  const ranges: FoldingRange[] = [];
  
  let currentMacroStartLine: number | null = null;
  
  let currentCommentStartLine: number | null = null;
  let currentCommentEndLine: number | null = null;
  
  let currentDataStartLine: number | null = null;
  let currentDataEndLine: number | null = null;

  const relocateStack: number[] = [];
  const ifStack: number[] = [];

  function flushComment() {
    if (currentCommentStartLine !== null && currentCommentEndLine !== null && currentCommentEndLine > currentCommentStartLine) {
      ranges.push({
        startLine: currentCommentStartLine,
        endLine: currentCommentEndLine,
        kind: FoldingRangeKind.Comment
      });
    }
    currentCommentStartLine = null;
    currentCommentEndLine = null;
  }

  function flushData() {
    if (currentDataStartLine !== null && currentDataEndLine !== null && currentDataEndLine > currentDataStartLine) {
      ranges.push({
        startLine: currentDataStartLine,
        endLine: currentDataEndLine,
        kind: FoldingRangeKind.Region
      });
    }
    currentDataStartLine = null;
    currentDataEndLine = null;
  }

  for (let i = 0; i < document.lines.length; i++) {
    const node = document.lines[i];
    if (!node) continue;

    const isCommentOnly = !node.label && !node.mnemonic && !!node.comment;
    if (isCommentOnly) {
      if (currentCommentStartLine === null) {
        currentCommentStartLine = i;
      }
      currentCommentEndLine = i;
    } else {
      flushComment();
    }

    const isData = node.isDirective && ["db", "dw", "ds", "defb", "defw", "defs", "dl", "defl"].includes(node.mnemonic?.toLowerCase() ?? "");
    if (isData) {
      if (currentDataStartLine === null) {
        currentDataStartLine = i;
      }
      currentDataEndLine = i;
    } else {
      flushData();
    }

    if (node.isDirective) {
      const dirName = node.mnemonic?.toLowerCase();
      if (dirName === "macro") {
        currentMacroStartLine = i;
      } else if (dirName === "endm") {
        if (currentMacroStartLine !== null && i > currentMacroStartLine) {
          ranges.push({
            startLine: currentMacroStartLine,
            endLine: i,
            kind: FoldingRangeKind.Region
          });
          currentMacroStartLine = null;
        }
      } else if (dirName === "relocate") {
        relocateStack.push(i);
      } else if (dirName === "endrelocate") {
        const startLine = relocateStack.pop();
        if (startLine !== undefined && i > startLine) {
          ranges.push({
            startLine,
            endLine: i,
            kind: FoldingRangeKind.Region
          });
        }
      } else if (dirName === "if") {
        ifStack.push(i);
      } else if (dirName === "endif") {
        const startLine = ifStack.pop();
        if (startLine !== undefined && i > startLine) {
          ranges.push({
            startLine,
            endLine: i,
            kind: FoldingRangeKind.Region
          });
        }
      }
    }
  }

  flushComment();
  flushData();

  return ranges;
}
