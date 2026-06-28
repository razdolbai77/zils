import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";

type JsonRpcMessage = {
  id?: number;
  jsonrpc: "2.0";
  result?: {
    capabilities?: object;
  };
};

function encodeMessage(message: object): string {
  const body = JSON.stringify(message);
  return `Content-Length: ${Buffer.byteLength(body, "utf8")}\r\n\r\n${body}`;
}

describe("CLI Argument Parsing", () => {
  const cliPath = path.resolve(__dirname, "../src/cli.js");
  const packageJsonPath = path.resolve(__dirname, "../../package.json");
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8")) as {
    bin?: Record<string, string>;
    version?: string;
  };

  it("has correct bin entry", () => {
    assert.equal(packageJson.bin?.zils, "dist/src/cli.js");
  });

  it("prints version and returns 0 for --version", () => {
    const versionResult = spawnSync(process.execPath, [cliPath, "--version"], { encoding: "utf8" });
    assert.equal(versionResult.stdout.trim(), packageJson.version);
    assert.equal(versionResult.status, 0);
  });

  it("prints help and returns 0 for --help", () => {
    const helpResult = spawnSync(process.execPath, [cliPath, "--help"], { encoding: "utf8" });
    assert.match(helpResult.stdout, /Usage: zils --stdio/);
    assert.equal(helpResult.status, 0);
  });

  it("fails if --stdio is missing", () => {
    const result = spawnSync(process.execPath, [cliPath], { encoding: "utf8" });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Usage: zils --stdio/);
  });

  it("fails on unknown flags", () => {
    const result = spawnSync(process.execPath, [cliPath, "--stdio", "--unknown"], { encoding: "utf8" });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /unsupported flag '--unknown'/);
  });

  it("fails on missing cpu type", () => {
    const result = spawnSync(process.execPath, [cliPath, "--stdio", "--cpu"], { encoding: "utf8" });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /missing cpu type/);
  });

  it("fails on unsupported cpu type", () => {
    const result = spawnSync(process.execPath, [cliPath, "--stdio", "--cpu", "6502"], { encoding: "utf8" });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /unsupported cpu type '6502'/);
  });

  async function testInitializeContract(args: string[]) {
    const child = spawn(process.execPath, [cliPath, ...args], {
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
        reject(new Error(`CLI exited before initialize response. code=${code}, stderr=${stderr}`));
      });
    });

    child.stdin.write(
      encodeMessage({
        id: 1,
        jsonrpc: "2.0",
        method: "initialize",
        params: {
          capabilities: {},
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
    } finally {
      child.kill();
    }
  }

  it("succeeds with --stdio and default cpu", async () => {
    await testInitializeContract(["--stdio"]);
  });

  it("succeeds with explicit --cpu z80", async () => {
    await testInitializeContract(["--stdio", "--cpu", "z80"]);
  });

  it("succeeds with explicit --cpu ez80", async () => {
    await testInitializeContract(["--stdio", "--cpu", "ez80"]);
  });
});
