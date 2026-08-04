import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { test } from "node:test";

import { startJsonRpcClient } from "./helpers/json-rpc-client";

test("CLI packaging and stdio contracts", async () => {
  const packageJson = JSON.parse(
    fs.readFileSync(path.resolve(process.cwd(), "package.json"), "utf8")
  ) as { bin?: Record<string, string>; version: string };
  const cliPath = path.resolve(__dirname, "../src/cli.js");

  assert.equal(packageJson.bin?.zils, "dist/src/cli.js");

  const version = spawnSync(process.execPath, [cliPath, "--version"], { encoding: "utf8" });
  assert.equal(version.stdout.trim(), packageJson.version);
  assert.equal(version.status, 0);

  const help = spawnSync(process.execPath, [cliPath, "--help"], { encoding: "utf8" });
  assert.match(help.stdout, /Usage: zils --stdio/);
  assert.equal(help.status, 0);

  const client = startJsonRpcClient(process.execPath, [cliPath, "--stdio"]);
  try {
    const response = await client.request("initialize", {
      capabilities: {},
      processId: process.pid,
      rootUri: null
    });
    assert.equal(response.jsonrpc, "2.0");
    assert.equal(typeof response.result, "object");
  } finally {
    client.stop();
  }
});
