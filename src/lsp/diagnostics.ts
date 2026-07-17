import { fileURLToPath } from "node:url";

import {
  DiagnosticSeverity,
  type Diagnostic as LspDiagnostic
} from "vscode-languageserver/node";

import { type AsmDocument, type Diagnostic as AsmDiagnostic } from "../asm/document";
import { indexWorkspace } from "../asm/workspace";
import { collectDiagnostics } from "../asm/diagnostics";
import { CpuDialect } from "../asm/metadata";

export async function collectDiagnosticsByUri(
  openDocuments: ReadonlyMap<string, AsmDocument>,
  allDocuments: ReadonlyMap<string, AsmDocument>,
  dialect: CpuDialect,
  isAsmsx: boolean
): Promise<Map<string, readonly LspDiagnostic[]>> {
  const sourcesByFilePath = new Map<string, string>();
  const uriByFilePath = new Map<string, string>();
  const openEntries = new Set<string>();
  const overrides = new Map<string, AsmDocument>();

  for (const [uri, doc] of allDocuments.entries()) {
    const filePath = uriToFilePath(uri);
    sourcesByFilePath.set(filePath, doc.source);
    uriByFilePath.set(filePath, uri);
    overrides.set(filePath, doc);

    if (openDocuments.has(uri)) {
      openEntries.add(filePath);
    }
  }

  const diagnosticsByFilePath = new Map<string, LspDiagnostic[]>();
  for (const filePath of openEntries) {
    diagnosticsByFilePath.set(filePath, []);
  }

  for (const filePath of openEntries) {
    const workspace = await indexWorkspace(filePath, overrides, dialect, isAsmsx);
    const asmDiagnostics = collectDiagnostics(workspace, filePath);

    const source = sourcesByFilePath.get(filePath);
    const diagnostics = diagnosticsByFilePath.get(filePath);
    if (source === undefined || diagnostics === undefined) {
      continue;
    }

    for (const diagnostic of asmDiagnostics) {
      diagnostics.push(toLspDiagnostic(source, diagnostic));
    }
  }

  const diagnosticsByUri = new Map<string, readonly LspDiagnostic[]>();
  for (const filePath of openEntries) {
    const uri = uriByFilePath.get(filePath);
    if (uri !== undefined) {
      diagnosticsByUri.set(uri, diagnosticsByFilePath.get(filePath) ?? []);
    }
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

function uriToFilePath(uri: string): string {
  if (uri.startsWith("file://")) {
    return fileURLToPath(uri);
  }

  return uri;
}
