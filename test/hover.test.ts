import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { normalizeUri } from "../src/asm/workspace";
import { spawn } from "node:child_process";
import { type Hover } from "vscode-languageserver/node";

type JsonRpcMessage = {
  jsonrpc: "2.0";
  id?: number;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: unknown;
};

test("LSP Hover", async (t) => {
  const serverPath = path.resolve(__dirname, "../../dist/src/cli.js");
  const mainPath = path.resolve(__dirname, "../../test/fixtures/valid/main.asm");
  const mainUri = normalizeUri(pathToFileURL(mainPath).href);
  const mainText = fs.readFileSync(mainPath, "utf8");

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

    // Wait for diagnostics
    await new Promise((resolve) => setTimeout(resolve, 50));
  });

  await t.test("hover instruction", async () => {
    const response = await sendRequest("textDocument/hover", {
      textDocument: { uri: mainUri },
      position: { line: 2, character: 5 } // 'LD' -> 'LD'
    });
    const hover = response.result as Hover;
    assert.equal(typeof hover.contents, "string");
    assert.equal((hover.contents as string).includes("Instruction: `LD`"), true);
  });

  await t.test("hover register", async () => {
    const response = await sendRequest("textDocument/hover", {
      textDocument: { uri: mainUri },
      position: { line: 2, character: 7 } // 'A' -> 'A'
    });
    const hover = response.result as Hover;
    assert.equal((hover.contents as string).includes("Register: `A`"), true);
  });

  await t.test("hover asMSX directive", async () => {
    const dummyUri = normalizeUri(pathToFileURL(path.resolve(__dirname, "../../test/fixtures/valid/dummy.z80")).href);
    sendNotification("textDocument/didOpen", {
      textDocument: { uri: dummyUri, languageId: "asm", version: 1, text: " megas 1" }
    });
    
    await new Promise((resolve) => setTimeout(resolve, 50));
    
    const response = await sendRequest("textDocument/hover", {
      textDocument: { uri: dummyUri },
      position: { line: 0, character: 2 } // 'megas' -> 'megas'
    });
    const hover = response.result as Hover;
    assert.equal(typeof hover.contents, "string");
    assert.equal((hover.contents as string).includes("Directive: `MEGAS`"), true);
  });

  await t.test("hover directive with dot", async () => {
    const dotUri = normalizeUri(pathToFileURL(path.resolve(__dirname, "../../test/fixtures/valid/dummy_dot.z80")).href);
    sendNotification("textDocument/didOpen", {
      textDocument: { uri: dotUri, languageId: "asm", version: 1, text: " .equ 1" }
    });
    
    await new Promise((resolve) => setTimeout(resolve, 50));
    
    const response = await sendRequest("textDocument/hover", {
      textDocument: { uri: dotUri },
      position: { line: 0, character: 2 } // '.equ' -> 'equ'
    });
    const hover = response.result as Hover;
    assert.equal(typeof hover.contents, "string");
    assert.equal((hover.contents as string).includes("Directive: `EQU`"), true);
  });

  await t.test("hover macro in eZ80 mode shows eZ80 signature", async () => {
    const ez80Uri = normalizeUri(pathToFileURL(path.resolve(__dirname, "../../test/fixtures/valid/ez80_macro.ez80")).href);
    sendNotification("textDocument/didOpen", {
      textDocument: { uri: ez80Uri, languageId: "asm", version: 1, text: " MACRO emit_bytes arg" }
    });

    const response = await sendRequest("textDocument/hover", {
      textDocument: { uri: ez80Uri },
      position: { line: 0, character: 2 }
    });
    const hover = response.result as Hover;
    assert.equal(typeof hover.contents, "string");
    assert.equal((hover.contents as string).includes("Signature: `macro <name> [<param1> [, <param2>...]]`"), true);
  });

  await t.test("hover macro in Z80 mode shows asMSX signature", async () => {
    const z80Uri = normalizeUri(pathToFileURL(path.resolve(__dirname, "../../test/fixtures/valid/z80_macro.z80")).href);
    sendNotification("textDocument/didOpen", {
      textDocument: { uri: z80Uri, languageId: "asm", version: 1, text: ".zilog\n MACRO #arg" }
    });

    const response = await sendRequest("textDocument/hover", {
      textDocument: { uri: z80Uri },
      position: { line: 1, character: 2 }
    });
    const hover = response.result as Hover;
    assert.equal(typeof hover.contents, "string");
    assert.equal((hover.contents as string).includes("Signature: `<name>: macro [#param1 [, #param2...]]`"), true);
  });

  await t.test("hover invalid suffix that matches a directive name", async () => {
    const invalidSuffixUri = normalizeUri(pathToFileURL(path.resolve(__dirname, "../../test/fixtures/valid/dummy_suffix.z80")).href);
    sendNotification("textDocument/didOpen", {
      textDocument: { uri: invalidSuffixUri, languageId: "asm", version: 1, text: " ld.bios a,b" }
    });
    
    await new Promise((resolve) => setTimeout(resolve, 50));
    
    const response = await sendRequest("textDocument/hover", {
      textDocument: { uri: invalidSuffixUri },
      position: { line: 0, character: 4 } // 'bios' in 'ld.bios'
    });
    const hover = response.result as Hover;
    assert.equal(hover, null); // Hover should be null because 'bios' is not a valid suffix and shouldn't be matched as a directive here
  });

  await t.test("hover jr lists its supported condition codes", async () => {
    const jrPath = path.join(os.tmpdir(), "zils-jr-hover.z80");
    const jrUri = normalizeUri(pathToFileURL(jrPath).href);
    fs.writeFileSync(jrPath, "jr c, somewhere\n", "utf8");
    sendNotification("textDocument/didOpen", {
      textDocument: { uri: jrUri, languageId: "asm", version: 1, text: "jr c, somewhere\n" }
    });

    const response = await sendRequest("textDocument/hover", {
      textDocument: { uri: jrUri },
      position: { line: 0, character: 1 }
    });
    const hover = response.result as Hover;
    assert.ok(hover);
    assert.ok(typeof hover.contents === "string" && hover.contents.includes("Signature: `JR NZ/Z/NC/C, e | JR e`"));
    assert.ok(typeof hover.contents === "string" && !hover.contents.includes("JR cc, e"));
  });

  child.kill();
});
