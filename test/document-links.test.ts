import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { AsmDocument } from "../src/asm/document";
import { CpuDialect } from "../src/asm/metadata";
import { buildDocumentLinks } from "../src/lsp/document-links";
import { normalizeUri, pathToUri } from "../src/asm/workspace";

test("document links use line-relative ranges on non-first lines", () => {
  const basePath = path.resolve("/tmp/main.asm");
  const uri = normalizeUri(pathToFileURL(basePath).href);
  const document = new AsmDocument("nop\n.include \"child.asm\"\n");
  const links = buildDocumentLinks(uri, document);

  assert.equal(links.length, 1);
  assert.deepEqual(links[0].range, {
    start: { line: 1, character: 9 },
    end: { line: 1, character: 20 }
  });
  assert.equal(links[0].target, pathToUri(path.resolve(path.dirname(basePath), "child.asm")));
});

test("document links resolve backslash include paths", () => {
  const basePath = path.resolve("/tmp/main.z80");
  const uri = normalizeUri(pathToFileURL(basePath).href);
  // asMSX double-quoted strings keep backslashes verbatim (no escape decoding).
  const document = new AsmDocument('  include "sub\\file.z80"', CpuDialect.Z80, true);
  const links = buildDocumentLinks(uri, document);

  assert.equal(links.length, 1);
  assert.equal(
    links[0].target,
    pathToUri(path.resolve(path.dirname(basePath), "sub\\file.z80")),
    "a Windows-style backslash include must resolve relative to the including file"
  );
});

test("document links keep absolute include paths", () => {
  const basePath = path.resolve("/tmp/main.asm");
  const uri = normalizeUri(pathToFileURL(basePath).href);
  const document = new AsmDocument('  include "C:/shared/lib.z80"');
  const links = buildDocumentLinks(uri, document);

  assert.equal(links.length, 1);
  assert.equal(
    links[0].target,
    pathToUri(path.resolve(path.dirname(basePath), "C:/shared/lib.z80")),
    "an absolute include must not be rewritten against the document URI"
  );
});

test("untitled documents emit no include links", () => {
  const document = new AsmDocument('  include "child.asm"');
  const links = buildDocumentLinks("untitled:Untitled-1", document);

  assert.deepEqual(links, [], "an untitled buffer has no directory to resolve includes against");
});
