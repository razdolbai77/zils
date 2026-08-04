import { DocumentLink } from "vscode-languageserver/node";
import path from "node:path";
import { AsmDocument } from "../asm/document";
import { pathToUri, uriToPath } from "../asm/workspace";

const includeDirectives = new Set(["include", "incbin", "maclib"]);

export function buildDocumentLinks(uri: string, cached: AsmDocument): DocumentLink[] {
  const links: DocumentLink[] = [];

  // Include paths resolve against the including file's directory, mirroring
  // indexWorkspace. `new URL(target, uri)` would mangle Windows backslashes
  // and absolute paths.
  const basePath = uriToPath(uri);
  if (basePath.startsWith("untitled:")) {
    return links;
  }
  const baseDir = path.dirname(basePath);

  for (let i = 0; i < cached.lines.length; i++) {
    const line = cached.lines[i];
    
    if (line.isDirective && line.mnemonic && includeDirectives.has(line.mnemonic.toLowerCase())) {
      if (line.operands && line.operands.length > 0 && line.operands[0].length > 0) {
        const token = line.operands[0][0];
        if (token.type === "String") {
          const targetPath = token.value;
          const lineStart = line.start ?? 0;
          const startChar = token.start - lineStart;
          const endChar = startChar + token.length;

          try {
            const targetUri = pathToUri(path.resolve(baseDir, targetPath));
            links.push({
              range: {
                start: { line: i, character: startChar },
                end: { line: i, character: endChar }
              },
              target: targetUri
            });
          } catch {
            // Ignore unresolvable include paths
          }
        }
      }
    }
  }

  return links;
}
