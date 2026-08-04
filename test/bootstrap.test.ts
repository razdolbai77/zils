import assert from "node:assert/strict";
import { test } from "node:test";

import { projectName } from "../src/index";

test("bootstrap exports project name", () => {
  assert.equal(projectName, "zils");
});
