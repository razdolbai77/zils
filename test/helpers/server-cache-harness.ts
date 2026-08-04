import { PassThrough } from "node:stream";

import { CpuDialect } from "../../src/asm/metadata";
import * as workspaceModule from "../../src/asm/workspace";
import { pathKey } from "../../src/asm/workspace";
import * as lspDiagnosticsModule from "../../src/lsp/diagnostics";
import { startServer } from "../../src/server";
import type { IndexedWorkspace } from "../../src/asm/workspace";
import { createPromiseResolvers, decodeMessages, encodeMessage } from "./json-rpc-client";

const releaseFirstIndex = createPromiseResolvers<void>();
let indexCallCount = 0;

// Module namespace objects are read-only to the compiler; the harness
// monkey-patches indexWorkspace to gate and count indexing passes.
const patchedWorkspace = workspaceModule as { indexWorkspace: typeof workspaceModule.indexWorkspace };
patchedWorkspace.indexWorkspace = async (filePath, overrides) => {
  const currentCall = indexCallCount;
  indexCallCount += 1;
  process.stdout.write(encodeMessage({ jsonrpc: "2.0", method: "harness/indexStarted", params: { call: currentCall } }));

  if (currentCall === 0) {
    await releaseFirstIndex.promise;
  }

  const documents = new Map(overrides ?? []);
  const pathIndex = new Map<string, string>();
  for (const overridePath of documents.keys()) {
    pathIndex.set(pathKey(overridePath), overridePath);
  }
  pathIndex.set(pathKey(filePath), filePath);

  const workspace: IndexedWorkspace = {
    documents,
    symbols: new Map(),
    failedIncludes: [],
    pathIndex
  };
  return workspace;
};

const patchedDiagnostics = lspDiagnosticsModule as {
  collectDiagnosticsByUri: typeof lspDiagnosticsModule.collectDiagnosticsByUri;
};
patchedDiagnostics.collectDiagnosticsByUri = async () => new Map();

const serverInput = new PassThrough();
const serverOutput = new PassThrough();
serverOutput.on("data", (chunk: Buffer) => {
  process.stdout.write(chunk);
});

process.stdin.setEncoding("utf8");
let stdinBuffer = "";
process.stdin.on("data", (chunk: string) => {
  stdinBuffer += chunk;
  const decoded = decodeMessages(stdinBuffer);
  stdinBuffer = decoded.rest;

  for (const message of decoded.messages) {
    if (message.method === "harness/releaseIndex") {
      releaseFirstIndex.resolve();
      continue;
    }

    serverInput.write(encodeMessage(message));
  }
});

startServer(CpuDialect.EZ80, false, serverInput, serverOutput);
