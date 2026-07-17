import fs from "node:fs";
import path from "node:path";
import { PassThrough } from "node:stream";

import { startServer } from "../../src/server";

type JsonRpcMessage = {
  jsonrpc: "2.0";
  method?: string;
  params?: unknown;
  id?: number;
  result?: unknown;
};

type ReadFileBehavior =
  | { type: "resolve"; text: string }
  | { type: "reject"; error: Error };

const originalPromises = fs.promises;
const originalReadFile = originalPromises.readFile.bind(originalPromises);
const behaviors: ReadFileBehavior[] = [
  { type: "resolve", text: "OTHER equ 1\n" },
  { type: "reject", error: new Error("mock unreadable dependency") },
  { type: "resolve", text: "CONST equ 1\n" }
];
let mockReadsActive = false;

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

const patchedPromises = {
  ...originalPromises,
  readFile: (async (filePath: Parameters<typeof originalReadFile>[0], options?: Parameters<typeof originalReadFile>[1]) => {
    const normalizedPath = typeof filePath === "string" ? filePath : filePath.toString();
    if (mockReadsActive && path.basename(normalizedPath) === "dep.asm" && behaviors.length > 0) {
      const behavior = behaviors.shift()!;
      if (behavior.type === "reject") {
        throw behavior.error;
      }
      return behavior.text;
    }

    return originalReadFile(filePath, options as never);
  }) as typeof originalReadFile
};

Object.defineProperty(fs, "promises", {
  configurable: true,
  enumerable: true,
  value: patchedPromises
});

process.on("exit", () => {
  Object.defineProperty(fs, "promises", {
    configurable: true,
    enumerable: true,
    value: originalPromises
  });
});

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
    if (message.method === "harness/activateWatchedReadMock") {
      mockReadsActive = true;
      continue;
    }

    serverInput.write(encodeMessage(message));
  }
});

startServer(undefined, undefined, serverInput, serverOutput);
