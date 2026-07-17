import test from "node:test";
import assert from "node:assert/strict";

import { AsmDocument } from "../src/asm/document";
import { buildDocumentLinks } from "../src/lsp/document-links";

test("document links use line-relative ranges on non-first lines", () => {
  const document = new AsmDocument("nop\n.include \"child.asm\"\n");
  const links = buildDocumentLinks("file:///tmp/main.asm", document);

  assert.equal(links.length, 1);
  assert.deepEqual(links[0].range, {
    start: { line: 1, character: 9 },
    end: { line: 1, character: 20 }
  });
  assert.equal(links[0].target, "file:///tmp/child.asm");
});
