import {
  Connection,
  ProposedFeatures,
  TextDocumentSyncKind,
  createConnection,
  FileChangeType,
} from "vscode-languageserver/node";
import fs from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

import { CpuDialect } from "./asm/metadata";
import { AsmDocument } from "./asm/document";
import { collectDiagnosticsByUri } from "./lsp/diagnostics";
import { buildDocumentSymbols } from "./lsp/document-symbols";
import { buildWorkspaceSymbols } from "./lsp/workspace-symbols";
import { findDefinition, findReferences } from "./lsp/symbol-navigation";
import { buildHover } from "./lsp/hover";
import { buildCompletionItems } from "./lsp/completion";
import { buildSemanticTokens, semanticTokensLegend } from "./lsp/semantic-tokens";
import { indexWorkspace } from "./asm/workspace";

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
      documentSymbolProvider: true,
      workspaceSymbolProvider: true,
      definitionProvider: true,
      referencesProvider: true,
      hoverProvider: true,
      completionProvider: {
        resolveProvider: false,
      },
      semanticTokensProvider: {
        legend: semanticTokensLegend,
        full: true
      },
      textDocumentSync: {
        openClose: true,
        change: TextDocumentSyncKind.Full
      }
    }
  }));

  connection.onDocumentSymbol((params) => {
    const document = openDocuments.get(params.textDocument.uri);
    if (document === undefined) {
      return [];
    }

    return buildDocumentSymbols(params.textDocument.uri, document);
  });

  function getIndexedDocuments(): Map<string, AsmDocument> {
    const all = getAllDocuments();
    const overrides = new Map<string, AsmDocument>();
    
    // Normalize paths to prevent duplicate entries (e.g. file:///c:/ vs file:///C:/)
    const addedPaths = new Set<string>();
    for (const [uri, doc] of all.entries()) {
      let filePath = uri;
      if (filePath.startsWith("file://")) {
        filePath = fileURLToPath(filePath);
        addedPaths.add(filePath.toLowerCase());
      }
      overrides.set(filePath, doc);
    }

    const combined = new Map(all);
    for (const uri of openDocuments.keys()) {
      let filePath = uri;
      if (filePath.startsWith("file://")) {
        filePath = fileURLToPath(filePath);
      }
      const workspace = indexWorkspace(filePath, overrides);
      for (const [docPath, doc] of workspace.documents.entries()) {
        const normalizedDocPath = docPath.toLowerCase();
        if (!addedPaths.has(normalizedDocPath)) {
          const docUri = docPath.startsWith("untitled:") 
            ? docPath 
            : pathToFileURL(docPath).href;
          combined.set(docUri, doc);
          addedPaths.add(normalizedDocPath);
        }
      }
    }
    return combined;
  }

  connection.onWorkspaceSymbol((params) =>
    buildWorkspaceSymbols(getIndexedDocuments(), params.query)
  );

  connection.onHover((params) =>
    buildHover(
      getIndexedDocuments(),
      params.textDocument.uri,
      params.position.line,
      params.position.character
    )
  );

  connection.onCompletion((params) =>
    buildCompletionItems(
      getIndexedDocuments(),
      params.textDocument.uri,
      params.position.line,
      params.position.character
    )
  );

  connection.onDefinition((params) =>
    findDefinition(
      getIndexedDocuments(),
      params.textDocument.uri,
      params.position.line,
      params.position.character
    )
  );

  connection.onReferences((params) =>
    findReferences(
      getIndexedDocuments(),
      params.textDocument.uri,
      params.position.line,
      params.position.character,
      params.context.includeDeclaration
    )
  );

  connection.languages.semanticTokens.on((params) =>
    buildSemanticTokens(
      getIndexedDocuments(),
      params.textDocument.uri
    )
  );

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
