import { Position, Range } from "vscode-languageserver/node";

// Shared clamping for LSP request parameters. Clients routinely send
// positions/ranges slightly outside the document (stale buffers, end-of-line
// cursors); handlers must normalize them instead of failing or ignoring the
// request. Lines clamp into [0, lineCount - 1], characters into
// [0, lineText.length], and inverted ranges are swapped into order.

export function clampLine(line: number, lineCount: number): number {
  if (lineCount <= 0) {
    return 0;
  }
  return Math.min(Math.max(0, line), lineCount - 1);
}

export function clampPosition(position: Position, lineTexts: readonly string[]): Position {
  const line = clampLine(position.line, lineTexts.length);
  return {
    line,
    character: Math.min(Math.max(0, position.character), lineTexts[line]?.length ?? 0)
  };
}

export function clampLineRange(range: Range, lineCount: number): { startLine: number; endLine: number } {
  const start = clampLine(range.start.line, lineCount);
  const end = clampLine(range.end.line, lineCount);
  return start <= end ? { startLine: start, endLine: end } : { startLine: end, endLine: start };
}
