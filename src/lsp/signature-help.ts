import { SignatureHelp } from "vscode-languageserver/node";
import { AsmDocument } from "../asm/document";
import { getInstructionMetadata } from "../asm/metadata";

export function buildSignatureHelp(
  openDocuments: ReadonlyMap<string, AsmDocument>,
  uri: string,
  line: number
): SignatureHelp | null {
  const document = openDocuments.get(uri);
  if (document === undefined) {
    return null;
  }

  const parsedLine = document.lines[line];
  if (parsedLine === undefined || !parsedLine.mnemonic) {
    return null;
  }

  const meta = getInstructionMetadata(parsedLine.mnemonic);
  if (!meta) {
    return null;
  }

  return null;
}
