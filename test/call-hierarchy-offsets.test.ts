import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { normalizeUri } from "../src/asm/workspace";

import { startJsonRpcClient } from "./helpers/json-rpc-client";

type LspRange = {
  start: { line: number; character: number };
  end: { line: number; character: number };
};

type CallHierarchyItemResult = {
  name: string;
  range: LspRange;
  selectionRange: LspRange;
};

type OutgoingCallResult = {
  to: CallHierarchyItemResult;
  fromRanges: LspRange[];
};

type IncomingCallResult = {
  from: CallHierarchyItemResult;
  fromRanges: LspRange[];
};

const TEST_SOURCE = [
  "    entry:",
  "        call target",
  "        ret",
  "",
  "    target:",
  "        ret"
].join("\n");

test("call hierarchy ranges are line-relative for indented labels and calls", async () => {
  const serverPath = path.resolve(__dirname, "../src/server.js");
  const mainUri = normalizeUri(pathToFileURL(path.resolve("/call-hierarchy-offsets.asm")).href);

  const client = startJsonRpcClient(process.execPath, [serverPath, "--stdio"]);

  try {
    await client.request("initialize", { processId: process.pid, rootUri: null, capabilities: {} });
    client.notify("initialized", {});
    client.notify("textDocument/didOpen", {
      textDocument: { uri: mainUri, languageId: "asm", version: 1, text: TEST_SOURCE }
    });

    const targetPrepare = await client.request("textDocument/prepareCallHierarchy", {
      textDocument: { uri: mainUri },
      position: { line: 1, character: 14 }
    });
    const targetItems = targetPrepare.result as CallHierarchyItemResult[];
    assert.ok(targetItems);
    assert.strictEqual(targetItems.length, 1);
    assert.strictEqual(targetItems[0].name, "target");
    assert.deepStrictEqual(targetItems[0].selectionRange, {
      start: { line: 4, character: 4 },
      end: { line: 4, character: 10 }
    });

    const entryPrepare = await client.request("textDocument/prepareCallHierarchy", {
      textDocument: { uri: mainUri },
      position: { line: 0, character: 5 }
    });
    const entryItems = entryPrepare.result as CallHierarchyItemResult[];
    assert.ok(entryItems);
    assert.strictEqual(entryItems[0].name, "entry");
    assert.deepStrictEqual(entryItems[0].selectionRange, {
      start: { line: 0, character: 4 },
      end: { line: 0, character: 9 }
    });

    const outgoing = (await client.request("callHierarchy/outgoingCalls", {
      item: entryItems[0]
    })).result as OutgoingCallResult[];
    assert.ok(outgoing);
    assert.strictEqual(outgoing.length, 1);
    assert.strictEqual(outgoing[0].to.name, "target");
    assert.deepStrictEqual(outgoing[0].to.selectionRange, {
      start: { line: 4, character: 4 },
      end: { line: 4, character: 10 }
    });
    assert.deepStrictEqual(outgoing[0].fromRanges, [
      { start: { line: 1, character: 13 }, end: { line: 1, character: 19 } }
    ]);

    const incoming = (await client.request("callHierarchy/incomingCalls", {
      item: targetItems[0]
    })).result as IncomingCallResult[];
    assert.ok(incoming);
    assert.strictEqual(incoming.length, 1);
    assert.strictEqual(incoming[0].from.name, "entry");
    assert.deepStrictEqual(incoming[0].from.selectionRange, {
      start: { line: 0, character: 4 },
      end: { line: 0, character: 9 }
    });
    assert.deepStrictEqual(incoming[0].fromRanges, [
      { start: { line: 1, character: 13 }, end: { line: 1, character: 19 } }
    ]);
  } finally {
    client.stop();
  }
});
