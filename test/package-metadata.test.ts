import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

test("root package metadata matches the supported release contract", () => {
  const packageJson = JSON.parse(fs.readFileSync(path.resolve("package.json"), "utf8")) as {
    type?: string;
    repository?: { type?: string; url?: string };
    engines?: { node?: string };
    scripts?: { test?: string; clean?: string };
    devDependencies?: Record<string, string>;
  };

  assert.equal(packageJson.type, "commonjs");
  assert.equal(packageJson.repository?.type, "git");
  assert.equal(packageJson.repository?.url, "https://codeberg.org/razdolbai/zils.git");
  assert.equal(packageJson.engines?.node, ">=20.0.0");
  assert.ok(packageJson.scripts?.test?.includes("npm --prefix vscode test"));
  assert.ok(packageJson.scripts?.clean?.includes("rmSync('dist'"));
  assert.equal(packageJson.devDependencies?.["ts-node"], undefined);
});
