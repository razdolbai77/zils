import { PassThrough } from "node:stream";

import { CpuDialect } from "../../src/asm/metadata";
import * as lspDiagnosticsModule from "../../src/lsp/diagnostics";
import { startServer } from "../../src/server";
import type { AsmDocument } from "../../src/asm/document";
import type { Diagnostic as LspDiagnostic } from "vscode-languageserver/node";

type JsonRpcMessage = {
  jsonrpc: "2.0";
  id?: number;
  method?: string;
  params?: unknown;
  result?: unknown;
};

type PromiseResolvers<T> = {
  promise: Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason?: unknown) => void;
};

type PromiseWithResolversConstructor = PromiseConstructor & {
  withResolvers<T>(): PromiseResolvers<T>;
};

const promiseWithResolvers = Promise as PromiseWithResolversConstructor;
const releaseFirstDiagnostics = promiseWithResolvers.withResolvers<void>();
let diagnosticsCallCount = 0;

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
    if (message.method === "harness/releaseFirstDiagnostics") {
      releaseFirstDiagnostics.resolve();
      continue;
    }

    serverInput.write(encodeMessage(message));
  }
});

(lspDiagnosticsModule as { collectDiagnosticsByUri: typeof lspDiagnosticsModule.collectDiagnosticsByUri }).collectDiagnosticsByUri = async (
  openDocuments: ReadonlyMap<string, AsmDocument>
) => {
  const currentCall = diagnosticsCallCount;
  diagnosticsCallCount += 1;

  const uri = openDocuments.keys().next().value as string | undefined;
  if (uri === undefined) {
    return new Map<string, readonly LspDiagnostic[]>();
  }

  if (currentCall === 0) {
    await releaseFirstDiagnostics.promise;
    setImmediate(() => {
      process.stdout.write(
        encodeMessage({ jsonrpc: "2.0", method: "harness/firstPublishSettled" })
      );
    });
    return new Map([
      [
        uri,
        [
          {
            severity: 1,
            message: "Unresolved symbol: missing_label",
            source: "zils",
            range: {
              start: { line: 0, character: 0 },
              end: { line: 0, character: 12 }
            }
          }
        ]
      ]
    ]);
  }

  return new Map([[uri, []]]);
};

startServer(CpuDialect.EZ80, false, serverInput, serverOutput);
