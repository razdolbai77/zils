import { spawn } from "node:child_process";

export type JsonRpcMessage = {
  id?: number;
  jsonrpc: "2.0";
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: unknown;
};

type PendingRequest = {
  reject: (reason: Error) => void;
  resolve: (message: JsonRpcMessage) => void;
  timeout: NodeJS.Timeout;
};

export type PromiseResolvers<T> = {
  promise: Promise<T>;
  reject: (reason?: unknown) => void;
  resolve: (value: T | PromiseLike<T>) => void;
};

type PromiseConstructorWithResolvers = PromiseConstructor & {
  withResolvers?: <T>() => PromiseResolvers<T>;
};

const promiseConstructor = Promise as PromiseConstructorWithResolvers;

export function createPromiseResolvers<T>(): PromiseResolvers<T> {
  if (promiseConstructor.withResolvers !== undefined) {
    return promiseConstructor.withResolvers<T>();
  }

  let resolve: (value: T | PromiseLike<T>) => void = () => {
    throw new Error("Promise resolver is not initialized");
  };
  let reject: (reason?: unknown) => void = () => {
    throw new Error("Promise rejecter is not initialized");
  };
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });

  return { promise, resolve, reject };
}

export function encodeMessage(message: object): string {
  const body = JSON.stringify(message);
  return `Content-Length: ${Buffer.byteLength(body, "utf8")}\r\n\r\n${body}`;
}

export type JsonRpcClient = {
  notify: (method: string, params: object) => void;
  onNotification: (listener: (message: JsonRpcMessage) => void) => () => void;
  request: (method: string, params: object) => Promise<JsonRpcMessage>;
  stop: () => void;
};

export type JsonRpcClientOptions = {
  requestTimeoutMs?: number;
};

export function startJsonRpcClient(
  command: string,
  args: readonly string[],
  options: JsonRpcClientOptions = {}
): JsonRpcClient {
  const child = spawn(command, args, { stdio: ["pipe", "pipe", "pipe"] });
  const requestTimeoutMs = options.requestTimeoutMs ?? 5_000;
  const pending = new Map<number, PendingRequest>();
  const notificationListeners = new Set<(message: JsonRpcMessage) => void>();
  let stdout = "";
  let nextId = 1;
  let failure: Error | null = null;

  const fail = (error: Error): void => {
    if (failure !== null) {
      return;
    }

    failure = error;
    for (const request of pending.values()) {
      clearTimeout(request.timeout);
      request.reject(error);
    }
    pending.clear();
  };

  const send = (message: JsonRpcMessage): void => {
    if (failure !== null) {
      throw failure;
    }
    if (child.stdin === null || child.stdin.destroyed) {
      throw new Error("JSON-RPC server input is closed");
    }

    const body = JSON.stringify(message);
    child.stdin.write(`Content-Length: ${Buffer.byteLength(body, "utf8")}\r\n\r\n${body}`);
  };

  child.stdout?.setEncoding("utf8");
  child.stdout?.on("data", (chunk: string) => {
    try {
      stdout += chunk;
      const decoded = decodeMessages(stdout);
      stdout = decoded.rest;

      for (const message of decoded.messages) {
        if (message.id !== undefined) {
          const request = pending.get(message.id);
          if (request !== undefined) {
            clearTimeout(request.timeout);
            pending.delete(message.id);
            request.resolve(message);
          }
        } else {
          for (const listener of notificationListeners) {
            listener(message);
          }
        }
      }
    } catch (error) {
      fail(error instanceof Error ? error : new Error(String(error)));
    }
  });

  child.once("error", (error) => {
    fail(new Error(`JSON-RPC server failed: ${error.message}`));
  });
  child.once("exit", (code, signal) => {
    fail(new Error(`JSON-RPC server exited before responding (code ${code}, signal ${signal})`));
  });

  return {
    notify(method: string, params: object): void {
      send({ jsonrpc: "2.0", method, params });
    },
    onNotification(listener: (message: JsonRpcMessage) => void): () => void {
      notificationListeners.add(listener);
      return () => notificationListeners.delete(listener);
    },
    request(method: string, params: object): Promise<JsonRpcMessage> {
      if (failure !== null) {
        return Promise.reject(failure);
      }

      const id = nextId++;
      const { promise, resolve, reject } = createPromiseResolvers<JsonRpcMessage>();
      const timeout = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`JSON-RPC request ${method} timed out after ${requestTimeoutMs}ms`));
      }, requestTimeoutMs);
      pending.set(id, { reject, resolve, timeout });

      try {
        send({ id, jsonrpc: "2.0", method, params });
      } catch (error) {
        clearTimeout(timeout);
        pending.delete(id);
        reject(error instanceof Error ? error : new Error(String(error)));
      }

      return promise;
    },
    stop(): void {
      child.kill();
    }
  };
}
export function decodeMessages(streamBuffer: string): { messages: JsonRpcMessage[]; rest: string } {
  const messages: JsonRpcMessage[] = [];
  let buffer = streamBuffer;

  for (;;) {
    const separator = buffer.indexOf("\r\n\r\n");
    if (separator === -1) {
      return { messages, rest: buffer };
    }

    const header = buffer.slice(0, separator);
    const match = /Content-Length: (\d+)/i.exec(header);
    if (match === null) {
      throw new Error(`Missing Content-Length header: ${header}`);
    }

    const length = Number(match[1]);
    const body = buffer.slice(separator + 4);
    if (Buffer.byteLength(body, "utf8") < length) {
      return { messages, rest: buffer };
    }

    messages.push(JSON.parse(body.slice(0, length)) as JsonRpcMessage);
    buffer = body.slice(length);
  }
}
