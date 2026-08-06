import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";

type CocSettings = {
  languageserver?: {
    zils?: {
      args?: string[];
      command?: string;
      filetypes?: string[];
      rootPatterns?: string[];
    };
  };
};

test("CoC configuration launches zils in asMSX mode", () => {
  const settings = JSON.parse(
    fs.readFileSync(path.resolve(process.cwd(), "examples/coc-settings.json"), "utf8")
  ) as CocSettings;
  const server = settings.languageserver?.zils;

  assert.equal(server?.command, "zils");
  assert.deepEqual(server?.args, ["--stdio", "--asmsx"]);
  assert.deepEqual(server?.filetypes, ["asm"]);
  assert.deepEqual(server?.rootPatterns, [".git", "package.json"]);
});

test("README coc.nvim snippet parses as JSON and matches the example file", () => {
  const readme = fs.readFileSync(path.resolve(process.cwd(), "README.md"), "utf8");
  const fencedBlocks = readme.split("```json").slice(1).map((chunk) => chunk.split("```")[0]);
  const snippet = fencedBlocks.find((block) => block.includes('"languageserver"'));
  assert.notEqual(snippet, undefined, "README must embed the coc.nvim snippet in a json fence");

  const parsed = JSON.parse(snippet!) as CocSettings;
  const example = JSON.parse(
    fs.readFileSync(path.resolve(process.cwd(), "examples/coc-settings.json"), "utf8")
  ) as CocSettings;

  assert.deepEqual(
    parsed.languageserver?.zils,
    example.languageserver?.zils,
    "the README snippet must describe the same server configuration as examples/coc-settings.json"
  );
});
