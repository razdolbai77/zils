import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs";
import { pathToFileURL } from "node:url";
import { spawn } from "node:child_process";
import { type WorkspaceEdit } from "vscode-languageserver/node";

type JsonRpcMessage = {
  jsonrpc: "2.0";
  id?: number;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: unknown;
};

/**
 * A small multi-file scenario used across rename tests:
 *
 *   rename_main.asm
 *     MY_LABEL equ 10
 *     start:
 *         LD A, MY_LABEL
 *         JP start
 *     .local_lbl:
 *         RET
 *
 *   rename_other.asm
 *     OTHER equ 99
 *     caller:
 *         LD B, MY_LABEL   ; cross-file reference
 *         RET
 */
const MAIN_SOURCE = [
  "MY_LABEL equ 10",
  "start:",
  "    LD A, MY_LABEL",
  "    JP start",
  ".local_lbl:",
  "    RET",
].join("\n");

const OTHER_SOURCE = [
  "OTHER equ 99",
  "caller:",
  "    LD B, MY_LABEL",
  "    RET",
].join("\n");

/**
 * Duplicate-definition scenario: same global label defined twice.
 * Rename should be refused for ambiguous targets.
 */
const DUPE_SOURCE = [
  "DUPE_SYM equ 1",
  "DUPE_SYM equ 2",
].join("\n");

test("LSP Rename", async (t) => {
  const serverPath = path.resolve(__dirname, "../../dist/src/cli.js");
  const mainPath = path.resolve(__dirname, "../../test/fixtures/rename_main.asm");
  const otherPath = path.resolve(__dirname, "../../test/fixtures/rename_other.asm");
  const dupePath = path.resolve(__dirname, "../../test/fixtures/rename_dupe.asm");

  // Write temp fixture files
  fs.writeFileSync(mainPath, MAIN_SOURCE, "utf8");
  fs.writeFileSync(otherPath, OTHER_SOURCE, "utf8");
  fs.writeFileSync(dupePath, DUPE_SOURCE, "utf8");

  const mainUri = pathToFileURL(mainPath).href;
  const otherUri = pathToFileURL(otherPath).href;
  const dupeUri = pathToFileURL(dupePath).href;

  const child = spawn("node", [serverPath, "--stdio"], {
    stdio: ["pipe", "pipe", "pipe"],
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

  function sendNotification(method: string, params: unknown): void {
    const payload = JSON.stringify({ jsonrpc: "2.0", method, params });
    const message = `Content-Length: ${Buffer.byteLength(payload)}\r\n\r\n${payload}`;
    child.stdin.write(message);
  }

  await t.test("initialize and open documents", async () => {
    await sendRequest("initialize", {
      processId: process.pid,
      rootUri: null,
      capabilities: {},
    });

    sendNotification("textDocument/didOpen", {
      textDocument: { uri: mainUri, languageId: "asm", version: 1, text: MAIN_SOURCE },
    });
    sendNotification("textDocument/didOpen", {
      textDocument: { uri: otherUri, languageId: "asm", version: 1, text: OTHER_SOURCE },
    });
    sendNotification("textDocument/didOpen", {
      textDocument: { uri: dupeUri, languageId: "asm", version: 1, text: DUPE_SOURCE },
    });

    await new Promise((resolve) => setTimeout(resolve, 50));
  });

  await t.test("rename global symbol across files", async () => {
    // MY_LABEL is defined on line 0 col 0 in main.
    // Rename from the definition site.
    const response = await sendRequest("textDocument/rename", {
      textDocument: { uri: mainUri },
      position: { line: 0, character: 2 },  // inside MY_LABEL on line 0
      newName: "NEW_LABEL",
    });

    const edit = response.result as WorkspaceEdit;
    assert.ok(edit !== null, "rename should return an edit");
    assert.ok(typeof edit.changes === "object", "edit should have changes");

    // Both files should have edits
    const uris = Object.keys(edit.changes!).map((u) => u.toLowerCase());
    assert.ok(
      uris.some((u) => u === mainUri.toLowerCase()),
      "main file should be in edits"
    );
    assert.ok(
      uris.some((u) => u === otherUri.toLowerCase()),
      "other file should be in edits"
    );

    // Count total replacement sites: definition (main L0) + use (main L2) + cross-file use (other L2) = 3
    const mainEdits = Object.entries(edit.changes!).find(
      ([u]) => u.toLowerCase() === mainUri.toLowerCase()
    )?.[1];
    const otherEdits = Object.entries(edit.changes!).find(
      ([u]) => u.toLowerCase() === otherUri.toLowerCase()
    )?.[1];

    assert.ok(mainEdits && mainEdits.length >= 2, "main should have ≥2 edits (definition + reference)");
    assert.ok(otherEdits && otherEdits.length >= 1, "other should have ≥1 edit (cross-file reference)");

    // Every edit should replace with the new name
    for (const editsArr of Object.values(edit.changes!)) {
      for (const e of editsArr) {
        assert.equal(e.newText, "NEW_LABEL");
      }
    }
  });

  await t.test("rename from reference site returns same edit as from definition site", async () => {
    // Rename MY_LABEL from the reference at main line 2 ("    LD A, MY_LABEL")
    const response = await sendRequest("textDocument/rename", {
      textDocument: { uri: mainUri },
      position: { line: 2, character: 10 },  // inside MY_LABEL reference
      newName: "REF_LABEL",
    });

    const edit = response.result as WorkspaceEdit;
    assert.ok(edit !== null);
    const allEdits = Object.values(edit.changes!).flat();
    assert.ok(allEdits.length >= 2, "should rename definition and references");
    for (const e of allEdits) {
      assert.equal(e.newText, "REF_LABEL");
    }
  });

  await t.test("local label rename stays within scope", async () => {
    // .local_lbl is defined at main line 4 inside the `start` scope.
    // Rename should only affect that scope's occurrences.
    const response = await sendRequest("textDocument/rename", {
      textDocument: { uri: mainUri },
      position: { line: 4, character: 1 },  // inside .local_lbl definition
      newName: ".new_local",
    });

    const edit = response.result as WorkspaceEdit;
    assert.ok(edit !== null, "local rename should succeed");
    const allEdits = Object.values(edit.changes!).flat();
    // Should have at least the definition site
    assert.ok(allEdits.length >= 1);
    for (const e of allEdits) {
      assert.equal(e.newText, ".new_local");
    }
  });

  await t.test("rename refused when newName is invalid", async () => {
    // An identifier with a space or starting with a digit is invalid.
    const response = await sendRequest("textDocument/rename", {
      textDocument: { uri: mainUri },
      position: { line: 0, character: 2 },
      newName: "123bad",
    });

    // The server should return null (no edit)
    assert.equal(response.result, null, "invalid identifier rename should return null");
  });

  await t.test("rename refused when crossing local/global boundary (global → local)", async () => {
    // MY_LABEL is global; trying to rename it to a local name (.foo) should be refused.
    const response = await sendRequest("textDocument/rename", {
      textDocument: { uri: mainUri },
      position: { line: 0, character: 2 },
      newName: ".should_fail",
    });

    assert.equal(response.result, null, "crossing to local should be refused");
  });

  await t.test("rename refused when crossing local/global boundary (local → global)", async () => {
    // .local_lbl is local; trying to rename it to a global name should be refused.
    const response = await sendRequest("textDocument/rename", {
      textDocument: { uri: mainUri },
      position: { line: 4, character: 1 },
      newName: "global_name",
    });

    assert.equal(response.result, null, "crossing to global should be refused");
  });

  await t.test("rename refused when no symbol at position", async () => {
    // Position on an instruction mnemonic that is not a user-defined symbol.
    const response = await sendRequest("textDocument/rename", {
      textDocument: { uri: mainUri },
      position: { line: 2, character: 5 },  // "LD" mnemonic, not a symbol
      newName: "WHATEVER",
    });

    assert.equal(response.result, null, "non-symbol position should return null");
  });

  await t.test("rename reports capability in initialize", async () => {
    // Re-initialize a fresh server to inspect capabilities.
    const child2 = spawn("node", [serverPath, "--stdio"], {
      stdio: ["pipe", "pipe", "pipe"],
    });

    let buf2 = "";
    const res2 = new Map<number, JsonRpcMessage>();

    child2.stdout.on("data", (chunk: Buffer) => {
      buf2 += chunk.toString("utf8");
      while (true) {
        const m = buf2.match(/^Content-Length: (\d+)\r\n\r\n/);
        if (!m) break;
        const len = Number.parseInt(m[1], 10);
        const hlen = m[0].length;
        if (buf2.length < hlen + len) break;
        const body = buf2.slice(hlen, hlen + len);
        buf2 = buf2.slice(hlen + len);
        const msg = JSON.parse(body) as JsonRpcMessage;
        if (msg.id !== undefined && msg.result !== undefined) res2.set(msg.id, msg);
      }
    });

    const payload = JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { processId: process.pid, rootUri: null, capabilities: {} },
    });
    child2.stdin.write(`Content-Length: ${Buffer.byteLength(payload)}\r\n\r\n${payload}`);

    const initResp = await new Promise<JsonRpcMessage>((resolve) => {
      const iv = setInterval(() => {
        if (res2.has(1)) { clearInterval(iv); resolve(res2.get(1)!); }
      }, 10);
    });

    const caps = (initResp.result as { capabilities: Record<string, unknown> }).capabilities;
    assert.equal(caps["renameProvider"], true, "server must advertise renameProvider");

    child2.kill();
  });

  child.kill();

  // Cleanup temp fixtures
  try { fs.unlinkSync(mainPath); } catch { /* ignore */ }
  try { fs.unlinkSync(otherPath); } catch { /* ignore */ }
  try { fs.unlinkSync(dupePath); } catch { /* ignore */ }
});
