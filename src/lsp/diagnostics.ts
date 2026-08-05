import {
  DiagnosticSeverity,
  type Diagnostic as LspDiagnostic
} from "vscode-languageserver/node";

import { type AsmDocument, type Diagnostic as AsmDiagnostic } from "../asm/document";
import { indexWorkspace, mergeIndexedWorkspaces, uriToPath, type DiskDocumentCache } from "../asm/workspace";
import { collectDiagnostics } from "../asm/diagnostics";
import { CpuDialect } from "../asm/metadata";

export async function collectDiagnosticsByUri(
  allDocuments: ReadonlyMap<string, AsmDocument>,
  dialect: CpuDialect,
  isAsmsx: boolean,
  diskCache?: DiskDocumentCache
): Promise<Map<string, readonly LspDiagnostic[]>> {
  const uriByFilePath = new Map<string, string>();
  const overrides = new Map<string, AsmDocument>();

  for (const [uri, doc] of allDocuments.entries()) {
    const filePath = uriToPath(uri);
    uriByFilePath.set(filePath, uri);
    overrides.set(filePath, doc);
  }

  // One merged index per publish: every root's include closure lands in the
  // same workspace, and the disk cache means repeated includes cost a stat,
  // not a re-read. Index roots sequentially so the first root warms the disk
  // cache before the next includes the same file (parallel indexing would
  // race the cache miss and double-read).
  const workspaces = [];
  for (const filePath of overrides.keys()) {
    workspaces.push(await indexWorkspace(filePath, overrides, dialect, isAsmsx, diskCache));
  }
  const workspace = mergeIndexedWorkspaces(workspaces);

  const diagnosticsByUri = new Map<string, readonly LspDiagnostic[]>();
  for (const [filePath, document] of overrides.entries()) {
    const uri = uriByFilePath.get(filePath);
    if (uri === undefined) {
      continue;
    }

    // Line lengths are computed once per document: every diagnostic needs
    // them for its end character, and splitting the source per diagnostic
    // would make one publish O(diagnostics × lines).
    const lineLengths = document.source.split(/\r?\n/).map((lineText) => lineText.length);
    const asmDiagnostics = collectDiagnostics(workspace, filePath);
    diagnosticsByUri.set(uri, asmDiagnostics.map((diagnostic) => toLspDiagnostic(lineLengths, diagnostic)));
  }

  return diagnosticsByUri;
}

function toLspDiagnostic(lineLengths: readonly number[], diagnostic: AsmDiagnostic): LspDiagnostic {
  const lineLength = lineLengths[diagnostic.line] ?? 0;

  return {
    severity: DiagnosticSeverity.Error,
    message: diagnostic.message,
    source: "zils",
    range: {
      start: {
        line: diagnostic.line,
        character: diagnostic.startCharacter ?? 0
      },
      end: {
        line: diagnostic.line,
        character: diagnostic.startCharacter !== undefined && diagnostic.length !== undefined
          ? diagnostic.startCharacter + diagnostic.length
          : lineLength
      }
    }
  };
}

