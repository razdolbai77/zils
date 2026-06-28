import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { spawn } from "node:child_process";
import { type Location } from "vscode-languageserver/node";

type JsonRpcMessage = {
  jsonrpc: "2.0";
  id?: number;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: unknown;
};

test("LSP Symbol Navigation", async (t) => {
  const serverPath = path.resolve(__dirname, "../../dist/src/cli.js");
  const mainPath = path.resolve(
    __dirname,
    "../../test/fixtures/valid/main.asm"
  );
  const incPath = path.resolve(
    __dirname,
    "../../test/fixtures/valid/inc.asm"
  );
  const mainUri = pathToFileURL(mainPath).href;
  const incUri = pathToFileURL(incPath).href;
  const mainText = fs.readFileSync(mainPath, "utf8");
  const incText = fs.readFileSync(incPath, "utf8");

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
      textDocument: { uri: mainUri, languageId: "asm", version: 1, text: mainText }
    });
    
    sendNotification("textDocument/didOpen", {
      textDocument: { uri: incUri, languageId: "asm", version: 1, text: incText }
    });

    // Wait for diagnostics
    await new Promise((resolve) => setTimeout(resolve, 50));
  });

  await t.test("find definition of MY_CONST", async () => {
    // In main.asm: 
    // ld a, MY_CONST
    // Let's find MY_CONST (which should be in inc.asm)
    // We need to know where MY_CONST is used. Let's say line 5, char 12.
    // Wait, let's just use known text positions for mainText.
    const lines = mainText.split(/\r?\n/);
    const lineIndex = lines.findIndex((l) => l.includes("MY_CONST"));
    const charIndex = lines[lineIndex].indexOf("MY_CONST");

    const response = await sendRequest("textDocument/definition", {
      textDocument: { uri: mainUri },
      position: { line: lineIndex, character: charIndex + 2 } // somewhere in the middle
    });

    const location = response.result as Location;
    assert.equal(location.uri.toLowerCase(), incUri.toLowerCase());
  });
  
  await t.test("find references of inc_label", async () => {
    // In inc.asm: inc_label is defined. Let's find its definition in inc.asm, and it shouldn't have references if not used, 
    // or we'll just check it returns the definition itself if includeDeclaration is true.
    const lines = incText.split(/\r?\n/);
    const lineIndex = lines.findIndex((l) => l.includes("inc_label"));
    const charIndex = lines[lineIndex].indexOf("inc_label");

    const response = await sendRequest("textDocument/references", {
      textDocument: { uri: incUri },
      position: { line: lineIndex, character: charIndex + 2 },
      context: { includeDeclaration: true }
    });

    const locations = response.result as Location[];
    assert.equal(Array.isArray(locations), true);
    assert.equal(locations.length > 0, true);
    assert.equal(locations[0].uri.toLowerCase(), incUri.toLowerCase());
    assert.equal(locations[0].range.start.line, lineIndex);
  });

  child.kill();
});
