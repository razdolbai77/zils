import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";
import { FileChangeType } from "vscode-languageserver/node";

type JsonRpcMessage = {
  id?: number;
  jsonrpc: "2.0";
  method?: string;
  params?: unknown;
  result?: unknown;
};

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

function encodeMessage(message: object): string {
  const body = JSON.stringify(message);
  return `Content-Length: ${Buffer.byteLength(body, "utf8")}\r\n\r\n${body}`;
}

function decodeMessages(streamBuffer: string): { messages: JsonRpcMessage[]; rest: string } {
  const messages: JsonRpcMessage[] = [];
  let buffer = streamBuffer;

  for (;;) {
    const separator = buffer.indexOf("\r\n\r\n");
    if (separator === -1) {
      return { messages, rest: buffer };
    }

    const header = buffer.slice(0, separator);
    const match = /Content-Length: (\d+)/i.exec(header);
    if (!match) {
      throw new Error(`Missing Content-Length header: ${header}`);
    }

    const length = Number(match[1]);
    const body = buffer.slice(separator + 4);
    if (Buffer.byteLength(body, "utf8") < length) {
      return { messages, rest: buffer };
    }

    messages.push(JSON.parse(body.slice(0, length)) as JsonRpcMessage);
    buffer = body.slice(length);
  }
}

test("watched file updates refresh dependency diagnostics for changed, unreadable, and deleted files", async () => {
  const serverPath = path.resolve(__dirname, "helpers/watched-files-harness.js");
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "zils-watched-"));
  const mainPath = path.join(tempDir, "main.asm");
  const depPath = path.join(tempDir, "dep.asm");
  const mainText = '  include "dep.asm"\nld a, CONST';
  const depUri = pathToFileURL(depPath).href;
  const mainUri = pathToFileURL(mainPath).href;

  fs.writeFileSync(mainPath, mainText, "utf8");
  fs.writeFileSync(depPath, "CONST: equ 1\n", "utf8");

  const child = spawn(process.execPath, [serverPath, "--stdio"], {
    stdio: ["pipe", "pipe", "pipe"]
  });

  let stdout = "";
  let nextId = 1;
  const pending = new Map<number, (message: JsonRpcMessage) => void>();
  const diagnosticWaiters: Array<(params: PublishDiagnosticsParams) => void> = [];

  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => {
    stdout += chunk;
    const decoded = decodeMessages(stdout);
    stdout = decoded.rest;

    for (const message of decoded.messages) {
      if (message.id !== undefined) {
        pending.get(message.id)?.(message);
        pending.delete(message.id);
        continue;
      }

      if (message.method === "textDocument/publishDiagnostics") {
        const params = message.params as PublishDiagnosticsParams;
        const waiter = diagnosticWaiters.shift();
        waiter?.(params);
      }
    }
  });

  function sendRequest(method: string, params: object): Promise<JsonRpcMessage> {
    const id = nextId++;
    child.stdin.write(encodeMessage({ id, jsonrpc: "2.0", method, params }));
    return new Promise((resolve) => {
      pending.set(id, resolve);
    });
  }

  function sendNotification(method: string, params: object): void {
    child.stdin.write(encodeMessage({ jsonrpc: "2.0", method, params }));
  }

  function waitForDiagnostics(): Promise<PublishDiagnosticsParams> {
    return new Promise((resolve) => {
      diagnosticWaiters.push(resolve);
    });
  }

  try {
    await sendRequest("initialize", {
      capabilities: {},
      processId: process.pid,
      rootUri: null
    });

    sendNotification("initialized", {});

    const initialDiagnostics = waitForDiagnostics();
    sendNotification("textDocument/didOpen", {
      textDocument: {
        uri: mainUri,
        languageId: "asm",
        version: 1,
        text: mainText
      }
    });

    assert.deepEqual((await initialDiagnostics).diagnostics, []);

    sendNotification("harness/activateWatchedReadMock", {});

    const changedDiagnostics = waitForDiagnostics();
    sendNotification("workspace/didChangeWatchedFiles", {
      changes: [{ uri: depUri, type: FileChangeType.Changed }]
    });
    assert.ok((await changedDiagnostics).diagnostics.some((diagnostic) => diagnostic.message.includes("Unresolved symbol: CONST")));

    fs.rmSync(depPath, { force: true });
    const unreadableDiagnostics = waitForDiagnostics();
    sendNotification("workspace/didChangeWatchedFiles", {
      changes: [{ uri: depUri, type: FileChangeType.Changed }]
    });
    assert.deepEqual((await unreadableDiagnostics).diagnostics, []);

    fs.writeFileSync(depPath, "CONST: equ 1\n", "utf8");
    const restoredDiagnostics = waitForDiagnostics();
    sendNotification("workspace/didChangeWatchedFiles", {
      changes: [{ uri: depUri, type: FileChangeType.Changed }]
    });
    assert.deepEqual((await restoredDiagnostics).diagnostics, []);

    fs.rmSync(depPath, { force: true });
    const deletedDiagnostics = waitForDiagnostics();
    sendNotification("workspace/didChangeWatchedFiles", {
      changes: [{ uri: depUri, type: FileChangeType.Deleted }]
    });
    assert.ok((await deletedDiagnostics).diagnostics.some((diagnostic) => diagnostic.message.includes("Unresolved symbol: CONST")));
  } finally {
    child.kill();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
