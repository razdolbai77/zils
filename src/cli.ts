#!/usr/bin/env node

import * as fs from "node:fs";
import * as path from "node:path";
import { startServer } from "./server";
import { CpuDialect } from "./asm/metadata";

const usage = "Usage: zils --stdio [--asmsx]";

export function runCli(
  argv: readonly string[],
  outStream: NodeJS.WritableStream = process.stdout,
  errStream: NodeJS.WritableStream = process.stderr,
  inStream: NodeJS.ReadableStream = process.stdin
): number {
  // Help/version win wherever they appear: `zils --stdio --help` must not
  // silently start the server.
  if (argv.includes("--help") || argv.includes("-h")) {
    outStream.write(`${usage}\n`);
    return 0;
  }

  if (argv.includes("--version") || argv.includes("-v")) {
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, "../../package.json"), "utf8"));
    outStream.write(`${pkg.version}\n`);
    return 0;
  }

  let isStdio = false;
  let dialect = CpuDialect.EZ80;
  let isAsmsx = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--stdio") {
      isStdio = true;
    } else if (arg === "--asmsx") {
      isAsmsx = true;
      dialect = CpuDialect.Z80;
    } else if (isClientInjectedFlag(arg)) {
      // Editors inject their own flags (e.g. VS Code's --clientProcessId).
      // Skip the value argument too when it trails as a separate token.
      const next = argv[i + 1];
      if (!arg.includes("=") && next !== undefined && !next.startsWith("--")) {
        i++;
      }
    } else {
      // A typo like `--asmx` must not silently select the wrong dialect.
      errStream.write(`zils: unknown flag: ${arg}\n`);
    }
  }

  if (isStdio) {
    startServer(dialect, isAsmsx, inStream, outStream);
    return 0;
  }

  errStream.write(`${usage}\n`);
  return 1;
}

// Flags language clients inject on the server process; not user-facing.
function isClientInjectedFlag(arg: string): boolean {
  return arg === "--clientProcessId" ||
    arg.startsWith("--clientProcessId=") ||
    arg === "--node-ipc";
}

if (require.main === module) {
  process.exitCode = runCli(process.argv.slice(2));
}
