import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import path from "node:path";

type JsonRpcMessage = {
  id?: number;
  jsonrpc: "2.0";
  method?: string;
  result?: {
    capabilities?: {
      completionProvider?: {
        triggerCharacters?: string[];
      };
      textDocumentSync?: {
        change?: number;
        openClose?: boolean;
      };
    };
  };
};

function encodeMessage(message: object): string {
  const body = JSON.stringify(message);
  return `Content-Length: ${Buffer.byteLength(body, "utf8")}\r\n\r\n${body}`;
}

test("initialize handshake", async () => {
  const serverPath = path.resolve(__dirname, "../src/cli.js");
  const child = spawn(process.execPath, [serverPath, "--stdio"], {
    stdio: ["pipe", "pipe", "pipe"]
  });

  const response = new Promise<JsonRpcMessage>((resolve, reject) => {
    let stdout = "";
    let stderr = "";

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");

    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;

      const separator = stdout.indexOf("\r\n\r\n");
      if (separator === -1) {
        return;
      }

      const header = stdout.slice(0, separator);
      const match = /Content-Length: (\d+)/i.exec(header);
      if (!match) {
        reject(new Error(`Missing Content-Length header in response: ${stdout}`));
        return;
      }

      const length = Number(match[1]);
      const body = stdout.slice(separator + 4);
      if (Buffer.byteLength(body, "utf8") < length) {
        return;
      }

      resolve(JSON.parse(body.slice(0, length)) as JsonRpcMessage);
    });

    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });

    child.once("error", reject);
    child.once("exit", (code) => {
      reject(new Error(`Server exited before initialize response. code=${code}, stderr=${stderr}`));
    });
  });

  child.stdin.write(
    encodeMessage({
      id: 1,
      jsonrpc: "2.0",
      method: "initialize",
      params: {
        capabilities: {},
        clientInfo: {
          name: "zils-test"
        },
        processId: process.pid,
        rootUri: null
      }
    })
  );

  try {
    const message = await response;
    assert.equal(message.id, 1);
    assert.equal(message.jsonrpc, "2.0");
    assert.equal(typeof message.result?.capabilities, "object");
    assert.equal(message.result?.capabilities?.textDocumentSync?.openClose, true);
    assert.equal(message.result?.capabilities?.textDocumentSync?.change, 1);
    assert.ok(message.result?.capabilities?.completionProvider?.triggerCharacters?.includes("A"));
    assert.ok(message.result?.capabilities?.completionProvider?.triggerCharacters?.includes("."));
    assert.ok(message.result?.capabilities?.completionProvider?.triggerCharacters?.includes("@"));
  } finally {
    child.kill();
  }
});
