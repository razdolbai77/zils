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

test("repeat LSP requests reuse cached symbol tables", async () => {
  const harnessPath = path.resolve(__dirname, "helpers/symbol-collection-harness.js");
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "zils-symbol-cache-"));
  const mainPath = path.join(tempDir, "main.asm");
  const mainUri = normalizeUri(pathToFileURL(mainPath).href);
  const source = "VALUE equ 3\nMAIN:\n  jp MAIN\n";

  fs.writeFileSync(mainPath, source, "utf8");

  const child = spawn(process.execPath, [harnessPath, "--stdio"], {
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
      textDocument: { uri: mainUri, languageId: "asm", version: 1, text: source }
    });
    await initialDiagnostics;

    const baselineResponse = await sendRequest("harness/collectCount", {});
    const baselineCount = Number(baselineResponse.result);
    assert.ok(baselineCount > 0, "the initial publish must collect symbols");

    // Every symbol-table consumer, twice: code lens, inlay hints, semantic
    // tokens, completion, rename, and document highlights. With the cache,
    // none of these may construct another SymbolCollector.
    for (let round = 0; round < 2; round++) {
      await sendRequest("textDocument/codeLens", { textDocument: { uri: mainUri } });
      await sendRequest("textDocument/inlayHint", {
        textDocument: { uri: mainUri },
        range: { start: { line: 0, character: 0 }, end: { line: 2, character: 0 } }
      });
      await sendRequest("textDocument/semanticTokens/full", { textDocument: { uri: mainUri } });
      await sendRequest("textDocument/completion", {
        textDocument: { uri: mainUri },
        position: { line: 2, character: 7 }
      });
      await sendRequest("textDocument/rename", {
        textDocument: { uri: mainUri },
        position: { line: 2, character: 6 },
        newName: "RENAMED"
      });
      await sendRequest("textDocument/documentHighlight", {
        textDocument: { uri: mainUri },
        position: { line: 1, character: 0 }
      });
    }

    const finalResponse = await sendRequest("harness/collectCount", {});
    assert.equal(
      Number(finalResponse.result) - baselineCount,
      0,
      "repeat requests over an unchanged index must not re-collect symbols"
    );
  } finally {
    child.kill();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
