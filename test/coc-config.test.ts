import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

type CocSettings = {
  languageserver?: {
    zils?: {
      command?: string;
      args?: string[];
      filetypes?: string[];
      rootPatterns?: string[];
    };
  };
};

test("coc-settings.json configuration", () => {
  const settingsPath = path.resolve(process.cwd(), "examples/coc-settings.json");
  const settings = JSON.parse(fs.readFileSync(settingsPath, "utf8")) as CocSettings;
  const serverConfig = settings.languageserver?.zils;

  assert.equal(serverConfig?.command, "zils");
  assert.deepEqual(serverConfig?.args, [
    "--stdio",
    "--cpu",
    "z80"
  ]);
  assert.deepEqual(serverConfig?.filetypes, ["asm"]);
  assert.deepEqual(serverConfig?.rootPatterns, [".git", "package.json"]);
});
