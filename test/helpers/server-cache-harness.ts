import { CpuDialect } from "../../src/asm/metadata";
import * as workspaceModule from "../../src/asm/workspace";
import * as lspDiagnosticsModule from "../../src/lsp/diagnostics";
import { startServer } from "../../src/server";
import type { IndexedWorkspace } from "../../src/asm/workspace";

type PromiseResolvers<T> = {
  promise: Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason?: unknown) => void;
};

type PromiseWithResolversConstructor = PromiseConstructor & {
  withResolvers<T>(): PromiseResolvers<T>;
};

const promiseWithResolvers = Promise as PromiseWithResolversConstructor;
const secondIndexStarted = promiseWithResolvers.withResolvers<void>();
let indexCallCount = 0;

(workspaceModule as { indexWorkspace: typeof workspaceModule.indexWorkspace }).indexWorkspace = async (
  filePath,
  overrides
) => {
  const currentCall = indexCallCount;
  indexCallCount += 1;

  if (currentCall === 0) {
    await secondIndexStarted.promise;
  } else if (currentCall === 1) {
    secondIndexStarted.resolve();
  }

  const workspace: IndexedWorkspace = {
    documents: new Map(overrides ?? []),
    dependencies: new Map(),
    loadOrder: [filePath],
    symbols: new Map(),
    failedIncludes: []
  };
  return workspace;
};

(lspDiagnosticsModule as { collectDiagnosticsByUri: typeof lspDiagnosticsModule.collectDiagnosticsByUri }).collectDiagnosticsByUri = async () => new Map();

startServer(CpuDialect.EZ80, false);
