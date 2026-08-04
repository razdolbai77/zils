import test from "node:test";
import assert from "node:assert/strict";
import { type CallHierarchyItem, SymbolKind } from "vscode-languageserver/node";

import { AsmDocument } from "../src/asm/document";
import { CpuDialect } from "../src/asm/metadata";
import {
  prepareCallHierarchy,
  provideCallHierarchyIncomingCalls,
  provideCallHierarchyOutgoingCalls
} from "../src/lsp/call-hierarchy";

const uri = "file:///tmp/call-hierarchy-missing.asm";
const openDocuments = new Map([
  [uri, new AsmDocument("MAIN:\n  call OTHER\nOTHER:\n  ret\n", CpuDialect.Z80)]
]);

test("call hierarchy prepare returns an empty list for an unknown document", async () => {
  const items = await prepareCallHierarchy(openDocuments, "file:///tmp/nope.asm", 0, 0);
  assert.deepEqual(items, []);
});

test("call hierarchy incoming calls return an empty list for an unknown document", async () => {
  const item: CallHierarchyItem = {
    uri: "file:///tmp/nope.asm",
    name: "MAIN",
    kind: SymbolKind.Function,
    range: { start: { line: 0, character: 0 }, end: { line: 0, character: 4 } },
    selectionRange: { start: { line: 0, character: 0 }, end: { line: 0, character: 4 } }
  };
  const calls = await provideCallHierarchyIncomingCalls(openDocuments, item);
  assert.deepEqual(calls, []);
});

test("call hierarchy outgoing calls return an empty list for an unknown document", () => {
  const item: CallHierarchyItem = {
    uri: "file:///tmp/nope.asm",
    name: "MAIN",
    kind: SymbolKind.Function,
    range: { start: { line: 0, character: 0 }, end: { line: 0, character: 4 } },
    selectionRange: { start: { line: 0, character: 0 }, end: { line: 0, character: 4 } }
  };
  const calls = provideCallHierarchyOutgoingCalls(openDocuments, item);
  assert.deepEqual(calls, []);
});

test("call hierarchy returns empty lists when no calls exist", async () => {
  // prepare on a position with no symbol, incoming/outgoing on a symbol
  // with no callers/callees: same failure class, same [] shape.
  const prepared = await prepareCallHierarchy(openDocuments, uri, 3, 0);
  assert.deepEqual(prepared, []);

  const otherItem: CallHierarchyItem = {
    uri,
    name: "OTHER",
    kind: SymbolKind.Function,
    range: { start: { line: 2, character: 0 }, end: { line: 2, character: 5 } },
    selectionRange: { start: { line: 2, character: 0 }, end: { line: 2, character: 5 } }
  };
  // OTHER is only called, never calls anything.
  const outgoing = provideCallHierarchyOutgoingCalls(openDocuments, otherItem);
  assert.deepEqual(outgoing, []);
});
