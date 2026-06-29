import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { spawn } from "node:child_process";
import { SemanticTokens } from "vscode-languageserver/node";

type JsonRpcMessage = {
  jsonrpc: "2.0";
  id?: number;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: unknown;
};

function createLspClient(serverPath: string, args: string[]) {
  const child = spawn("node", [serverPath, ...args], {
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
    child.stdin!.write(message);

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
    child.stdin!.write(message);
  }

  return { child, sendRequest, sendNotification };
}

test("LSP Semantic Tokens (Z80 Mode)", async (t) => {
  const serverPath = path.resolve(__dirname, "../../dist/src/cli.js");
  const mainPath = path.resolve(__dirname, "../../test/fixtures/valid/main.asm");
  const mainUri = pathToFileURL(mainPath).href;
  const mainText = fs.readFileSync(mainPath, "utf8");

  const { child, sendRequest, sendNotification } = createLspClient(serverPath, ["--stdio"]);

  await t.test("initialize and open documents", async () => {
    await sendRequest("initialize", {
      processId: process.pid,
      rootUri: null,
      capabilities: {}
    });

    sendNotification("textDocument/didOpen", {
      textDocument: { uri: mainUri, languageId: "asm", version: 1, text: mainText }
    });
    
    await new Promise((resolve) => setTimeout(resolve, 50));
  });

  await t.test("semantic tokens full", async () => {
    const response = await sendRequest("textDocument/semanticTokens/full", {
      textDocument: { uri: mainUri }
    });
    const result = response.result as SemanticTokens;
    assert.ok(result.data.length > 0);
  });
  
  child.kill();
});

test("LSP Semantic Tokens (eZ80 Mode)", async (t) => {
  const serverPath = path.resolve(__dirname, "../../dist/src/cli.js");
  const ez80Path = path.resolve(__dirname, "../../test/fixtures/valid/ez80_instructions.asm");
  const ez80Uri = pathToFileURL(ez80Path).href;
  const ez80Text = fs.readFileSync(ez80Path, "utf8");

  const { child, sendRequest, sendNotification } = createLspClient(serverPath, ["--stdio", "--cpu", "ez80"]);

  await t.test("initialize and open documents", async () => {
    await sendRequest("initialize", {
      processId: process.pid,
      rootUri: null,
      capabilities: {}
    });

    sendNotification("textDocument/didOpen", {
      textDocument: { uri: ez80Uri, languageId: "asm", version: 1, text: ez80Text }
    });

    await new Promise((resolve) => setTimeout(resolve, 50));
  });

  await t.test("semantic tokens full", async () => {
    const response = await sendRequest("textDocument/semanticTokens/full", {
      textDocument: { uri: ez80Uri }
    });
    const result = response.result as SemanticTokens;
    assert.ok(result.data.length > 0);
  });

  child.kill();
});
