import { CodeLens } from "vscode-languageserver/node";
import { AsmDocument } from "../asm/document";
import { TokenType } from "../asm/lexer";
import { getCachedCollector } from "../asm/symbol-cache";
import { resolveScope } from "./symbol-navigation";

const TEMPORARY_REFERENCE_ALIASES: Record<string, true> = {
  '@b': true,
  '@f': true,
  '@n': true,
  '@p': true
};


export async function buildCodeLenses(
  openDocuments: ReadonlyMap<string, AsmDocument>,
  uri: string
): Promise<CodeLens[]> {
  const document = openDocuments.get(uri);
  if (document === undefined) {
    return [];
  }

  const collector = getCachedCollector(document);
  const definitions = collector.getSymbols().filter((definition) => !definition.isLocal || definition.name === '@@');
  // Every @@ definition shares one name, so each gets its own count key;
  // @b/@f/@p/@n references resolve positionally onto the matching @@ line.
  const countKeys = definitions.map((definition) => definition.name === '@@' ? `@@_${definition.line}` : definition.name);
  const referenceCounts = new Map(countKeys.map((key) => [key, 0]));

  for (const doc of openDocuments.values()) {
    const anonymousLines: number[] = [];
    for (let k = 0; k < doc.lines.length; k++) {
      const node = doc.lines[k];
      if (node && node.label === '@@' && !node.isInactive) {
        anonymousLines.push(k);
      }
    }

    for (let i = 0; i < doc.lines.length; i++) {
      const lineNode = doc.lines[i];
      if (!lineNode) continue;

      const tokens = lineNode.tokens;
      const definitionToken = lineNode.labelToken;
      const definitionTokenStart = definitionToken?.start ?? null;
      const definitionTokenLength = definitionToken?.length ?? null;
      const currentScope = resolveScope(doc, i);

      for (let j = 0; j < tokens.length; j++) {
        const token = tokens[j];
        if (token.type !== TokenType.Identifier) {
          continue;
        }

        if (definitionTokenStart !== null && definitionTokenLength !== null && token.start === definitionTokenStart && token.length === definitionTokenLength) {
          continue;
        }

        let countKey: string | null;
        if (j > 0 && tokens[j - 1].type === TokenType.Dot && tokens[j - 1].start + tokens[j - 1].length === token.start) {
          countKey = currentScope ? `${currentScope}.${token.value}` : `.${token.value}`;
        } else if (TEMPORARY_REFERENCE_ALIASES[token.value]) {
          // @b/@p walk backward, @f/@n forward, matching the diagnostic
          // engine's anonymous-label resolution; only active definitions match.
          const backward = token.value === '@b' || token.value === '@p';
          let target: number | undefined;
          for (const anonymousLine of anonymousLines) {
            if (backward) {
              if (anonymousLine >= i) break;
              target = anonymousLine;
            } else if (anonymousLine > i) {
              target = anonymousLine;
              break;
            }
          }
          countKey = target === undefined ? null : `@@_${target}`;
        } else if (token.value === '@@') {
          // A bare @@ is ambiguous (not a resolvable reference); counting
          // it would credit every anonymous lens at once.
          countKey = null;
        } else if (token.value.startsWith("@") || token.value.startsWith(".")) {
          countKey = currentScope ? `${currentScope}${token.value}` : token.value;
        } else {
          countKey = token.value;
        }

        if (countKey !== null && referenceCounts.has(countKey)) {
          referenceCounts.set(countKey, (referenceCounts.get(countKey) ?? 0) + 1);
        }
      }
    }
  }

  // One split per request: every lens's range end needs its line length.
  const lineLengths = document.source.split(/\r?\n/).map((lineText) => lineText.length);

  return definitions.map((definition, index) => {
    const actualRefs = referenceCounts.get(countKeys[index]) ?? 0;
    const title = actualRefs === 1 ? "1 reference" : `${actualRefs} references`;

    return {
      range: {
        start: { line: definition.line, character: 0 },
        end: { line: definition.line, character: lineLengths[definition.line] ?? 0 }
      },
      command: {
        title,
        command: ""
      }
    };
  });
}
