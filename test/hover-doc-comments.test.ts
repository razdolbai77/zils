import assert from "node:assert/strict";
import path from "node:path";
import { describe, it } from "node:test";
import { pathToFileURL } from "node:url";
import { normalizeUri } from "../src/asm/workspace";

import { AsmDocument } from "../src/asm/document";
import { CpuDialect } from "../src/asm/metadata";
import { buildHover } from "../src/lsp/hover";

type Mode = {
  name: string;
  dialect: CpuDialect;
  isAsmsx: boolean;
  inlineDefinitions: ReadonlyArray<{
    kind: string;
    name: string;
    source: readonly string[];
    documentation: string;
  }>;
  precedingDefinitions: ReadonlyArray<{
    kind: string;
    name: string;
    source: readonly string[];
    documentation: string;
  }>;
};

const modes: readonly Mode[] = [
  {
    name: "asMSX",
    dialect: CpuDialect.Z80,
    isAsmsx: true,
    inlineDefinitions: [
      {
        kind: "label",
        name: "inline_label",
        source: ["inline_label: nop ;! Inline label documentation.", "jp inline_label"],
        documentation: "Inline label documentation."
      },
      {
        kind: "equate",
        name: "INLINE_EQU",
        source: ["INLINE_EQU equ 42 ;! Inline equate documentation.", "ld a,INLINE_EQU"],
        documentation: "Inline equate documentation."
      },
      {
        kind: "macro",
        name: "inline_macro",
        source: ["inline_macro: macro ;! Inline macro documentation.", "endm", "inline_macro"],
        documentation: "Inline macro documentation."
      }
    ],
    precedingDefinitions: [
      {
        kind: "label",
        name: "preceding_label",
        source: [";! Label documentation line one.", ";! Label documentation line two.", "preceding_label: nop", "jp preceding_label"],
        documentation: "Label documentation line one.\nLabel documentation line two."
      },
      {
        kind: "equate",
        name: "PRECEDING_EQU",
        source: [";! Equate documentation line one.", ";! Equate documentation line two.", "PRECEDING_EQU equ 42", "ld a,PRECEDING_EQU"],
        documentation: "Equate documentation line one.\nEquate documentation line two."
      },
      {
        kind: "macro",
        name: "preceding_macro",
        source: [";! Macro documentation line one.", ";! Macro documentation line two.", "preceding_macro: macro", "endm", "preceding_macro"],
        documentation: "Macro documentation line one.\nMacro documentation line two."
      }
    ]
  },
  {
    name: "ez80asm",
    dialect: CpuDialect.EZ80,
    isAsmsx: false,
    inlineDefinitions: [
      {
        kind: "label",
        name: "inline_label",
        source: ["inline_label: nop ;! Inline label documentation.", "jp inline_label"],
        documentation: "Inline label documentation."
      },
      {
        kind: "equate",
        name: "INLINE_EQU",
        source: ["INLINE_EQU: equ 42 ;! Inline equate documentation.", "ld a,INLINE_EQU"],
        documentation: "Inline equate documentation."
      },
      {
        kind: "macro",
        name: "inline_macro",
        source: ["  macro inline_macro ;! Inline macro documentation.", "  endm", "inline_macro"],
        documentation: "Inline macro documentation."
      }
    ],
    precedingDefinitions: [
      {
        kind: "label",
        name: "preceding_label",
        source: [";! Label documentation line one.", ";! Label documentation line two.", "preceding_label: nop", "jp preceding_label"],
        documentation: "Label documentation line one.\nLabel documentation line two."
      },
      {
        kind: "equate",
        name: "PRECEDING_EQU",
        source: [";! Equate documentation line one.", ";! Equate documentation line two.", "PRECEDING_EQU: equ 42", "ld a,PRECEDING_EQU"],
        documentation: "Equate documentation line one.\nEquate documentation line two."
      },
      {
        kind: "macro",
        name: "preceding_macro",
        source: [";! Macro documentation line one.", ";! Macro documentation line two.", "  macro preceding_macro", "  endm", "preceding_macro"],
        documentation: "Macro documentation line one.\nMacro documentation line two."
      }
    ]
  }
];

async function assertHoverIncludesDocumentation(
  mode: Mode,
  definition: Mode["inlineDefinitions"][number],
  form: string
): Promise<void> {
  const source = definition.source.join("\n");
  const uri = normalizeUri(pathToFileURL(path.resolve(`hover-doc-${mode.name}-${form}-${definition.kind}.asm`)).href);
  const document = new AsmDocument(source, mode.dialect, mode.isAsmsx);
  const callLine = definition.source.length - 1;
  const character = definition.source[callLine].indexOf(definition.name) + 1;

  const hover = await buildHover(new Map([[uri, document]]), uri, callLine, character);

  assert.ok(hover);
  assert.equal(typeof hover.contents, "string");
  assert.ok((hover.contents as string).endsWith(`\n\n${definition.documentation}`));
}
it("decodes cross-file hover filenames from file URIs", async () => {
  const sourceUri = normalizeUri("file:///C:/hover-source.asm");
  const targetUri = normalizeUri("file:///C:/folder/target%20file.asm");
  const hover = await buildHover(
    new Map([
      [sourceUri, new AsmDocument('  include "folder/target file.asm"\n  jp TARGET', CpuDialect.EZ80)],
      [targetUri, new AsmDocument("TARGET: nop", CpuDialect.EZ80)]
    ]),
    sourceUri,
    1,
    7
  );

  assert.deepEqual(hover, {
    contents: "Symbol `TARGET` defined in target file.asm at line 1"
  });
});


describe("doc comment hover", () => {
  for (const mode of modes) {
    describe(mode.name, () => {
      for (const definition of mode.inlineDefinitions) {
        it(`appends end-of-line ${definition.kind} documentation at call sites`, async () => {
          await assertHoverIncludesDocumentation(mode, definition, "inline");
        });
      }

      for (const definition of mode.precedingDefinitions) {
        it(`appends preceding multi-line ${definition.kind} documentation at call sites`, async () => {
          await assertHoverIncludesDocumentation(mode, definition, "preceding");
        });
      }
    });
  }
});
