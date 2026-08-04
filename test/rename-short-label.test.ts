import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { normalizeUri } from "../src/asm/workspace";

import { startJsonRpcClient } from "./helpers/json-rpc-client";

type TextEditResult = {
  range: {
    start: { line: number; character: number };
    end: { line: number; character: number };
  };
  newText: string;
};

type WorkspaceEditResult = {
  changes?: Record<string, TextEditResult[]>;
};

test("rename replaces exactly the label token on short definition lines", async () => {
  const serverPath = path.resolve(__dirname, "../src/server.js");
  const mainUri = normalizeUri(pathToFileURL(path.resolve("/rename-short-label.asm")).href);
  const source = "ab:\n  jp ab\n";

  const client = startJsonRpcClient(process.execPath, [serverPath, "--stdio"]);

  try {
    await client.request("initialize", { processId: process.pid, rootUri: null, capabilities: {} });
    client.notify("initialized", {});
    client.notify("textDocument/didOpen", {
      textDocument: { uri: mainUri, languageId: "asm", version: 1, text: source }
    });

    const response = await client.request("textDocument/rename", {
      textDocument: { uri: mainUri },
      position: { line: 0, character: 0 },
      newName: "xy"
    });

    const edit = response.result as WorkspaceEditResult;
    assert.ok(edit !== null, "rename should return an edit");
    assert.ok(edit.changes !== undefined);

    const edits = edit.changes?.[mainUri];
    assert.ok(edits, "the document should receive edits");
    assert.deepEqual(edits, [
      {
        range: { start: { line: 0, character: 0 }, end: { line: 0, character: 2 } },
        newText: "xy"
      },
      {
        range: { start: { line: 1, character: 5 }, end: { line: 1, character: 7 } },
        newText: "xy"
      }
    ]);
  } finally {
    client.stop();
  }
});
