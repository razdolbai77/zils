import {
  Connection,
  ProposedFeatures,
  TextDocumentSyncKind,
  createConnection,
  FileChangeType,
} from "vscode-languageserver/node";
import fs from "node:fs";

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
import { buildCodeLenses } from "./lsp/code-lens";
import { buildDocumentLinks } from "./lsp/document-links";
import { prepareCallHierarchy, provideCallHierarchyIncomingCalls, provideCallHierarchyOutgoingCalls } from "./lsp/call-hierarchy";
import { buildHover } from "./lsp/hover";
import { buildCompletionItems } from "./lsp/completion";
import { buildSemanticTokens, semanticTokensLegend } from "./lsp/semantic-tokens";
import { indexWorkspace, pathKey, pathToUri, uriToPath, type DiskDocumentCache } from "./asm/workspace";

const completionTriggerCharacters = "._@ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789".split("");


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
        triggerCharacters: completionTriggerCharacters,
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
  let cachedDocumentsGeneration = 0;
  let diagnosticsGeneration = 0;
  const openDocumentVersions = new Map<string, number>();
  const diskDocumentCache: DiskDocumentCache = new Map();

  function invalidateIndexedDocuments(): void {
    cachedDocumentsGeneration += 1;
    cachedDocuments = null;
  }

  function invalidateDocumentState(): void {
    invalidateIndexedDocuments();
    diagnosticsGeneration += 1;
  }
  let inFlightIndex: { generation: number; promise: Promise<Map<string, AsmDocument>> } | null = null;

  async function buildIndexedDocuments(): Promise<Map<string, AsmDocument>> {
    const all = getAllDocuments();
    const overrides = new Map<string, AsmDocument>();

    // Normalize paths to prevent duplicate entries (e.g. file:///c:/ vs file:///C:/)
    const addedPaths = new Set<string>();
    for (const [uri, doc] of all.entries()) {
      let filePath = uri;
      if (filePath.startsWith("file://")) {
        filePath = uriToPath(filePath);
        addedPaths.add(pathKey(filePath));
      }
      overrides.set(filePath, doc);
    }

    const combined = new Map(all);
    for (const uri of openDocuments.keys()) {
      let filePath = uri;
      if (filePath.startsWith("file://")) {
        filePath = uriToPath(filePath);
      }
      const workspace = await indexWorkspace(filePath, overrides, dialect, isAsmsx, diskDocumentCache);
      for (const [docPath, doc] of workspace.documents.entries()) {
        const normalizedDocPath = pathKey(docPath);
        if (!addedPaths.has(normalizedDocPath)) {
          const docUri = docPath.startsWith("untitled:")
            ? docPath
            : pathToUri(docPath);
          combined.set(docUri, doc);
          addedPaths.add(normalizedDocPath);
        }
      }
    }
    return combined;
  }

  async function getIndexedDocuments(): Promise<Map<string, AsmDocument>> {
    if (cachedDocuments !== null) {
      return cachedDocuments;
    }

    let generation: number;
    let indexPromise: Promise<Map<string, AsmDocument>>;
    if (inFlightIndex !== null && inFlightIndex.generation === cachedDocumentsGeneration) {
      generation = inFlightIndex.generation;
      indexPromise = inFlightIndex.promise;
    } else {
      generation = cachedDocumentsGeneration;
      indexPromise = buildIndexedDocuments();
      inFlightIndex = { generation, promise: indexPromise };
      void indexPromise.finally(() => {
        if (inFlightIndex !== null && inFlightIndex.generation === generation) {
          inFlightIndex = null;
        }
      });
    }

    const combined = await indexPromise;
    if (generation !== cachedDocumentsGeneration) {
      return cachedDocuments ?? getIndexedDocuments();
    }

    cachedDocuments = combined;
    return combined;
  }

  connection.onWorkspaceSymbol(async (params) =>
    buildWorkspaceSymbols(await getIndexedDocuments(), params.query)
  );

  connection.onHover(async (params) =>
    buildHover(
      await getIndexedDocuments(),
      params.textDocument.uri,
      params.position.line,
      params.position.character,
      diskDocumentCache
    )
  );

  connection.onCompletion(async (params) =>
    buildCompletionItems(
      await getIndexedDocuments(),
      params.textDocument.uri,
      params.position.line,
      params.position.character
    )
  );

  connection.onDefinition(async (params) =>
    findDefinition(
      await getIndexedDocuments(),
      params.textDocument.uri,
      params.position.line,
      params.position.character,
      diskDocumentCache
    )
  );

  connection.onReferences(async (params) =>
    findReferences(
      await getIndexedDocuments(),
      params.textDocument.uri,
      params.position.line,
      params.position.character,
      params.context.includeDeclaration,
      diskDocumentCache
    )
  );

  connection.onRenameRequest(async (params) =>
    buildRenameEdits(
      await getIndexedDocuments(),
      params.textDocument.uri,
      params.position.line,
      params.position.character,
      params.newName,
      diskDocumentCache
    )
  );

  connection.languages.semanticTokens.on(async (params) =>
    buildSemanticTokens(
      await getIndexedDocuments(),
      params.textDocument.uri
    )
  );

  connection.onDocumentFormatting((params) => {
    const document = openDocuments.get(params.textDocument.uri);
    if (!document) return [];
    return formatDocument(document, params.options);
  });

  connection.onDocumentRangeFormatting((params) => {
    const document = openDocuments.get(params.textDocument.uri);
    if (!document) return [];
    return formatRange(document, params.options, params.range);
  });

  connection.onDocumentOnTypeFormatting((params) => {
    const document = openDocuments.get(params.textDocument.uri);
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
      await getIndexedDocuments(),
      params.textDocument.uri,
      params.position.line,
      params.position.character,
      diskDocumentCache
    );
  });

  connection.onSelectionRanges(async (params) => {
    return buildSelectionRanges(
      await getIndexedDocuments(),
      params.textDocument.uri,
      params.positions
    );
  });

  connection.onSignatureHelp(async (params) => {
    return buildSignatureHelp(
      await getIndexedDocuments(),
      params.textDocument.uri,
      params.position.line,
      params.position.character
    );
  });

  connection.languages.inlayHint.on(async (params) => {
    return buildInlayHints(
      await getIndexedDocuments(),
      params.textDocument.uri,
      params.range
    );
  });


  connection.onCodeLens(async (params) => {
    return buildCodeLenses(
      await getIndexedDocuments(),
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
      await getIndexedDocuments(),
      params.textDocument.uri,
      params.position.line,
      params.position.character,
      diskDocumentCache
    );
  });

  connection.languages.callHierarchy.onIncomingCalls(async (params) => {
    return provideCallHierarchyIncomingCalls(
      await getIndexedDocuments(),
      params.item,
      diskDocumentCache
    );
  });

  connection.languages.callHierarchy.onOutgoingCalls(async (params) => {
    return provideCallHierarchyOutgoingCalls(
      await getIndexedDocuments(),
      params.item
    );
  });

  function resolveDocumentDialect(uri: string): { dialect: CpuDialect; isAsmsx: boolean } {
    const lower = uri.toLowerCase();
    if (lower.endsWith(".z80")) {
      return { dialect: CpuDialect.Z80, isAsmsx: true };
    }
    if (lower.endsWith(".ez80")) {
      return { dialect: CpuDialect.EZ80, isAsmsx: false };
    }
    return { dialect, isAsmsx };
  }
  connection.onDidOpenTextDocument((params) => {
    invalidateDocumentState();
    const docMeta = resolveDocumentDialect(params.textDocument.uri);
    openDocuments.set(params.textDocument.uri, new AsmDocument(params.textDocument.text, docMeta.dialect, docMeta.isAsmsx));
    openDocumentVersions.set(params.textDocument.uri, params.textDocument.version);
    void publishDiagnostics();
  });

  connection.onDidChangeTextDocument((params) => {
    // The server declares TextDocumentSyncKind.Full; a ranged change or an
    // empty change list violates that contract and must not replace the
    // document text or invalidate cached state.
    const lastChange = params.contentChanges.at(-1);
    if (lastChange === undefined || "range" in lastChange) {
      return;
    }

    invalidateDocumentState();
    const nextText = lastChange.text;

    const docMeta = resolveDocumentDialect(params.textDocument.uri);
    openDocuments.set(params.textDocument.uri, new AsmDocument(nextText, docMeta.dialect, docMeta.isAsmsx));
    openDocumentVersions.set(params.textDocument.uri, params.textDocument.version);
    void publishDiagnostics();
  });

  connection.onDidCloseTextDocument((params) => {
    invalidateDocumentState();
    openDocuments.delete(params.textDocument.uri);
    openDocumentVersions.delete(params.textDocument.uri);
    void publishDiagnostics();
  });

  connection.onDidChangeWatchedFiles(async (params) => {
    const watchedFileUpdates = await Promise.all(params.changes.map(async (change) => {
      if (change.type === FileChangeType.Deleted) {
        return { change, source: null };
      }

      try {
        let filePath = change.uri;
        if (filePath.startsWith("file://")) {
          filePath = uriToPath(filePath);
        }
        const source = await fs.promises.readFile(filePath, "utf8");
        return { change, source };
      } catch {
        return { change, source: null };
      }
    }));

    invalidateDocumentState();
    for (const update of watchedFileUpdates) {
      const cachedFilePath = update.change.uri.startsWith("file://") ? uriToPath(update.change.uri) : null;
      if (update.change.type === FileChangeType.Deleted || update.source === null) {
        watchedDocuments.delete(update.change.uri);
        if (cachedFilePath !== null) {
          diskDocumentCache.delete(pathKey(cachedFilePath));
        }
      } else {
        const docMeta = resolveDocumentDialect(update.change.uri);
        const nextDocument = new AsmDocument(update.source, docMeta.dialect, docMeta.isAsmsx);
        watchedDocuments.set(update.change.uri, nextDocument);
        if (cachedFilePath !== null) {
          try {
            const stats = await fs.promises.stat(cachedFilePath);
            diskDocumentCache.set(pathKey(cachedFilePath), { document: nextDocument, mtimeMs: stats.mtimeMs });
          } catch {
            diskDocumentCache.delete(pathKey(cachedFilePath));
          }
        }
      }
    }

    await publishDiagnostics();
  });

  const publishedUris = new Set<string>();

  async function publishDiagnostics(): Promise<void> {
    const requestGeneration = diagnosticsGeneration;
    const indexedDocuments = await getIndexedDocuments();
    const diagnosticsByUri = await collectDiagnosticsByUri(indexedDocuments, dialect, isAsmsx, diskDocumentCache);
    if (requestGeneration !== diagnosticsGeneration) {
      return;
    }

    for (const [uri, diagnostics] of diagnosticsByUri.entries()) {
      publishedUris.add(uri);
      void connection.sendDiagnostics({
        uri,
        diagnostics: [...diagnostics],
        version: openDocumentVersions.get(uri)
      });
    }

    // URIs that dropped out of the indexed set (closed documents, removed
    // includes) are cleared through the same guarded path instead of a
    // racy out-of-band send.
    for (const publishedUri of publishedUris) {
      if (!diagnosticsByUri.has(publishedUri)) {
        publishedUris.delete(publishedUri);
        void connection.sendDiagnostics({
          uri: publishedUri,
          diagnostics: [],
          version: openDocumentVersions.get(publishedUri)
        });
      }
    }
  }

  connection.listen();
  return connection;
}

if (require.main === module) {
  startServer();
}
