import { DocumentLink } from "vscode-languageserver/node";
import { AsmDocument } from "../asm/document";

const includeDirectives = new Set(["include", "incbin", "maclib"]);

export function buildDocumentLinks(uri: string, cached: AsmDocument): DocumentLink[] {
  const links: DocumentLink[] = [];

  for (let i = 0; i < cached.lines.length; i++) {
    const line = cached.lines[i];
    
    if (line.isDirective && line.mnemonic && includeDirectives.has(line.mnemonic.toLowerCase())) {
      if (line.operands && line.operands.length > 0 && line.operands[0].length > 0) {
        const token = line.operands[0][0];
        if (token.type === "String") {
          const targetPath = token.value;
          const startChar = token.start;
          const endChar = token.start + token.length;

          try {
            const targetUri = new URL(targetPath, uri).href;
            links.push({
              range: {
                start: { line: i, character: startChar },
                end: { line: i, character: endChar }
              },
              target: targetUri
            });
          } catch {
            // Ignore invalid URLs
          }
        }
      }
    }
  }

  return links;
}
