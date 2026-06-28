import {
  Connection,
  ProposedFeatures,
  TextDocumentSyncKind,
  createConnection,
  FileChangeType,
} from "vscode-languageserver/node";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

import { CpuDialect } from "./asm/metadata";
import { AsmDocument } from "./asm/document";
import { collectDiagnosticsByUri } from "./lsp/diagnostics";

export function createServerConnection(
  inputStream: NodeJS.ReadableStream = process.stdin,
  outputStream: NodeJS.WritableStream = process.stdout
): Connection {
  return createConnection(ProposedFeatures.all, inputStream, outputStream);
}

export function startServer(
  dialect: CpuDialect = CpuDialect.Z80,
  inputStream: NodeJS.ReadableStream = process.stdin,
  outputStream: NodeJS.WritableStream = process.stdout
): Connection {
  const connection = createServerConnection(inputStream, outputStream);
  const openDocuments = new Map<string, AsmDocument>();
  const watchedDocuments = new Map<string, AsmDocument>();

  function getAllDocuments(): Map<string, AsmDocument> {
    const all = new Map(watchedDocuments);
    for (const [uri, doc] of openDocuments.entries()) {
      all.set(uri, doc);
    }
    return all;
  }

  connection.onInitialize(() => ({
    capabilities: {
      textDocumentSync: {
        openClose: true,
        change: TextDocumentSyncKind.Full
      }
    }
  }));

  connection.onDidOpenTextDocument((params) => {
    openDocuments.set(params.textDocument.uri, new AsmDocument(params.textDocument.text, dialect));
    publishDiagnostics();
  });

  connection.onDidChangeTextDocument((params) => {
    const nextText = params.contentChanges.at(-1)?.text;
    if (nextText === undefined) {
      return;
    }

    openDocuments.set(params.textDocument.uri, new AsmDocument(nextText, dialect));
    publishDiagnostics();
  });

  connection.onDidCloseTextDocument((params) => {
    openDocuments.delete(params.textDocument.uri);
    void connection.sendDiagnostics({
      uri: params.textDocument.uri,
      diagnostics: []
    });
    publishDiagnostics();
  });

  connection.onDidChangeWatchedFiles((params) => {
    for (const change of params.changes) {
      if (change.type === FileChangeType.Deleted) {
        watchedDocuments.delete(change.uri);
      } else {
        try {
          let filePath = change.uri;
          if (filePath.startsWith("file://")) {
            filePath = fileURLToPath(filePath);
          }
          const source = fs.readFileSync(filePath, "utf8");
          watchedDocuments.set(change.uri, new AsmDocument(source, dialect));
        } catch {
          watchedDocuments.delete(change.uri);
        }
      }
    }
    publishDiagnostics();
  });

  function publishDiagnostics(): void {
    for (const [uri, diagnostics] of collectDiagnosticsByUri(openDocuments, getAllDocuments()).entries()) {
      void connection.sendDiagnostics({
        uri,
        diagnostics: [...diagnostics]
      });
    }
  }

  connection.listen();
  return connection;
}

if (require.main === module) {
  startServer();
}
