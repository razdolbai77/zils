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
import { buildRenameEdits } from "./lsp/rename";
import { formatDocument, formatRange, formatOnType } from "./lsp/formatting";
import { buildFoldingRanges } from "./lsp/folding-ranges";
import { buildDocumentHighlights } from "./lsp/document-highlights";
import { buildSelectionRanges } from "./lsp/selection-ranges";
import { buildSignatureHelp } from "./lsp/signature-help";
import { buildInlayHints } from "./lsp/inlay-hints";
import { provideCodeActions } from "./lsp/code-actions";
import { buildCodeLenses } from "./lsp/code-lens";
import { buildDocumentLinks } from "./lsp/document-links";
import { prepareCallHierarchy, provideCallHierarchyIncomingCalls, provideCallHierarchyOutgoingCalls } from "./lsp/call-hierarchy";
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
  dialect: CpuDialect = CpuDialect.EZ80,
  isAsmsx: boolean = false,
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
      renameProvider: true,
      documentFormattingProvider: true,
      documentRangeFormattingProvider: true,
      documentOnTypeFormattingProvider: {
        firstTriggerCharacter: "\n"
      },
      semanticTokensProvider: {
        legend: semanticTokensLegend,
        full: true
      },
      foldingRangeProvider: true,
      documentHighlightProvider: true,
      selectionRangeProvider: true,
      signatureHelpProvider: {
        triggerCharacters: ["(", ","]
      },
      inlayHintProvider: true,
      codeActionProvider: true,
      codeLensProvider: { resolveProvider: false },
      documentLinkProvider: { resolveProvider: false },
      callHierarchyProvider: true,
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

  let cachedDocuments: Map<string, AsmDocument> | null = null;

  async function getIndexedDocuments(): Promise<Map<string, AsmDocument>> {
    if (cachedDocuments !== null) {
      return cachedDocuments;
    }

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
      const workspace = await indexWorkspace(filePath, overrides, dialect, isAsmsx);
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
    
    cachedDocuments = combined;
    return combined;
  }

  connection.onWorkspaceSymbol(async (params) =>
    buildWorkspaceSymbols((await getIndexedDocuments()), params.query)
  );

  connection.onHover(async (params) =>
    buildHover(
      (await getIndexedDocuments()),
      params.textDocument.uri,
      params.position.line,
      params.position.character
    )
  );

  connection.onCompletion(async (params) =>
    buildCompletionItems(
      (await getIndexedDocuments()),
      params.textDocument.uri,
      params.position.line,
      params.position.character
    )
  );

  connection.onDefinition(async (params) =>
    findDefinition(
      (await getIndexedDocuments()),
      params.textDocument.uri,
      params.position.line,
      params.position.character
    )
  );

  connection.onReferences(async (params) =>
    findReferences(
      (await getIndexedDocuments()),
      params.textDocument.uri,
      params.position.line,
      params.position.character,
      params.context.includeDeclaration
    )
  );

  connection.onRenameRequest(async (params) =>
    buildRenameEdits(
      (await getIndexedDocuments()),
      params.textDocument.uri,
      params.position.line,
      params.position.character,
      params.newName
    )
  );

  connection.languages.semanticTokens.on(async (params) =>
    buildSemanticTokens(
      (await getIndexedDocuments()),
      params.textDocument.uri
    )
  );

  connection.onDocumentFormatting(async (params) => {
    const document = (await getIndexedDocuments()).get(params.textDocument.uri);
    if (!document) return [];
    return formatDocument(document, params.options);
  });

  connection.onDocumentRangeFormatting(async (params) => {
    const document = (await getIndexedDocuments()).get(params.textDocument.uri);
    if (!document) return [];
    return formatRange(document, params.options, params.range);
  });

  connection.onDocumentOnTypeFormatting(async (params) => {
    const document = (await getIndexedDocuments()).get(params.textDocument.uri);
    if (!document) return [];
    return formatOnType(document, params.options, params.position, params.ch);
  });

  connection.onFoldingRanges(async (params) => {
    const document = (await getIndexedDocuments()).get(params.textDocument.uri);
    if (!document) return [];
    return buildFoldingRanges(document);
  });

  connection.onDocumentHighlight(async (params) => {
    return buildDocumentHighlights(
      (await getIndexedDocuments()),
      params.textDocument.uri,
      params.position.line,
      params.position.character
    );
  });

  connection.onSelectionRanges(async (params) => {
    return buildSelectionRanges(
      (await getIndexedDocuments()),
      params.textDocument.uri,
      params.positions
    );
  });

  connection.onSignatureHelp(async (params) => {
    return buildSignatureHelp(
      (await getIndexedDocuments()),
      params.textDocument.uri,
      params.position.line
    );
  });

  connection.languages.inlayHint.on(async (params) => {
    return buildInlayHints(
      (await getIndexedDocuments()),
      params.textDocument.uri
    );
  });

  connection.onCodeAction(async (params) => {
    return provideCodeActions(
      (await getIndexedDocuments()),
      params.textDocument.uri,
      params.context.diagnostics
    );
  });

  connection.onCodeLens(async (params) => {
    return buildCodeLenses(
      (await getIndexedDocuments()),
      params.textDocument.uri
    );
  });

  connection.onDocumentLinks(async (params) => {
    const doc = (await getIndexedDocuments()).get(params.textDocument.uri);
    if (!doc) return [];
    return buildDocumentLinks(params.textDocument.uri, doc);
  });

  connection.languages.callHierarchy.onPrepare(async (params) => {
    return prepareCallHierarchy(
      (await getIndexedDocuments()),
      params.textDocument.uri,
      params.position.line,
      params.position.character
    );
  });

  connection.languages.callHierarchy.onIncomingCalls(async (params) => {
    return provideCallHierarchyIncomingCalls(
      (await getIndexedDocuments()),
      params.item
    );
  });

  connection.languages.callHierarchy.onOutgoingCalls(async (params) => {
    return provideCallHierarchyOutgoingCalls(
      (await getIndexedDocuments()),
      params.item
    );
  });

  connection.onDidOpenTextDocument(async (params) => {
    cachedDocuments = null;
    openDocuments.set(params.textDocument.uri, new AsmDocument(params.textDocument.text, dialect, isAsmsx));
    await publishDiagnostics();
  });

  connection.onDidChangeTextDocument(async (params) => {
    cachedDocuments = null;
    const nextText = params.contentChanges.at(-1)?.text;
    if (nextText === undefined) {
      return;
    }

    openDocuments.set(params.textDocument.uri, new AsmDocument(nextText, dialect, isAsmsx));
    await publishDiagnostics();
  });

  connection.onDidCloseTextDocument(async (params) => {
    cachedDocuments = null;
    openDocuments.delete(params.textDocument.uri);
    void connection.sendDiagnostics({
      uri: params.textDocument.uri,
      diagnostics: []
    });
    await publishDiagnostics();
  });

  connection.onDidChangeWatchedFiles(async (params) => {
    cachedDocuments = null;
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
          watchedDocuments.set(change.uri, new AsmDocument(source, dialect, isAsmsx));
        } catch {
          watchedDocuments.delete(change.uri);
        }
      }
    }
    await publishDiagnostics();
  });

  async function publishDiagnostics(): Promise<void> {
    for (const [uri, diagnostics] of (await collectDiagnosticsByUri(openDocuments, getAllDocuments())).entries()) {
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
