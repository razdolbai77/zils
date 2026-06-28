import { Location } from "vscode-languageserver/node";
import { AsmDocument } from "../asm/document";
import { Lexer, TokenType } from "../asm/lexer";
import { SymbolCollector } from "../asm/symbols";
import { normalizeUri } from "../asm/workspace";

export function getSymbolAtPosition(document: AsmDocument | undefined, line: number, character: number): { name: string; isLocal: boolean } | null {
  if (document === undefined) {
    return null;
  }

  const lines = document.source.split(/\r?\n/);
  const lineText = lines[line];
  if (lineText === undefined) {
    return null;
  }

  const lexer = new Lexer(lineText);
  const tokens = lexer.tokenize();

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (character >= token.start && character <= token.start + token.length) {
      if (token.type === TokenType.Identifier) {
        // Check if it's a local label reference (preceded by a dot)
        if (i > 0 && tokens[i - 1].type === TokenType.Dot && tokens[i - 1].start + tokens[i - 1].length === token.start) {
            return { name: "." + token.value, isLocal: true };
        }
        return { name: token.value, isLocal: false };
      }
      if (token.type === TokenType.Dot && i + 1 < tokens.length && tokens[i + 1].type === TokenType.Identifier && token.start + token.length === tokens[i + 1].start) {
        return { name: "." + tokens[i + 1].value, isLocal: true };
      }
    }
  }

  return null;
}

function resolveScope(document: AsmDocument, line: number): string | null {
  for (let i = line; i >= 0; i--) {
    const node = document.lines[i];
    if (node && node.label && !node.label.startsWith(".")) {
      return node.label;
    }
  }
  return null;
}

export function findDefinition(
  openDocuments: ReadonlyMap<string, AsmDocument>,
  uri: string,
  line: number,
  character: number
): Location | Location[] | null {
  const document = openDocuments.get(uri);
  const symbolAtPos = getSymbolAtPosition(document, line, character);
  
  if (symbolAtPos === null || document === undefined) {
    return null;
  }

  let searchName = symbolAtPos.name;
  if (symbolAtPos.isLocal) {
    const scope = resolveScope(document, line);
    if (scope) {
      searchName = scope + searchName;
    }
  }

  const locations: Location[] = [];

  for (const [docUri, doc] of openDocuments.entries()) {
    const collector = new SymbolCollector(doc);
    for (const symbol of collector.getSymbols()) {
      if (symbol.name === searchName) {
        const lineText = doc.source.split(/\r?\n/)[symbol.line] ?? "";
        locations.push({
          uri: normalizeUri(docUri),
          range: {
            start: { line: symbol.line, character: 0 },
            end: { line: symbol.line, character: lineText.length }
          }
        });
      }
    }
  }

  if (locations.length === 0) {
    return null;
  }

  const uniqueLocations = Array.from(
    new Map(locations.map((l) => [JSON.stringify(l), l])).values()
  );
  return uniqueLocations.length === 1 ? uniqueLocations[0] : uniqueLocations;
}

export function findReferences(
  openDocuments: ReadonlyMap<string, AsmDocument>,
  uri: string,
  line: number,
  character: number,
  includeDeclaration: boolean
): Location[] {
  const document = openDocuments.get(uri);
  const symbolAtPos = getSymbolAtPosition(document, line, character);
  
  if (symbolAtPos === null || document === undefined) {
    return [];
  }

  let targetName = symbolAtPos.name;
  if (symbolAtPos.isLocal) {
    const scope = resolveScope(document, line);
    if (scope) {
      targetName = scope + targetName;
    }
  }

  const locations: Location[] = [];

  for (const [docUri, doc] of openDocuments.entries()) {
    const lines = doc.source.split(/\r?\n/);
    
    // Check definitions
    if (includeDeclaration) {
      const collector = new SymbolCollector(doc);
      for (const symbol of collector.getSymbols()) {
        if (symbol.name === targetName) {
          locations.push({
            uri: normalizeUri(docUri),
            range: {
              start: { line: symbol.line, character: 0 },
              end: { line: symbol.line, character: (lines[symbol.line] ?? "").length }
            }
          });
        }
      }
    }

    // Check references
    for (let i = 0; i < lines.length; i++) {
      const lexer = new Lexer(lines[i]);
      const tokens = lexer.tokenize();
      
      let currentScope: string | null = null;
      if (symbolAtPos.isLocal || targetName.includes(".")) {
          currentScope = resolveScope(doc, i);
      }

      for (let j = 0; j < tokens.length; j++) {
        const token = tokens[j];
        if (token.type === TokenType.Identifier) {
          let isRefLocal = false;
          let refName = token.value;

          if (j > 0 && tokens[j - 1].type === TokenType.Dot && tokens[j - 1].start + tokens[j - 1].length === token.start) {
              isRefLocal = true;
              refName = "." + token.value;
          }

          let resolvedName = refName;
          if (isRefLocal && currentScope) {
              resolvedName = currentScope + refName;
          }

          if (resolvedName === targetName) {
            // Found a reference
            const startToken = isRefLocal ? tokens[j - 1] : token;
            locations.push({
              uri: normalizeUri(docUri),
              range: {
                start: { line: i, character: startToken.start },
                end: { line: i, character: token.start + token.length }
              }
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
