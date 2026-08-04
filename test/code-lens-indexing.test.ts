import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";
import { normalizeUri } from "../src/asm/workspace";

type JsonRpcMessage = {
  id?: number;
  jsonrpc: "2.0";
  method?: string;
  params?: unknown;
  result?: unknown;
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

test("code lens requests index the workspace only once", async () => {
  const serverPath = path.resolve(__dirname, "helpers/code-lens-harness.js");
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "zils-code-lens-"));
  const mainPath = path.join(tempDir, "main.asm");
  const mainUri = normalizeUri(pathToFileURL(mainPath).href);
  const source = "MAIN:\n  jp MAIN\nOTHER:\n  jp MAIN\n";

  fs.writeFileSync(mainPath, source, "utf8");

  const child = spawn(process.execPath, [serverPath, "--stdio"], {
    stdio: ["pipe", "pipe", "pipe"]
  });

  let stdout = "";
  let nextId = 1;
  const pending = new Map<number, (message: JsonRpcMessage) => void>();
  const diagnosticWaiters: Array<() => void> = [];

  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => {
    stdout += chunk;
    const decoded = decodeMessages(stdout);
    stdout = decoded.rest;

    for (const message of decoded.messages) {
      if (message.method === "textDocument/publishDiagnostics") {
        diagnosticWaiters.shift()?.();
        continue;
      }

      if (message.id !== undefined) {
        pending.get(message.id)?.(message);
        pending.delete(message.id);
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

  function waitForDiagnostics(): Promise<void> {
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
        text: source
      }
    });
    await initialDiagnostics;
    // The publish triggered by didOpen already indexed the workspace; the
    // code lens request must reuse that cached index instead of re-indexing.
    const baselineCountResponse = await sendRequest("harness/indexCount", {});
    const baselineCount = Number(baselineCountResponse.result);
    assert.ok(baselineCount > 0, "the initial publish must index the workspace");
    await sendRequest("textDocument/codeLens", {
      textDocument: { uri: mainUri }
    });

    const countResponse = await sendRequest("harness/indexCount", {});
    assert.equal(Number(countResponse.result) - baselineCount, 0);
  } finally {
    child.kill();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
