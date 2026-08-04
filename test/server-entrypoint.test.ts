import assert from "node:assert/strict";
import { test } from "node:test";

import { createServerConnection, startServer } from "../src/server";

test("server exposes connection entrypoints", () => {
  assert.equal(typeof startServer, "function");

  const connection = createServerConnection();
  assert.equal(typeof connection.listen, "function");
  connection.dispose();
});
