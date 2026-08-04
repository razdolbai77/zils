import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { normalizeUri } from "../src/asm/workspace";

import { createPromiseResolvers, startJsonRpcClient, type JsonRpcClient } from "./helpers/json-rpc-client";

type PublishDiagnosticsParams = {
  uri: string;
  diagnostics: Array<{ message: string }>;
};

type DocumentSymbolResult = Array<{ name: string }>;

function waitForDiagnosticsFor(client: JsonRpcClient, uri: string): Promise<PublishDiagnosticsParams> {
  const { promise, resolve } = createPromiseResolvers<PublishDiagnosticsParams>();
  const unsubscribe = client.onNotification((message) => {
    if (message.method !== "textDocument/publishDiagnostics") {
      return;
    }

    const params = message.params as PublishDiagnosticsParams;
    if (params.uri === uri) {
      unsubscribe();
      resolve(params);
    }
  });
  return promise;
}

test("didChange ignores empty and incremental content changes under full sync", async () => {
  const serverPath = path.resolve(__dirname, "../src/server.js");
  const mainUri = normalizeUri(pathToFileURL(path.resolve("/didchange-guard.asm")).href);
  const brokenText = "BAD_SYM:\n  ld a, UNDEF\n";
  const fixedText = "BAD_SYM:\n  nop\n";

  const client = startJsonRpcClient(process.execPath, [serverPath, "--stdio"]);
  const publishes: PublishDiagnosticsParams[] = [];
  client.onNotification((message) => {
    if (message.method === "textDocument/publishDiagnostics") {
      publishes.push(message.params as PublishDiagnosticsParams);
    }
  });

  try {
    await client.request("initialize", { processId: process.pid, rootUri: null, capabilities: {} });
    client.notify("initialized", {});

    const opened = waitForDiagnosticsFor(client, mainUri);
    client.notify("textDocument/didOpen", {
      textDocument: { uri: mainUri, languageId: "asm", version: 1, text: brokenText }
    });
    assert.ok((await opened).diagnostics.length > 0);

    // An empty contentChanges array must not invalidate or publish.
    client.notify("textDocument/didChange", {
      textDocument: { uri: mainUri, version: 2 },
      contentChanges: []
    });
    await client.request("workspace/symbol", { query: "" });
    assert.equal(publishes.length, 1, "empty contentChanges must not publish");

    // An incremental (ranged) change violates the declared Full sync kind
    // and must be ignored instead of replacing the document text.
    client.notify("textDocument/didChange", {
      textDocument: { uri: mainUri, version: 3 },
      contentChanges: [
        {
          range: {
            start: { line: 1, character: 2 },
            end: { line: 1, character: 11 }
          },
          text: "nop"
        }
      ]
    });
    await client.request("workspace/symbol", { query: "" });
    assert.equal(publishes.length, 1, "incremental changes must not publish");

    const symbols = (await client.request("textDocument/documentSymbol", {
      textDocument: { uri: mainUri }
    })).result as DocumentSymbolResult;
    assert.ok(symbols.some((symbol) => symbol.name === "BAD_SYM"), "the document text must be unchanged");

    const fixed = waitForDiagnosticsFor(client, mainUri);
    client.notify("textDocument/didChange", {
      textDocument: { uri: mainUri, version: 4 },
      contentChanges: [{ text: fixedText }]
    });
    assert.deepEqual((await fixed).diagnostics, []);
  } finally {
    client.stop();
  }
});
