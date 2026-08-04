import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { normalizeUri } from "../src/asm/workspace";
import { FileChangeType } from "vscode-languageserver/node";

import { createPromiseResolvers, startJsonRpcClient, type JsonRpcClient } from "./helpers/json-rpc-client";

type PublishedDiagnostic = {
  message: string;
  severity?: number;
  range: {
    start: {
      line: number;
      character: number;
    };
    end: {
      line: number;
      character: number;
    };
  };
};

type PublishDiagnosticsParams = {
  uri: string;
  diagnostics: PublishedDiagnostic[];
};

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

async function openMain(client: JsonRpcClient, mainUri: string, mainText: string): Promise<PublishDiagnosticsParams> {
  await client.request("initialize", {
    capabilities: {},
    processId: process.pid,
    rootUri: null
  });

  client.notify("initialized", {});

  const initialDiagnostics = waitForDiagnosticsFor(client, mainUri);
  client.notify("textDocument/didOpen", {
    textDocument: {
      uri: mainUri,
      languageId: "asm",
      version: 1,
      text: mainText
    }
  });

  return initialDiagnostics;
}

test("watched file updates refresh dependency diagnostics for changed, unreadable, and deleted files", async () => {
  const serverPath = path.resolve(__dirname, "helpers/watched-files-harness.js");
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "zils-watched-"));
  const mainPath = path.join(tempDir, "main.asm");
  const depPath = path.join(tempDir, "dep.asm");
  const mainText = '  include "dep.asm"\nld a, CONST';
  const depUri = normalizeUri(pathToFileURL(depPath).href);
  const mainUri = normalizeUri(pathToFileURL(mainPath).href);

  fs.writeFileSync(mainPath, mainText, "utf8");
  fs.writeFileSync(depPath, "CONST: equ 1\n", "utf8");

  const client = startJsonRpcClient(process.execPath, [serverPath, "--stdio"]);

  try {
    assert.deepEqual((await openMain(client, mainUri, mainText)).diagnostics, []);

    client.notify("harness/activateWatchedReadMock", {});

    const changedDiagnostics = waitForDiagnosticsFor(client, mainUri);
    client.notify("workspace/didChangeWatchedFiles", {
      changes: [{ uri: depUri, type: FileChangeType.Changed }]
    });
    assert.ok((await changedDiagnostics).diagnostics.some((diagnostic) => diagnostic.message.includes("Unresolved symbol: CONST")));

    fs.rmSync(depPath, { force: true });
    const unreadableDiagnostics = waitForDiagnosticsFor(client, mainUri);
    client.notify("workspace/didChangeWatchedFiles", {
      changes: [{ uri: depUri, type: FileChangeType.Changed }]
    });
    assert.deepEqual((await unreadableDiagnostics).diagnostics, []);

    fs.writeFileSync(depPath, "CONST: equ 1\n", "utf8");
    const restoredDiagnostics = waitForDiagnosticsFor(client, mainUri);
    client.notify("workspace/didChangeWatchedFiles", {
      changes: [{ uri: depUri, type: FileChangeType.Changed }]
    });
    assert.deepEqual((await restoredDiagnostics).diagnostics, []);

    fs.rmSync(depPath, { force: true });
    const deletedDiagnostics = waitForDiagnosticsFor(client, mainUri);
    client.notify("workspace/didChangeWatchedFiles", {
      changes: [{ uri: depUri, type: FileChangeType.Deleted }]
    });
    assert.ok((await deletedDiagnostics).diagnostics.some((diagnostic) => diagnostic.message.includes("Unresolved symbol: CONST")));
  } finally {
    client.stop();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("maclib .lib edits refresh diagnostics through the watched-file path", async () => {
  const serverPath = path.resolve(__dirname, "../src/server.js");
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "zils-watched-lib-"));
  const mainPath = path.join(tempDir, "main.ez80");
  const libPath = path.join(tempDir, "lib.lib");
  const mainText = '  maclib "lib.lib"\nld a, LIB_SYM';
  const libUri = normalizeUri(pathToFileURL(libPath).href);
  const mainUri = normalizeUri(pathToFileURL(mainPath).href);

  fs.writeFileSync(mainPath, mainText, "utf8");
  fs.writeFileSync(libPath, "LIB_SYM: equ 1\n", "utf8");

  const client = startJsonRpcClient(process.execPath, [serverPath, "--stdio"]);

  try {
    assert.deepEqual((await openMain(client, mainUri, mainText)).diagnostics, []);

    fs.writeFileSync(libPath, "OTHER_SYM: equ 1\n", "utf8");
    const changedDiagnostics = waitForDiagnosticsFor(client, mainUri);
    client.notify("workspace/didChangeWatchedFiles", {
      changes: [{ uri: libUri, type: FileChangeType.Changed }]
    });
    assert.ok(
      (await changedDiagnostics).diagnostics.some((diagnostic) => diagnostic.message.includes("Unresolved symbol: LIB_SYM"))
    );

    fs.writeFileSync(libPath, "LIB_SYM: equ 1\n", "utf8");
    const restoredDiagnostics = waitForDiagnosticsFor(client, mainUri);
    client.notify("workspace/didChangeWatchedFiles", {
      changes: [{ uri: libUri, type: FileChangeType.Changed }]
    });
    assert.deepEqual((await restoredDiagnostics).diagnostics, []);
  } finally {
    client.stop();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
