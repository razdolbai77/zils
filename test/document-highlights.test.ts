import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { spawn } from "node:child_process";
import { type DocumentHighlight, DocumentHighlightKind } from "vscode-languageserver/node";

type JsonRpcMessage = {
  jsonrpc: "2.0";
  id?: number;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: unknown;
};

const HIGHLIGHT_SOURCE = [
  "MY_LBL: ld a, 1",
  "  jp MY_LBL"
].join("\n");

test("LSP Document Highlights", async (t) => {
  const serverPath = path.resolve(__dirname, "../../dist/src/cli.js");
  const mainPath = path.resolve(
    __dirname,
    "../../test/fixtures/valid/highlights.asm"
  );
  
  fs.writeFileSync(mainPath, HIGHLIGHT_SOURCE, "utf8");
  
  const mainUri = pathToFileURL(mainPath).href;

  const child = spawn("node", [serverPath, "--stdio"], {
    stdio: ["pipe", "pipe", "pipe"]
  });

  let messageBuffer = "";
  const responses = new Map<number, JsonRpcMessage>();

  child.stdout.on("data", (chunk: Buffer) => {
    messageBuffer += chunk.toString("utf8");
    while (true) {
      const match = messageBuffer.match(/^Content-Length: (\d+)\r\n\r\n/);
      if (!match) break;

      const length = Number.parseInt(match[1], 10);
      const headerLength = match[0].length;

      if (messageBuffer.length < headerLength + length) break;

      const body = messageBuffer.slice(headerLength, headerLength + length);
      messageBuffer = messageBuffer.slice(headerLength + length);

      const msg = JSON.parse(body) as JsonRpcMessage;
      if (msg.id !== undefined && msg.result !== undefined) {
        responses.set(msg.id, msg);
      }
    }
  });

  let nextId = 1;

  async function sendRequest(method: string, params: unknown): Promise<JsonRpcMessage> {
    const id = nextId++;
    const payload = JSON.stringify({ jsonrpc: "2.0", id, method, params });
    const message = `Content-Length: ${Buffer.byteLength(payload)}\r\n\r\n${payload}`;
    child.stdin.write(message);

    return new Promise((resolve) => {
      const interval = setInterval(() => {
        if (responses.has(id)) {
          clearInterval(interval);
          resolve(responses.get(id)!);
        }
      }, 10);
    });
  }

  function sendNotification(method: string, params: unknown) {
    const payload = JSON.stringify({ jsonrpc: "2.0", method, params });
    const message = `Content-Length: ${Buffer.byteLength(payload)}\r\n\r\n${payload}`;
    child.stdin.write(message);
  }

  await t.test("initialize and open documents", async () => {
    await sendRequest("initialize", {
      processId: process.pid,
      rootUri: null,
      capabilities: {}
    });

    sendNotification("textDocument/didOpen", {
      textDocument: { uri: mainUri, languageId: "asm", version: 1, text: HIGHLIGHT_SOURCE }
    });
    
    // Wait for diagnostics
    await new Promise((resolve) => setTimeout(resolve, 50));
  });

  await t.test("document highlights", async () => {
    const response = await sendRequest("textDocument/documentHighlight", {
      textDocument: { uri: mainUri },
      position: { line: 1, character: 6 } // on MY_LBL
    });

    const highlights = response.result as DocumentHighlight[];
    assert.equal(Array.isArray(highlights), true);
    assert.equal(highlights.length, 2);
    
    const writeHighlight = highlights.find(h => h.kind === DocumentHighlightKind.Write);
    const readHighlight = highlights.find(h => h.kind === DocumentHighlightKind.Read);

    assert.ok(writeHighlight);
    assert.equal(writeHighlight?.range.start.line, 0);

    assert.ok(readHighlight);
    assert.equal(readHighlight?.range.start.line, 1);
  });

  child.kill();
});
