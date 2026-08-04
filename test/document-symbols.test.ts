import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { normalizeUri } from "../src/asm/workspace";
import { spawn } from "node:child_process";

type JsonRpcMessage = {
  id?: number;
  jsonrpc: "2.0";
  method?: string;
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

test("LSP Document Symbols", async () => {
  const serverPath = path.resolve(__dirname, "../../dist/src/cli.js");
  const fixturePath = path.resolve(
    __dirname,
    "../../test/fixtures/valid/main.asm"
  );
  const uri = normalizeUri(pathToFileURL(fixturePath).href);
  const text = fs.readFileSync(fixturePath, "utf8");
  const child = spawn("node", [serverPath, "--stdio"], {
    stdio: ["pipe", "pipe", "pipe"]
  });

  let stdout = "";
  let nextId = 1;
  const pending = new Map<number, (message: JsonRpcMessage) => void>();

  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => {
    stdout += chunk;
    const decoded = decodeMessages(stdout);
    stdout = decoded.rest;

    for (const message of decoded.messages) {
      if (message.id !== undefined) {
        pending.get(message.id)?.(message);
        pending.delete(message.id);
      }
    }
  });

  function sendRequest(method: string, params: object): Promise<JsonRpcMessage> {
    const id = nextId++;
    child.stdin.write(
      encodeMessage({
        id,
        jsonrpc: "2.0",
        method,
        params
      })
    );

    return new Promise((resolve) => {
      pending.set(id, resolve);
    });
  }

  function sendNotification(method: string, params: object): void {
    child.stdin.write(
      encodeMessage({
        jsonrpc: "2.0",
        method,
        params
      })
    );
  }

  try {
    const initialize = await sendRequest("initialize", {
      capabilities: {},
      processId: process.pid,
      rootUri: null
    });
    assert.equal(initialize.id, 1);

    sendNotification("initialized", {});
    sendNotification("textDocument/didOpen", {
      textDocument: {
        uri,
        languageId: "asm",
        version: 1,
        text
      }
    });

    const response = await sendRequest("textDocument/documentSymbol", {
      textDocument: { uri }
    });

    const symbols = response.result as Array<{
      name: string;
      kind: number;
      location: {
        range: {
          start: { line: number; character: number };
          end: { line: number; character: number };
        };
      };
    }>;
    assert.equal(Array.isArray(symbols), true);
    assert.equal(symbols.some((symbol) => symbol.name === "start" && symbol.kind === 12), true); // 12 = Function

    const startSymbol = symbols.find((symbol) => symbol.name === "start");
    assert.equal(startSymbol !== undefined, true);
    assert.equal(startSymbol?.location.range.start.line, 1);
  } finally {
    child.kill();
  }
});
