import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import path from "node:path";
import { pathToFileURL } from "node:url";

type JsonRpcMessage = {
  id?: number;
  jsonrpc: "2.0";
  method?: string;
  params?: unknown;
  result?: unknown;
};

type PublishedDiagnostic = {
  message: string;
  severity?: number;
  range: {
    start: {
      line: number;
      character: number;
    };
    end: {
      line: number;
      character: number;
    };
  };
};

type PublishDiagnosticsParams = {
  uri: string;
  diagnostics: PublishedDiagnostic[];
  version?: number;
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

test("publishDiagnostics drops superseded runs and reports the latest version", async () => {
  const harnessPath = path.resolve(__dirname, "helpers/publish-diagnostics-harness.js");
  const child = spawn(process.execPath, [harnessPath], {
    stdio: ["pipe", "pipe", "pipe"]
  });

  let stdout = "";
  let stderr = "";
  let nextId = 1;
  const pending = new Map<number, PromiseResolvers<JsonRpcMessage>>();
  const publishedDiagnostics: PublishDiagnosticsParams[] = [];
  const firstPublishSettled = promiseWithResolvers.withResolvers<void>();
  const childExited = promiseWithResolvers.withResolvers<void>();

  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.once("exit", () => childExited.resolve());

  child.stdout.on("data", (chunk: string) => {
    stdout += chunk;
    const decoded = decodeMessages(stdout);
    stdout = decoded.rest;

    for (const message of decoded.messages) {
      if (message.id !== undefined) {
        pending.get(message.id)?.resolve(message);
        pending.delete(message.id);
        continue;
      }

      if (message.method === "textDocument/publishDiagnostics") {
        publishedDiagnostics.push(message.params as PublishDiagnosticsParams);
        continue;
      }

      if (message.method === "harness/firstPublishSettled") {
        firstPublishSettled.resolve();
      }
    }
  });

  child.stderr.on("data", (chunk: string) => {
    stderr += chunk;
  });

  function sendRequest(method: string, params: object): Promise<JsonRpcMessage> {
    const id = nextId;
    nextId += 1;

    const response = promiseWithResolvers.withResolvers<JsonRpcMessage>();
    pending.set(id, response);
    child.stdin.write(encodeMessage({ id, jsonrpc: "2.0", method, params }));
    return response.promise;
  }

  function sendNotification(method: string, params: object): void {
    child.stdin.write(encodeMessage({ jsonrpc: "2.0", method, params }));
  }

  try {
    await sendRequest("initialize", {
      capabilities: {},
      processId: process.pid,
      rootUri: null
    });

    sendNotification("initialized", {});

    const documentUri = pathToFileURL(path.resolve("/publish-race.asm")).href;
    sendNotification("textDocument/didOpen", {
      textDocument: {
        uri: documentUri,
        languageId: "asm",
        version: 1,
        text: "ld a, missing_label"
      }
    });

    sendNotification("textDocument/didChange", {
      textDocument: {
        uri: documentUri,
        version: 2
      },
      contentChanges: [
        {
          text: "ld a, 1"
        }
      ]
    });

    await new Promise<void>((resolve) => {
      const check = () => {
        if (publishedDiagnostics.length > 0) {
          resolve();
          return;
        }
        setImmediate(check);
      };
      check();
    });

    assert.equal(publishedDiagnostics.length, 1);
    assert.equal(publishedDiagnostics[0].uri, documentUri);
    assert.equal(publishedDiagnostics[0].version, 2);
    assert.deepEqual(publishedDiagnostics[0].diagnostics, []);

    sendNotification("harness/releaseFirstDiagnostics", {});
    await firstPublishSettled.promise;

    assert.equal(publishedDiagnostics.length, 1);
  } finally {
    child.kill();
    await childExited.promise;
    assert.equal(stderr, "");
  }
});
