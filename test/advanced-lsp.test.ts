import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { spawn } from "node:child_process";
import { InlayHint, CodeAction, CodeLens, DocumentLink, CallHierarchyItem } from "vscode-languageserver/node";

type JsonRpcMessage = {
  jsonrpc: "2.0";
  id?: number;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: unknown;
};

const TEST_SOURCE = [
  "global_label:",
  ".local_label:",
  "    ld a, 10",
  "    call other_func",
  "    include \"somefile.asm\"",
  "",
  "other_func:",
  "    equ_val equ 10h",
  "    ld b, equ_val",
  "    ret"
].join("\n");

test("LSP Advanced Features", async (t) => {
  const serverPath = path.resolve(__dirname, "../../dist/src/cli.js");
  const mainPath = path.resolve(
    __dirname,
    "../../test/fixtures/valid/advanced.asm"
  );
  
  fs.writeFileSync(mainPath, TEST_SOURCE, "utf8");
  
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
      textDocument: { uri: mainUri, languageId: "asm", version: 1, text: TEST_SOURCE }
    });
    
    // Wait for diagnostics
    await new Promise((resolve) => setTimeout(resolve, 50));
  });

  await t.test("signature help", async () => {
    const response = await sendRequest("textDocument/signatureHelp", {
      textDocument: { uri: mainUri },
      position: { line: 3, character: 10 }
    });
    assert.strictEqual(response.result, null);
  });

  await t.test("inlay hints", async () => {
    const response = await sendRequest("textDocument/inlayHint", {
      textDocument: { uri: mainUri },
      range: {
        start: { line: 0, character: 0 },
        end: { line: 10, character: 0 }
      }
    });
    const result = response.result as InlayHint[];
    assert.ok(result);
    // equ_val is used on line 8, it should have a hint
    const hint = result.find(h => h.position.line === 8);
    assert.ok(hint);
    assert.strictEqual(hint.label, ": $10");
  });

  await t.test("code actions", async () => {
    const response = await sendRequest("textDocument/codeAction", {
      textDocument: { uri: mainUri },
      range: {
        start: { line: 3, character: 0 },
        end: { line: 3, character: 10 }
      },
      context: { diagnostics: [] }
    });
    const result = response.result as CodeAction[];
    assert.ok(result);
    assert.strictEqual(result.length, 0);
  });

  await t.test("code lens", async () => {
    const response = await sendRequest("textDocument/codeLens", {
      textDocument: { uri: mainUri }
    });
    const result = response.result as CodeLens[];
    assert.ok(result);
    const lens = result.find(l => l.range.start.line === 6); // other_func
    assert.ok(lens);
    assert.ok(lens.command?.title.includes("reference"));
  });

  await t.test("document links", async () => {
    const response = await sendRequest("textDocument/documentLink", {
      textDocument: { uri: mainUri }
    });
    const result = response.result as DocumentLink[];
    assert.ok(result);
    assert.strictEqual(result.length, 1);
    assert.ok(result[0].target?.endsWith("somefile.asm"));
  });

  await t.test("call hierarchy prepare", async () => {
    const response = await sendRequest("textDocument/prepareCallHierarchy", {
      textDocument: { uri: mainUri },
      position: { line: 3, character: 12 } // call other_func
    });
    const result = response.result as CallHierarchyItem[];
    assert.ok(result);
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].name, "other_func");
  });

  child.kill();
});
