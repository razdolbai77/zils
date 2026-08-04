import {
  DiagnosticSeverity,
  type Diagnostic as LspDiagnostic
} from "vscode-languageserver/node";

import { type AsmDocument, type Diagnostic as AsmDiagnostic } from "../asm/document";
import { indexWorkspace, uriToPath } from "../asm/workspace";
import { collectDiagnostics } from "../asm/diagnostics";
import { CpuDialect } from "../asm/metadata";

export async function collectDiagnosticsByUri(
  allDocuments: ReadonlyMap<string, AsmDocument>,
  dialect: CpuDialect,
  isAsmsx: boolean
): Promise<Map<string, readonly LspDiagnostic[]>> {
  const uriByFilePath = new Map<string, string>();
  const overrides = new Map<string, AsmDocument>();

  for (const [uri, doc] of allDocuments.entries()) {
    const filePath = uriToPath(uri);
    uriByFilePath.set(filePath, uri);
    overrides.set(filePath, doc);
  }

  const diagnosticsByUri = new Map<string, readonly LspDiagnostic[]>();
  for (const [filePath, document] of overrides.entries()) {
    const workspace = await indexWorkspace(filePath, overrides, dialect, isAsmsx);
    const asmDiagnostics = collectDiagnostics(workspace, filePath);

    const uri = uriByFilePath.get(filePath);
    if (uri === undefined) {
      continue;
    }

    diagnosticsByUri.set(uri, asmDiagnostics.map((diagnostic) => toLspDiagnostic(document.source, diagnostic)));
  }

  return diagnosticsByUri;
}

function toLspDiagnostic(source: string, diagnostic: AsmDiagnostic): LspDiagnostic {
  const lineText = source.split(/\r?\n/)[diagnostic.line] ?? "";

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
          : lineText.length
      }
    }
  };
}

