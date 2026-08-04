import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { normalizeUri } from "../src/asm/workspace";
import { spawn } from "node:child_process";
import { type SelectionRange } from "vscode-languageserver/node";

type JsonRpcMessage = {
  jsonrpc: "2.0";
  id?: number;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: unknown;
};

const SELECTION_SOURCE = [
  "GLOBAL_LBL:",
  "  @local:",
  "    ld a, 10"
].join("\n");

test("LSP Selection Ranges", async (t) => {
  const serverPath = path.resolve(__dirname, "../../dist/src/cli.js");
  const mainPath = path.resolve(
    __dirname,
    "../../test/fixtures/valid/selection.asm"
  );
  
  fs.writeFileSync(mainPath, SELECTION_SOURCE, "utf8");
  
  const mainUri = normalizeUri(pathToFileURL(mainPath).href);

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
      textDocument: { uri: mainUri, languageId: "asm", version: 1, text: SELECTION_SOURCE }
    });
    
    // Wait for diagnostics
    await new Promise((resolve) => setTimeout(resolve, 50));
  });

  await t.test("selection ranges", async () => {
    const response = await sendRequest("textDocument/selectionRange", {
      textDocument: { uri: mainUri },
      positions: [{ line: 2, character: 11 }] // on '10'
    });

    const ranges = response.result as SelectionRange[];
    assert.equal(Array.isArray(ranges), true);
    assert.equal(ranges.length, 1);
    
    let current = ranges[0];
    
    // 1st range should be token '10'
    assert.equal(current.range.start.line, 2);
    assert.equal(current.range.start.character, 10);
    assert.equal(current.range.end.character, 12);
    
    // 2nd range should be line 2
    current = current.parent!;
    assert.ok(current);
    assert.equal(current.range.start.line, 2);
    assert.equal(current.range.start.character, 0);
    assert.equal(current.range.end.character, 12);

    // 3rd range should be scope (global label line 0 to end)
    current = current.parent!;
    assert.ok(current);
    assert.equal(current.range.start.line, 0);
    assert.equal(current.range.end.line, 2);
    
    // 4th range should be file (also line 0 to 2)
    // Actually the scope range and file range are identical in this test,
    // so there shouldn't be a 4th range since we don't push identical ranges.
    assert.equal(current.parent, undefined);
  });

  child.kill();
});
