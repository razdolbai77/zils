import { Location } from "vscode-languageserver/node";
import { AsmDocument } from "../asm/document";
import { Lexer, TokenType } from "../asm/lexer";
import { getCachedCollector } from "../asm/symbol-cache";
import { normalizeUri, indexWorkspace, uriToPath, pathToUri, type DiskDocumentCache } from "../asm/workspace";
import { clampLine } from "./positions";

export function getSymbolAtPosition(document: AsmDocument | undefined, line: number, character: number): { name: string; isLocal: boolean } | null {
  if (document === undefined) {
    return null;
  }

  const lines = document.source.split(/\r?\n/);
  const lineText = lines[line];
  if (lineText === undefined) {
    return null;
  }
  // An end-of-line cursor maps onto the final token's last character.
  const clampedCharacter = Math.min(Math.max(0, character), Math.max(0, lineText.length - 1));

  const lexer = new Lexer(lineText);
  const tokens = lexer.tokenize();

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (clampedCharacter >= token.start && clampedCharacter <= token.start + token.length) {
      if (token.type === TokenType.Identifier) {
        let name = token.value;
        if (i > 0 && tokens[i-1].type === TokenType.Dot && tokens[i-1].start + tokens[i-1].length === token.start) {
            name = "." + name;
        }
        return { name, isLocal: name.startsWith("@") || name.startsWith(".") };
      } else if (token.type === TokenType.Dot && i + 1 < tokens.length && tokens[i+1].type === TokenType.Identifier && token.start + token.length === tokens[i+1].start) {
        const name = "." + tokens[i+1].value;
        return { name, isLocal: true };
      }
    }
  }

  return null;
}

function resolveScope(document: AsmDocument, line: number): string | null {
  for (let i = line; i >= 0; i--) {
    const node = document.lines[i];
    if (node && node.label && !node.label.startsWith("@") && !node.label.startsWith(".")) {
      return node.label;
    }
  }
  return null;
}

function uriToWorkspacePath(uri: string): string {
  return uriToPath(uri);
}

function workspacePathToUri(filePath: string): string {
  return normalizeUri(pathToUri(filePath));
}

function buildPathOverrides(openDocuments: ReadonlyMap<string, AsmDocument>): Map<string, AsmDocument> {
  const pathOverrides = new Map<string, AsmDocument>();
  for (const [documentUri, document] of openDocuments.entries()) {
    pathOverrides.set(uriToWorkspacePath(documentUri), document);
  }
  return pathOverrides;
}


export type SymbolDefinition = {
  location: Location;
  docComment?: string;
};

export async function findDefinition(
  openDocuments: ReadonlyMap<string, AsmDocument>,
  uri: string,
  line: number,
  character: number,
  diskCache?: DiskDocumentCache
): Promise<Location | Location[] | null> {
  const definitions = await findSymbolDefinitions(openDocuments, uri, line, character, diskCache);
  if (definitions === null) {
    return null;
  }
  return Array.isArray(definitions)
    ? definitions.map((definition) => definition.location)
    : definitions.location;
}

export async function findSymbolDefinitions(
  openDocuments: ReadonlyMap<string, AsmDocument>,
  uri: string,
  line: number,
  character: number,
  diskCache?: DiskDocumentCache
): Promise<SymbolDefinition | SymbolDefinition[] | null> {
  const document = openDocuments.get(uri);
  if (document === undefined) {
    return null;
  }

  // A character past the line end maps onto the line's last character so the
  // end-of-line cursor still resolves the final token.
  const sourceLines = document.source.split(/\r?\n/);
  line = clampLine(line, sourceLines.length);
  character = Math.min(Math.max(0, character), Math.max(0, (sourceLines[line]?.length ?? 1) - 1));

  const symbolAtPos = getSymbolAtPosition(document, line, character);
  if (symbolAtPos === null) {
    return null;
  }

  const anonymousDef = resolveAnonymousDefinition(document, uri, line, symbolAtPos.name);
  if (anonymousDef) {
    return { location: anonymousDef };
  }

  let searchName = symbolAtPos.name;
  if (symbolAtPos.isLocal) {
    const scope = resolveScope(document, line);
    if (scope) {
      searchName = scope + searchName;
    }
  }

  const definitions: SymbolDefinition[] = [];

  const filePath = uriToWorkspacePath(uri);
  const pathOverrides = buildPathOverrides(openDocuments);
  const workspace = await indexWorkspace(filePath, pathOverrides, document.dialect, document.isAsmsx, diskCache);

  for (const symbol of workspace.symbols.get(searchName) ?? []) {
    const doc = workspace.documents.get(symbol.filePath);
    const lineText = doc ? (doc.source.split(/\r?\n/)[symbol.line] ?? "") : "";
    definitions.push({
      location: {
        uri: workspacePathToUri(symbol.filePath),
        range: {
          start: { line: symbol.line, character: 0 },
          end: { line: symbol.line, character: lineText.length }
        }
      },
      docComment: symbol.docComment
    });
  }

  if (definitions.length === 0) {
    return null;
  }

  const uniqueDefinitions = Array.from(
    new Map(definitions.map((definition) => [JSON.stringify(definition.location), definition])).values()
  );
  return uniqueDefinitions.length === 1 ? uniqueDefinitions[0] : uniqueDefinitions;
}

export type SymbolReference = Location & { definition: boolean };

export async function findReferences(
  openDocuments: ReadonlyMap<string, AsmDocument>,
  uri: string,
  line: number,
  character: number,
  includeDeclaration: boolean,
  diskCache?: DiskDocumentCache
): Promise<SymbolReference[]> {
  const document = openDocuments.get(uri);
  if (document === undefined) {
    return [];
  }

  const sourceLines = document.source.split(/\r?\n/);
  line = clampLine(line, sourceLines.length);
  character = Math.min(Math.max(0, character), Math.max(0, (sourceLines[line]?.length ?? 1) - 1));

  const symbolAtPos = getSymbolAtPosition(document, line, character);
  if (symbolAtPos === null) {
    return [];
  }

  if (symbolAtPos.name === '@@') {
    return resolveAnonymousReferences(document, uri, line, includeDeclaration);
  }

  let targetName = symbolAtPos.name;
  if (symbolAtPos.isLocal) {
    const scope = resolveScope(document, line);
    if (scope) {
      targetName = scope + targetName;
    }
  }

  const locations: SymbolReference[] = [];

  const filePath = uriToWorkspacePath(uri);
  const pathOverrides = buildPathOverrides(openDocuments);
  const workspace = await indexWorkspace(filePath, pathOverrides, document.dialect, document.isAsmsx, diskCache);

  for (const [docPath, doc] of workspace.documents.entries()) {
    const docUri = workspacePathToUri(docPath);
    const lines = doc.source.split(/\r?\n/);
    
    // Check definitions
    if (includeDeclaration) {
      const collector = getCachedCollector(doc);
      for (const symbol of collector.getSymbols()) {
        if (symbol.name === targetName) {
          const definitionLine = doc.lines[symbol.line];
          const definitionToken = definitionLine?.labelToken;
          const lineStart = definitionLine?.start ?? 0;
          const prefixLength = definitionLine?.label !== undefined && definitionToken !== undefined
            ? definitionLine.label.length - definitionToken.value.length
            : 0;
          const definitionStart = definitionToken ? definitionToken.start - lineStart - prefixLength : 0;
          const definitionLength = definitionLine?.label?.length ?? (lines[symbol.line] ?? "").length;
          locations.push({
            uri: normalizeUri(docUri),
            range: {
              start: { line: symbol.line, character: definitionStart },
              end: { line: symbol.line, character: definitionStart + definitionLength }
            },
            definition: true
          });
        }
      }
    }
    // Check references
    for (let i = 0; i < lines.length; i++) {
      const lexer = new Lexer(lines[i]);
      const tokens = lexer.tokenize();
      const definitionToken = doc.lines[i]?.labelToken;
      const definitionLineStart = doc.lines[i]?.start ?? 0;
      const definitionTokenStart = definitionToken ? definitionToken.start - definitionLineStart : null;
      const definitionTokenLength = definitionToken?.length ?? null;
      
      let currentScope: string | null = null;
      if (symbolAtPos.isLocal || targetName.includes("@") || targetName.includes(".")) {
          currentScope = resolveScope(doc, i);
      }

      for (let j = 0; j < tokens.length; j++) {
        const token = tokens[j];
        if (token.type === TokenType.Identifier) {
          if (definitionTokenStart !== null &&
              definitionTokenLength !== null &&
              token.start === definitionTokenStart &&
              token.length === definitionTokenLength) {
            continue;
          }

          let refName = token.value;
          let startToken = token;
          if (j > 0 && tokens[j-1].type === TokenType.Dot && tokens[j-1].start + tokens[j-1].length === token.start) {
              refName = "." + refName;
              startToken = tokens[j-1];
          }
          const isRefLocal = refName.startsWith("@") || refName.startsWith(".");

          let resolvedName = refName;
          if (isRefLocal && currentScope) {
              resolvedName = currentScope + refName;
          }

          if (resolvedName === targetName) {
            // Found a reference
            locations.push({
              uri: normalizeUri(docUri),
              range: {
                start: { line: i, character: startToken.start },
                end: { line: i, character: token.start + token.length }
              },
              definition: false
            });
          }
        }
      }
    }
  }

  const uniqueLocations = Array.from(
    new Map(locations.map((l) => [JSON.stringify(l), l])).values()
  );
  return uniqueLocations;
}

function findEnclosingMacroRange(document: AsmDocument, line: number): { start: number; end: number } | null {
  let macroStart: number | null = null;
  for (let i = line; i >= 0; i--) {
    const l = document.lines[i];
    if (l && l.mnemonic && (l.mnemonic === 'endm' || l.mnemonic === 'endmacro')) {
      if (i !== line) break;
    }
    if (l && l.mnemonic === 'macro') {
      macroStart = i;
      break;
    }
  }
  if (macroStart === null) return null;
  let macroEnd = document.lines.length - 1;
  for (let i = line; i < document.lines.length; i++) {
    const l = document.lines[i];
    if (l && l.mnemonic && (l.mnemonic === 'endm' || l.mnemonic === 'endmacro')) {
      macroEnd = i;
      break;
    }
  }
  return { start: macroStart, end: macroEnd };
}
function resolveAnonymousDefinition(document: AsmDocument, uri: string, line: number, name: string): Location | null {
  if (name === '@@') {
    return {
      uri: normalizeUri(uri),
      range: { start: { line, character: 0 }, end: { line, character: 2 } }
    };
  }

  const macroRange = findEnclosingMacroRange(document, line);
  const minLine = macroRange ? macroRange.start : 0;
  const maxLine = macroRange ? macroRange.end : document.lines.length - 1;

  if (name === '@b' || name === '@p') {
    for (let i = line - 1; i >= minLine; i--) {
      if (document.lines[i] && document.lines[i].label === '@@') {
        return {
          uri: normalizeUri(uri),
          range: { start: { line: i, character: 0 }, end: { line: i, character: 2 } }
        };
      }
    }
  }

  if (name === '@f' || name === '@n') {
    for (let i = line + 1; i <= maxLine; i++) {
      if (document.lines[i] && document.lines[i].label === '@@') {
        return {
          uri: normalizeUri(uri),
          range: { start: { line: i, character: 0 }, end: { line: i, character: 2 } }
        };
      }
    }
  }
  return null;
}

function resolveAnonymousReferences(document: AsmDocument, uri: string, line: number, includeDeclaration: boolean): SymbolReference[] {
    const references: SymbolReference[] = [];
    if (includeDeclaration) {
        references.push({
            uri: normalizeUri(uri),
            range: { start: { line, character: 0 }, end: { line, character: 2 } },
            definition: true
        });
    }

    // Find all @b that point to this line (i.e. forwards from here until next @@)
    for (let i = line + 1; i < document.lines.length; i++) {
        const checkLine = document.lines[i];
        if (checkLine && checkLine.label === '@@') break;
        for (const token of checkLine.tokens) {
            if (token.value === '@b' || token.value === '@p') {
                references.push({
                    uri: normalizeUri(uri),
                    range: { start: { line: i, character: token.start }, end: { line: i, character: token.start + 2 } },
                    definition: false
                });
            }
        }
    }
    // Find all @f that point to this line (i.e. backwards from here until prev @@)
    for (let i = line - 1; i >= 0; i--) {
        const checkLine = document.lines[i];
        if (checkLine && checkLine.label === '@@') break;
        for (const token of checkLine.tokens) {
            if (token.value === '@f' || token.value === '@n') {
                references.push({
                    uri: normalizeUri(uri),
                    range: { start: { line: i, character: token.start }, end: { line: i, character: token.start + 2 } },
                    definition: false
                });
            }
        }
    }
    return references;
}
