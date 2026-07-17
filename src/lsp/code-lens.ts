import { CodeLens } from "vscode-languageserver/node";
import { AsmDocument } from "../asm/document";
import { Lexer, TokenType } from "../asm/lexer";
import { SymbolCollector } from "../asm/symbols";

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
  const referenceCounts = new Map(definitions.map((definition) => [definition.name, 0]));

  for (const doc of openDocuments.values()) {
    const lines = doc.source.split(/\r?\n/);
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

        let resolvedName = token.value;
        if (j > 0 && tokens[j - 1].type === TokenType.Dot && tokens[j - 1].start + tokens[j - 1].length === token.start) {
          resolvedName = currentScope ? `${currentScope}.${token.value}` : `.${token.value}`;
        } else if (token.value.startsWith("@") || token.value.startsWith(".")) {
          resolvedName = currentScope ? `${currentScope}${token.value}` : token.value;
        }

        if (referenceCounts.has(resolvedName)) {
          referenceCounts.set(resolvedName, (referenceCounts.get(resolvedName) ?? 0) + 1);
        }
      }
    }
  }

  return definitions.map((definition) => {
    const lineText = document.source.split(/\r?\n/)[definition.line] ?? "";
    const actualRefs = referenceCounts.get(definition.name) ?? 0;
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
