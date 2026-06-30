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
  if (argv.length === 1 && (argv[0] === "--help" || argv[0] === "-h")) {
    outStream.write(`${usage}\n`);
    return 0;
  }

  if (argv.length === 1 && (argv[0] === "--version" || argv[0] === "-v")) {
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
    } else {
      errStream.write(`Error: unsupported flag '${arg}'\n${usage}\n`);
      return 1;
    }
  }

  if (isStdio) {
    startServer(dialect, isAsmsx, inStream, outStream);
    return 0;
  }

  errStream.write(`${usage}\n`);
  return 1;
}

if (require.main === module) {
  process.exitCode = runCli(process.argv.slice(2));
}
