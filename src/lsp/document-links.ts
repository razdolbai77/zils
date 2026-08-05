import { DocumentLink } from "vscode-languageserver/node";
import path from "node:path";
import { AsmDocument } from "../asm/document";
import { pathToUri, readIncludePath, uriToPath } from "../asm/workspace";

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
        const operand = line.operands[0];
        // readIncludePath mirrors indexWorkspace: quoted paths decode
        // escapes per dialect, unquoted operands span their source text.
        const targetPath = readIncludePath(operand, cached.source, cached.dialect);
        if (targetPath === null) continue;

        const first = operand[0];
        const last = operand[operand.length - 1];
        const lineStart = line.start ?? 0;

        try {
          const targetUri = pathToUri(path.resolve(baseDir, targetPath));
          links.push({
            range: {
              start: { line: i, character: first.start - lineStart },
              end: { line: i, character: last.start + last.length - lineStart }
            },
            target: targetUri
          });
        } catch {
          // Ignore unresolvable include paths
        }
      }
    }
  }

  return links;
}
