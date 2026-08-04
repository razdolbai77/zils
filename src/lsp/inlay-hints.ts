import { InlayHint, InlayHintKind, Range } from "vscode-languageserver/node";
import { AsmDocument } from "../asm/document";
import { getCachedCollector } from "../asm/symbol-cache";
import { clampLineRange } from "./positions";

export function buildInlayHints(
  openDocuments: ReadonlyMap<string, AsmDocument>,
  uri: string,
  range: Range
): InlayHint[] {
  const cached = openDocuments.get(uri);
  if (cached === undefined) {
    return [];
  }

  const hints: InlayHint[] = [];
  const equates = new Map<string, string>();

  for (const doc of openDocuments.values()) {
    const collector = getCachedCollector(doc);
    for (const sym of collector.getSymbols()) {
      if (sym.isEquate && sym.value !== undefined) {
        equates.set(sym.name, "$" + sym.value.toString(16).toUpperCase());
      }
    }
  }

  const { startLine, endLine } = clampLineRange(range, cached.lines.length);
  for (let i = startLine; i <= endLine; i++) {
    const line = cached.lines[i];
    if (!line.tokens) continue;

    for (let j = 0; j < line.tokens.length; j++) {
      const token = line.tokens[j];
      if (token.type === "Identifier") {
        let searchName = token.value;
        let isLocal = false;
        if (j > 0 && line.tokens[j - 1].type === "Dot" && line.tokens[j - 1].start + line.tokens[j - 1].length === token.start) {
            isLocal = true;
            searchName = "." + token.value;
        }

        // We only care about global equates for now, or we'd have to resolve scope
        if (!isLocal) {
            const val = equates.get(searchName);
            if (val !== undefined) {
                // Check if it's the definition itself
                if (line.label === searchName) {
                    continue;
                }
                const lineStart = line.start ?? 0;
                hints.push({
                    position: { line: i, character: token.start - lineStart + token.length },
                    label: `: ${val}`,
                    kind: InlayHintKind.Type,
                    paddingLeft: true
                });
            }
        }
      }
    }
  }

  return hints;
}
