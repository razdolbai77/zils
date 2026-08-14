import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { SymbolKind, type CallHierarchyItem } from "vscode-languageserver/node";
import { AsmDocument } from "../src/asm/document";
import { CpuDialect } from "../src/asm/metadata";
import { normalizeUri } from "../src/asm/workspace";
import {
  provideCallHierarchyIncomingCalls,
  provideCallHierarchyOutgoingCalls
} from "../src/lsp/call-hierarchy";

const uriDotted = normalizeUri(pathToFileURL(path.resolve("/tmp/call-hierarchy-local-dotted.asm")).href);
const sourceDotted = [
  "MAIN:",          // 0
  "  call FUNC1",    // 1
  ".loop:",          // 2
  "  call FUNC2",    // 3
  "  jp .loop",      // 4
  "OTHER:",          // 5
  "  call FUNC1",    // 6
  ".loop:",          // 7
  "  ret",           // 8
  "FUNC1:",          // 9
  "  ret",           // 10
  "FUNC2:",          // 11
  "  ret"            // 12
].join("\n");

const openDocumentsDotted = new Map([
  [uriDotted, new AsmDocument(sourceDotted, CpuDialect.Z80, true)]
]);

const uriAt = normalizeUri(pathToFileURL(path.resolve("/tmp/call-hierarchy-local-at.asm")).href);
const sourceAt = [
  "MAIN:",          // 0
  "  call FUNC1",    // 1
  "@loop:",          // 2
  "  call FUNC2",    // 3
  "  jp @loop",      // 4
  "OTHER:",          // 5
  "  call FUNC1",    // 6
  "@loop:",          // 7
  "  ret",           // 8
  "FUNC1:",          // 9
  "  ret",           // 10
  "FUNC2:",          // 11
  "  ret"            // 12
].join("\n");

const openDocumentsAt = new Map([
  [uriAt, new AsmDocument(sourceAt, CpuDialect.EZ80, false)]
]);

test("call hierarchy outgoing calls scans past dotted local labels and scopes local targets", () => {
  const mainItem: CallHierarchyItem = {
    uri: uriDotted,
    name: "MAIN",
    kind: SymbolKind.Function,
    range: { start: { line: 0, character: 0 }, end: { line: 0, character: 5 } },
    selectionRange: { start: { line: 0, character: 0 }, end: { line: 0, character: 4 } }
  };

  const outgoing = provideCallHierarchyOutgoingCalls(openDocumentsDotted, mainItem);
  const targetNames = outgoing.map((call) => call.to.name).sort();

  assert.deepStrictEqual(targetNames, ["FUNC1", "FUNC2", "MAIN.loop"]);
});

test("call hierarchy incoming calls skips dotted local labels as caller boundaries", async () => {
  const func2Item: CallHierarchyItem = {
    uri: uriDotted,
    name: "FUNC2",
    kind: SymbolKind.Function,
    range: { start: { line: 11, character: 0 }, end: { line: 11, character: 6 } },
    selectionRange: { start: { line: 11, character: 0 }, end: { line: 11, character: 5 } }
  };

  const incoming = await provideCallHierarchyIncomingCalls(openDocumentsDotted, func2Item);
  assert.strictEqual(incoming.length, 1);
  assert.strictEqual(incoming[0].from.name, "MAIN");
  assert.strictEqual(incoming[0].from.range.start.line, 0);
});

test("call hierarchy outgoing calls scans past @ local labels and scopes local targets", () => {
  const mainItem: CallHierarchyItem = {
    uri: uriAt,
    name: "MAIN",
    kind: SymbolKind.Function,
    range: { start: { line: 0, character: 0 }, end: { line: 0, character: 5 } },
    selectionRange: { start: { line: 0, character: 0 }, end: { line: 0, character: 4 } }
  };

  const outgoing = provideCallHierarchyOutgoingCalls(openDocumentsAt, mainItem);
  const targetNames = outgoing.map((call) => call.to.name).sort();

  assert.deepStrictEqual(targetNames, ["FUNC1", "FUNC2", "MAIN@loop"]);
});

test("call hierarchy incoming calls skips @ local labels as caller boundaries", async () => {
  const func2Item: CallHierarchyItem = {
    uri: uriAt,
    name: "FUNC2",
    kind: SymbolKind.Function,
    range: { start: { line: 11, character: 0 }, end: { line: 11, character: 6 } },
    selectionRange: { start: { line: 11, character: 0 }, end: { line: 11, character: 5 } }
  };

  const incoming = await provideCallHierarchyIncomingCalls(openDocumentsAt, func2Item);
  assert.strictEqual(incoming.length, 1);
  assert.strictEqual(incoming[0].from.name, "MAIN");
  assert.strictEqual(incoming[0].from.range.start.line, 0);
});
