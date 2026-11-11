import { FoldingRange, FoldingRangeKind } from "vscode-languageserver/node";
import { AsmDocument } from "../asm/document";
import { DATA_DIRECTIVES } from "../asm/metadata";

class SpanTracker {
  private start: number | null = null;
  private end: number | null = null;

  constructor(private kind: FoldingRangeKind, private ranges: FoldingRange[]) {}

  add(line: number): void {
    if (this.start === null) this.start = line;
    this.end = line;
  }

  flush(): void {
    if (this.start !== null && this.end !== null && this.end > this.start) {
      this.ranges.push({
        startLine: this.start,
        endLine: this.end,
        kind: this.kind
      });
    }
    this.start = null;
    this.end = null;
  }
}

const PAIRED_DIRECTIVES: Record<string, { role: "start" | "end"; group: string }> = {
  macro: { role: "start", group: "macro" },
  endm: { role: "end", group: "macro" },
  endmacro: { role: "end", group: "macro" },
  relocate: { role: "start", group: "relocate" },
  endrelocate: { role: "end", group: "relocate" },
  rept: { role: "start", group: "rept" },
  endr: { role: "end", group: "rept" },
  if: { role: "start", group: "if" },
  ifdef: { role: "start", group: "if" },
  ifndef: { role: "start", group: "if" },
  endif: { role: "end", group: "if" }
};

export function buildFoldingRanges(document: AsmDocument): FoldingRange[] {
  const ranges: FoldingRange[] = [];
  const comments = new SpanTracker(FoldingRangeKind.Comment, ranges);
  const data = new SpanTracker(FoldingRangeKind.Region, ranges);
  const stacks = new Map<string, number[]>();

  for (let i = 0; i < document.lines.length; i++) {
    const node = document.lines[i];
    if (!node) continue;

    if (!node.label && !node.mnemonic && !!node.comment) {
      comments.add(i);
    } else {
      comments.flush();
    }

    if (node.isDirective && DATA_DIRECTIVES[node.mnemonic?.toLowerCase() ?? ""] === true) {
      data.add(i);
    } else {
      data.flush();
    }

    if (node.isDirective && node.mnemonic) {
      const pair = PAIRED_DIRECTIVES[node.mnemonic.toLowerCase()];
      if (pair) {
        let stack = stacks.get(pair.group);
        if (!stack) {
          stack = [];
          stacks.set(pair.group, stack);
        }
        if (pair.role === "start") {
          stack.push(i);
        } else {
          const startLine = stack.pop();
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
  }

  comments.flush();
  data.flush();

  return ranges;
}
