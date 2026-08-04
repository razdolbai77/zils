import { PassThrough } from "node:stream";

import * as symbolsModule from "../../src/asm/symbols";
import { startServer } from "../../src/server";

type JsonRpcMessage = {
  jsonrpc: "2.0";
  id?: number;
  method?: string;
  params?: unknown;
  result?: unknown;
};

let collectCount = 0;
const OriginalCollector = symbolsModule.SymbolCollector;

class CountingCollector extends OriginalCollector {
  constructor(document: ConstructorParameters<typeof OriginalCollector>[0]) {
    collectCount += 1;
    super(document);
  }
}

// Patch seam: compiled consumers read SymbolCollector through the module
// exports object at call time, so this replacement intercepts every
// construction site (same technique as code-lens-harness).
const patchedSymbols = symbolsModule as { SymbolCollector: typeof OriginalCollector };
patchedSymbols.SymbolCollector = CountingCollector;

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

const serverInput = new PassThrough();
const serverOutput = new PassThrough();
serverOutput.on("data", (chunk: Buffer) => {
  process.stdout.write(chunk);
});

process.stdin.setEncoding("utf8");
let stdinBuffer = "";
process.stdin.on("data", (chunk: string) => {
  stdinBuffer += chunk;
  const decoded = decodeMessages(stdinBuffer);
  stdinBuffer = decoded.rest;

  for (const message of decoded.messages) {
    if (message.method === "harness/collectCount" && message.id !== undefined) {
      process.stdout.write(encodeMessage({ jsonrpc: "2.0", id: message.id, result: collectCount }));
      continue;
    }

    serverInput.write(encodeMessage(message));
  }
});

startServer(undefined, undefined, serverInput, serverOutput);
