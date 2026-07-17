import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

test("root npm test runs the vscode test suite", () => {
  const packageJson = JSON.parse(fs.readFileSync(path.resolve("package.json"), "utf8")) as {
    scripts?: { test?: string };
  };

  assert.ok(packageJson.scripts?.test?.includes("npm --prefix vscode test"));
});
