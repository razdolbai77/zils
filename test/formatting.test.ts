import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { spawn } from "node:child_process";
import { type TextEdit } from "vscode-languageserver/node";
import { AsmDocument } from "../src/asm/document";
import { CpuDialect } from "../src/asm/metadata";
import { formatDocument } from "../src/lsp/formatting";

type JsonRpcMessage = {
  jsonrpc: "2.0";
  id?: number;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: unknown;
};

const FORMAT_SOURCE = [
  "   LABEL:     ld a,b    ;comment",
  "       @local:    ret",
  "  ld hl, 100",
  "MY_EQU    equ   5",
  "       ;col7 comment",
  "          ;col10 comment",
  '  .INCBIN "file.bin"'
].join("\n");

test("formatting preserves declared macro name casing at call sites", () => {
  const document = new AsmDocument(
    ["OneMacro MACRO", "OneMacro 1", "oneMacro 1", "ENDM"].join("\n"),
    CpuDialect.Z80,
    true
  );

  const edits = formatDocument(document, { insertSpaces: true, tabSize: 8 });

  assert.equal(
    edits.find((edit) => edit.range.start.line === 1)?.newText,
    "        OneMacro 1"
  );
  assert.equal(
    edits.find((edit) => edit.range.start.line === 2)?.newText,
    "        oneMacro 1"
  );
});

test("formatting keeps macro directives undotted", () => {
  const document = new AsmDocument(
    ["@@Foo macro arg", "endm"].join("\n"),
    CpuDialect.Z80,
    true
  );

  const edits = formatDocument(document, { insertSpaces: true, tabSize: 8 });

  assert.deepEqual(edits.map((edit) => edit.newText), [
    "@@Foo   MACRO   arg",
    "        ENDM"
  ]);
});

test("LSP Formatting", async (t) => {
  const serverPath = path.resolve(__dirname, "../../dist/src/cli.js");
  const mainPath = path.resolve(
    __dirname,
    "../../test/fixtures/valid/format.asm"
  );
  
  fs.writeFileSync(mainPath, FORMAT_SOURCE, "utf8");
  
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
    const response = await sendRequest("initialize", {
      processId: process.pid,
      rootUri: null,
      capabilities: {}
    });

    const result = response.result as {
      capabilities: {
        documentOnTypeFormattingProvider?: {
          firstTriggerCharacter: string;
          moreTriggerCharacter?: string[];
        };
      };
    };
    assert.equal(
      result.capabilities.documentOnTypeFormattingProvider?.firstTriggerCharacter,
      "\n"
    );
    assert.equal(
      result.capabilities.documentOnTypeFormattingProvider?.moreTriggerCharacter,
      undefined
    );

    sendNotification("textDocument/didOpen", {
      textDocument: { uri: mainUri, languageId: "asm", version: 1, text: FORMAT_SOURCE }
    });
    
    // Wait for diagnostics
    await new Promise((resolve) => setTimeout(resolve, 50));
  });

  await t.test("format document with spaces", async () => {
    const response = await sendRequest("textDocument/formatting", {
      textDocument: { uri: mainUri },
      options: { tabSize: 8, insertSpaces: true }
    });

    const edits = response.result as TextEdit[];
    assert.equal(Array.isArray(edits), true);
    
    // 6 lines in source
    assert.equal(edits.length, 7);

    assert.equal(edits[0].newText, "LABEL:  ld      a,b             ;comment");
    assert.equal(edits[1].newText, "@local: ret");
    assert.equal(edits[2].newText, "        ld      hl,100");
    assert.equal(edits[3].newText, "MY_EQU  EQU     5");
    // Comment-only lines
    assert.equal(edits[4].newText, ";col7 comment");
    assert.equal(edits[5].newText, "        ;col10 comment");
    assert.equal(edits[6].newText, '        .INCBIN "file.bin"');
  });

  await t.test("format range", async () => {
    const response = await sendRequest("textDocument/rangeFormatting", {
      textDocument: { uri: mainUri },
      range: {
          start: { line: 2, character: 0 },
          end: { line: 2, character: 10 }
      },
      options: { tabSize: 4, insertSpaces: false }
    });

    const edits = response.result as TextEdit[];
    assert.equal(edits.length, 1);
    assert.equal(edits[0].newText, "\t\tld\t\thl,100");
  });

  await t.test("format on type", async () => {
    const response = await sendRequest("textDocument/onTypeFormatting", {
      textDocument: { uri: mainUri },
      position: { line: 3, character: 0 }, // typing newline after line 2
      ch: "\n",
      options: { tabSize: 8, insertSpaces: true }
    });

    const edits = response.result as TextEdit[];
    assert.equal(edits.length, 1);
    // Line 2 format result
    assert.equal(edits[0].newText, "        ld      hl,100");
  });

  child.kill();
});
