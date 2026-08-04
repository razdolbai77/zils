import { spawnSync } from "node:child_process";

const result = spawnSync(
  process.execPath,
  ["--test", "dist/test/**/*.test.js"],
  { stdio: "inherit" }
);

if (result.error !== undefined) {
  throw result.error;
}

process.exitCode = result.status ?? 1;
