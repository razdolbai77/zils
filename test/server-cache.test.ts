import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { normalizeUri } from "../src/asm/workspace";

import { createPromiseResolvers, startJsonRpcClient, type JsonRpcClient } from "./helpers/json-rpc-client";

type WorkspaceSymbolResult = Array<{ name: string }>;

type IndexObserver = {
  started: (call: number) => Promise<void>;
  seen: (call: number) => boolean;
  release: (call: number) => void;
};

function observeIndexPasses(client: JsonRpcClient): IndexObserver {
  const seenCalls = new Set<number>();
  const startedGates = new Map<number, () => void>();

  const markStarted = (call: number): void => {
    seenCalls.add(call);
    startedGates.get(call)?.();
  };

  client.onNotification((message) => {
    if (message.method === "harness/indexStarted") {
      const params = message.params as { call?: number };
      markStarted(params.call ?? 0);
    }
  });

  return {
    started(call: number): Promise<void> {
      if (seenCalls.has(call)) {
        return Promise.resolve();
      }

      const { promise, resolve } = createPromiseResolvers<void>();
      startedGates.set(call, resolve);
      return promise;
    },
    seen(call: number): boolean {
      return seenCalls.has(call);
    },
    release(call: number): void {
      client.notify("harness/releaseIndex", { call });
    }
  };
}

async function initializeAndOpen(client: JsonRpcClient, text: string): Promise<string> {
  await client.request("initialize", { processId: process.pid, rootUri: null, capabilities: {} });
  client.notify("initialized", {});

  const documentUri = normalizeUri(pathToFileURL(path.resolve("/race-cache.asm")).href);
  client.notify("textDocument/didOpen", {
    textDocument: {
      uri: documentUri,
      languageId: "asm",
      version: 1,
      text
    }
  });

  return documentUri;
}

test("workspace symbol cache ignores stale in-flight index results", async () => {
  const harnessPath = path.resolve(__dirname, "helpers/server-cache-harness.js");
  const client = startJsonRpcClient(process.execPath, [harnessPath, "--stdio"]);
  const observer = observeIndexPasses(client);

  try {
    const documentUri = await initializeAndOpen(client, "old_label:\n  nop\n");

    const firstWorkspaceSymbols = client.request("workspace/symbol", { query: "" });
    await observer.started(0);

    client.notify("textDocument/didChange", {
      textDocument: { uri: documentUri, version: 2 },
      contentChanges: [{ text: "new_label:\n  nop\n" }]
    });

    const secondWorkspaceSymbols = client.request("workspace/symbol", { query: "" });
    observer.release(0);

    const secondResult = (await secondWorkspaceSymbols).result as WorkspaceSymbolResult;
    assert.ok(secondResult.some((symbol) => symbol.name === "new_label"));
    assert.ok(!secondResult.some((symbol) => symbol.name === "old_label"));

    await firstWorkspaceSymbols;

    const finalResult = (await client.request("workspace/symbol", { query: "" })).result as WorkspaceSymbolResult;
    assert.ok(finalResult.some((symbol) => symbol.name === "new_label"));
    assert.ok(!finalResult.some((symbol) => symbol.name === "old_label"));
  } finally {
    client.stop();
  }
});

test("overlapping workspace symbol requests share one indexing pass", async () => {
  const harnessPath = path.resolve(__dirname, "helpers/server-cache-harness.js");
  const client = startJsonRpcClient(process.execPath, [harnessPath, "--stdio"]);
  const observer = observeIndexPasses(client);

  try {
    await initializeAndOpen(client, "shared_label:\n  nop\n");

    const firstRequest = client.request("workspace/symbol", { query: "" });
    await observer.started(0);

    const secondRequest = client.request("workspace/symbol", { query: "" });
    // The server dispatches stdin messages in order and makes the
    // join-or-index decision synchronously at handler start, so once the
    // ping's error response arrives the second request has already joined
    // the in-flight pass or started its own.
    await client.request("harness/ping", {});
    assert.ok(!observer.seen(1), "the overlapping request must join the in-flight indexing pass");

    observer.release(0);

    const firstResult = (await firstRequest).result as WorkspaceSymbolResult;
    const secondResult = (await secondRequest).result as WorkspaceSymbolResult;
    assert.deepEqual(firstResult, secondResult);
    assert.ok(firstResult.some((symbol) => symbol.name === "shared_label"));
  } finally {
    client.stop();
  }
});
