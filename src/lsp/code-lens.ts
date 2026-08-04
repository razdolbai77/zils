import { CodeLens } from "vscode-languageserver/node";
import { AsmDocument } from "../asm/document";
import { Lexer, TokenType } from "../asm/lexer";
import { SymbolCollector } from "../asm/symbols";

const TEMPORARY_REFERENCE_ALIASES: Record<string, true> = {
  '@b': true,
  '@f': true,
  '@n': true,
  '@p': true
};

function resolveScope(document: AsmDocument, line: number): string | null {
  for (let i = line; i >= 0; i--) {
    const node = document.lines[i];
    if (node && node.label && !node.label.startsWith("@") && !node.label.startsWith(".")) {
      return node.label;
    }
  }
  return null;
}

export async function buildCodeLenses(
  openDocuments: ReadonlyMap<string, AsmDocument>,
  uri: string
): Promise<CodeLens[]> {
  const document = openDocuments.get(uri);
  if (document === undefined) {
    return [];
  }

  const collector = new SymbolCollector(document);
  const definitions = collector.getSymbols().filter((definition) => !definition.isLocal || definition.name === '@@');
  // Every @@ definition shares one name, so each gets its own count key;
  // @b/@f/@p/@n references resolve positionally onto the matching @@ line.
  const countKeys = definitions.map((definition) => definition.name === '@@' ? `@@_${definition.line}` : definition.name);
  const referenceCounts = new Map(countKeys.map((key) => [key, 0]));

  for (const doc of openDocuments.values()) {
    const lines = doc.source.split(/\r?\n/);
    const anonymousLines: number[] = [];
    for (let k = 0; k < doc.lines.length; k++) {
      const node = doc.lines[k];
      if (node && node.label === '@@' && !node.isInactive) {
        anonymousLines.push(k);
      }
    }

    for (let i = 0; i < lines.length; i++) {
      const tokens = new Lexer(lines[i]).tokenize();
      const definitionToken = doc.lines[i]?.labelToken;
      const definitionLineStart = doc.lines[i]?.start ?? 0;
      const definitionTokenStart = definitionToken ? definitionToken.start - definitionLineStart : null;
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

  return definitions.map((definition, index) => {
    const lineText = document.source.split(/\r?\n/)[definition.line] ?? "";
    const actualRefs = referenceCounts.get(countKeys[index]) ?? 0;
    const title = actualRefs === 1 ? "1 reference" : `${actualRefs} references`;

    return {
      range: {
        start: { line: definition.line, character: 0 },
        end: { line: definition.line, character: lineText.length }
      },
      command: {
        title,
        command: ""
      }
    };
  });
}
