import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { normalizeUri } from "../src/asm/workspace";
import { spawn } from "node:child_process";
import { type FoldingRange, FoldingRangeKind } from "vscode-languageserver/node";

type JsonRpcMessage = {
  jsonrpc: "2.0";
  id?: number;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: unknown;
};

const FOLDING_SOURCE = [
  "   ; comment 1",
  "   ; comment 2",
  "   macro my_macro",
  "      ld a, b",
  "   endmacro",
  "   db 1, 2",
  "   dw 3, 4"
].join("\n");

test("LSP Folding Ranges", async (t) => {
  const serverPath = path.resolve(__dirname, "../../dist/src/cli.js");
  const mainPath = path.resolve(
    __dirname,
    "../../test/fixtures/valid/folding.asm"
  );
  
  fs.writeFileSync(mainPath, FOLDING_SOURCE, "utf8");
  
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
      textDocument: { uri: mainUri, languageId: "asm", version: 1, text: FOLDING_SOURCE }
    });
    
    // Wait for diagnostics
    await new Promise((resolve) => setTimeout(resolve, 50));
  });

  await t.test("folding ranges", async () => {
    const response = await sendRequest("textDocument/foldingRange", {
      textDocument: { uri: mainUri }
    });

    const ranges = response.result as FoldingRange[];
    assert.equal(Array.isArray(ranges), true);
    
    // Expect 3 ranges: comment block, macro block, data block
    assert.equal(ranges.length, 3);
    
    const hasComment = ranges.some(r => r.kind === FoldingRangeKind.Comment && r.startLine === 0 && r.endLine === 1);
    assert.equal(hasComment, true);

    const hasMacro = ranges.some(r => r.kind === FoldingRangeKind.Region && r.startLine === 2 && r.endLine === 4);
    assert.equal(hasMacro, true);

    const hasData = ranges.some(r => r.kind === FoldingRangeKind.Region && r.startLine === 5 && r.endLine === 6);
    assert.equal(hasData, true);
  });

  child.kill();
});
