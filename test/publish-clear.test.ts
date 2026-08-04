import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { normalizeUri } from "../src/asm/workspace";

import { createPromiseResolvers, startJsonRpcClient, type JsonRpcClient } from "./helpers/json-rpc-client";

type PublishDiagnosticsParams = {
  uri: string;
  diagnostics: Array<{ message: string }>;
};

function waitForPublishFor(client: JsonRpcClient, uri: string, predicate: (params: PublishDiagnosticsParams) => boolean): Promise<PublishDiagnosticsParams> {
  const { promise, resolve } = createPromiseResolvers<PublishDiagnosticsParams>();
  const unsubscribe = client.onNotification((message) => {
    if (message.method !== "textDocument/publishDiagnostics") {
      return;
    }

    const params = message.params as PublishDiagnosticsParams;
    if (params.uri === uri && predicate(params)) {
      unsubscribe();
      resolve(params);
    }
  });
  return promise;
}

test("dropped includes and closed documents receive clearing publishes", async () => {
  const serverPath = path.resolve(__dirname, "../src/server.js");
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "zils-publish-clear-"));
  const mainPath = path.join(tempDir, "main.asm");
  const brokenPath = path.join(tempDir, "broken.asm");
  const mainUri = normalizeUri(pathToFileURL(mainPath).href);
  const brokenUri = normalizeUri(pathToFileURL(brokenPath).href);

  fs.writeFileSync(brokenPath, "ld a, UNDEF_SYM\n", "utf8");

  const client = startJsonRpcClient(process.execPath, [serverPath, "--stdio"]);

  try {
    await client.request("initialize", { processId: process.pid, rootUri: null, capabilities: {} });
    client.notify("initialized", {});

    const brokenPublished = waitForPublishFor(client, brokenUri, (params) => params.diagnostics.length > 0);
    client.notify("textDocument/didOpen", {
      textDocument: {
        uri: mainUri,
        languageId: "asm",
        version: 1,
        text: '  include "broken.asm"\n  nop\n'
      }
    });
    await brokenPublished;

    // Dropping the include removes the file from the indexed set; its
    // diagnostics must be cleared through the guarded publish path.
    const brokenCleared = waitForPublishFor(client, brokenUri, (params) => params.diagnostics.length === 0);
    client.notify("textDocument/didChange", {
      textDocument: { uri: mainUri, version: 2 },
      contentChanges: [{ text: "  nop\n" }]
    });
    await brokenCleared;

    // Rapid close/reopen: the close must clear through the same guarded
    // path and the reopen publish must win with the fixed content.
    const reopened = waitForPublishFor(client, mainUri, (params) => params.diagnostics.length === 0);
    client.notify("textDocument/didClose", { textDocument: { uri: mainUri } });
    client.notify("textDocument/didOpen", {
      textDocument: { uri: mainUri, languageId: "asm", version: 3, text: "  nop\n" }
    });
    await reopened;
  } finally {
    client.stop();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
