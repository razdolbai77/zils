import { SignatureHelp, SignatureInformation, ParameterInformation } from "vscode-languageserver/node";
import { AsmDocument } from "../asm/document";
import { validateInstructionOperands } from "../asm/instruction-operands";
import { getInstructionMetadata } from "../asm/metadata";
import { TokenType } from "../asm/lexer";

export function buildSignatureHelp(
  openDocuments: ReadonlyMap<string, AsmDocument>,
  uri: string,
  line: number,
  character: number
): SignatureHelp | null {
  const document = openDocuments.get(uri);
  if (document === undefined) {
    return null;
  }

  const parsedLine = document.lines[line];
  if (parsedLine === undefined || !parsedLine.mnemonic || parsedLine.isDirective) {
    return null;
  }

  const meta = getInstructionMetadata(parsedLine.mnemonic);
  if (!meta) {
    return null;
  }

  const operands = parsedLine.operands ?? [];
  const matchedSignature = validateInstructionOperands(
    operands,
    parsedLine.mnemonic,
    meta,
    document.dialect,
    document.isAsmsx
  );
  const signatures = matchedSignature.error === null && matchedSignature.sigOps !== null
    ? [buildSignatureInformation(parsedLine.mnemonic, matchedSignature.sigOps, meta.description)]
    : meta.signature.split("|").map((overload) => buildOverloadSignatureInformation(overload, meta.description));
  const activeParameter = signatures.length === 0
    ? 0
    : Math.min(countActiveParameter(parsedLine, character), Math.max(0, (signatures[0].parameters?.length ?? 1) - 1));

  return {
    signatures,
    activeSignature: 0,
    activeParameter
  };
}

function buildOverloadSignatureInformation(overload: string, description: string): SignatureInformation {
  const trimmedOverload = overload.trim();
  const firstSpace = trimmedOverload.indexOf(" ");
  const mnemonic = firstSpace === -1 ? trimmedOverload : trimmedOverload.slice(0, firstSpace);
  const operandsText = firstSpace === -1 ? "" : trimmedOverload.slice(firstSpace + 1).trim();
  const sigOps = operandsText.length === 0 ? [] : operandsText.split(",").map((operand) => operand.trim());
  return buildSignatureInformation(mnemonic, sigOps, description);
}

function buildSignatureInformation(mnemonic: string, sigOps: string[], description: string): SignatureInformation {
  const parameters: ParameterInformation[] = sigOps.map((operand) => ({ label: operand }));
  return {
    label: sigOps.length === 0 ? mnemonic.toUpperCase() : `${mnemonic.toUpperCase()} ${sigOps.join(", ")}`,
    documentation: description,
    parameters
  };
}

function countActiveParameter(documentLine: AsmDocument["lines"][number], character: number): number {
  const firstOperandStart = documentLine.operands?.find((operand) => operand.length > 0)?.[0]?.start;
  if (firstOperandStart === undefined) {
    return 0;
  }

  const absoluteCharacter = (documentLine.start ?? 0) + character;
  let activeParameter = 0;
  let depth = 0;

  for (const token of documentLine.tokens) {
    if (token.start >= absoluteCharacter) {
      break;
    }

    if (token.start < firstOperandStart) {
      continue;
    }

    if (token.type === TokenType.LParen || token.type === TokenType.LBracket) {
      depth += 1;
      continue;
    }

    if (token.type === TokenType.RParen || token.type === TokenType.RBracket) {
      depth = Math.max(0, depth - 1);
      continue;
    }

    if (token.type === TokenType.Comma && depth === 0) {
      activeParameter += 1;
    }
  }

  return activeParameter;
}
