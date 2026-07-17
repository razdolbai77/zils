import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import path from "node:path";
import { pathToFileURL } from "node:url";

type JsonRpcMessage = {
  jsonrpc: "2.0";
  id?: number;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: unknown;
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

test("workspace symbol cache ignores stale in-flight index results", async () => {
  const harnessPath = path.resolve(__dirname, "helpers/server-cache-harness.js");
  const child = spawn(process.execPath, [harnessPath], {
    stdio: ["pipe", "pipe", "pipe"]
  });

  let nextId = 1;
  let buffer = "";
  let stderr = "";
  const pendingResponses = new Map<number, PromiseResolvers<JsonRpcMessage>>();

  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");

  child.stdout.on("data", (chunk: string) => {
    buffer += chunk;

    for (;;) {
      const separator = buffer.indexOf("\r\n\r\n");
      if (separator === -1) {
        return;
      }

      const header = buffer.slice(0, separator);
      const match = /Content-Length: (\d+)/i.exec(header);
      if (!match) {
        throw new Error(`Missing Content-Length header: ${header}`);
      }

      const length = Number(match[1]);
      const body = buffer.slice(separator + 4);
      if (Buffer.byteLength(body, "utf8") < length) {
        return;
      }

      const message = JSON.parse(body.slice(0, length)) as JsonRpcMessage;
      buffer = body.slice(length);

      if (message.id !== undefined) {
        pendingResponses.get(message.id)?.resolve(message);
        pendingResponses.delete(message.id);
      }
    }
  });

  child.stderr.on("data", (chunk: string) => {
    stderr += chunk;
  });

  function sendRequest(method: string, params: unknown): Promise<JsonRpcMessage> {
    const id = nextId;
    nextId += 1;

    const response = promiseWithResolvers.withResolvers<JsonRpcMessage>();
    pendingResponses.set(id, response);
    child.stdin.write(encodeMessage({ jsonrpc: "2.0", id, method, params }));
    return response.promise;
  }

  function sendNotification(method: string, params: unknown): void {
    child.stdin.write(encodeMessage({ jsonrpc: "2.0", method, params }));
  }

  const closed = promiseWithResolvers.withResolvers<void>();
  child.once("exit", () => closed.resolve());

  try {
    await sendRequest("initialize", { processId: process.pid, rootUri: null, capabilities: {} });
    sendNotification("initialized", {});

    const documentUri = pathToFileURL(path.resolve("/race-cache.asm")).href;
    sendNotification("textDocument/didOpen", {
      textDocument: {
        uri: documentUri,
        languageId: "asm",
        version: 1,
        text: "old_label:\n  nop\n"
      }
    });

    const firstWorkspaceSymbols = sendRequest("workspace/symbol", { query: "" });

    sendNotification("textDocument/didChange", {
      textDocument: { uri: documentUri, version: 2 },
      contentChanges: [{ text: "new_label:\n  nop\n" }]
    });

    const secondWorkspaceSymbols = sendRequest("workspace/symbol", { query: "" });
    const secondResult = (await secondWorkspaceSymbols).result as Array<{ name: string }>;
    assert.ok(secondResult.some((symbol) => symbol.name === "new_label"));
    assert.ok(!secondResult.some((symbol) => symbol.name === "old_label"));

    await firstWorkspaceSymbols;

    const finalResult = (await sendRequest("workspace/symbol", { query: "" })).result as Array<{ name: string }>;
    assert.ok(finalResult.some((symbol) => symbol.name === "new_label"));
    assert.ok(!finalResult.some((symbol) => symbol.name === "old_label"));
  } finally {
    child.kill();
    await closed.promise;
    assert.equal(stderr, "");
  }
});
