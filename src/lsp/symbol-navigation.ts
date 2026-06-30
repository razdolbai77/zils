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
        return { name: token.value, isLocal: token.value.startsWith("@") };
      }
    }
  }

  return null;
}

function resolveScope(document: AsmDocument, line: number): string | null {
  for (let i = line; i >= 0; i--) {
    const node = document.lines[i];
    if (node && node.label && !node.label.startsWith("@")) {
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
      if (symbolAtPos.isLocal || targetName.includes("@")) {
          currentScope = resolveScope(doc, i);
      }

      for (let j = 0; j < tokens.length; j++) {
        const token = tokens[j];
        if (token.type === TokenType.Identifier) {
          const isRefLocal = token.value.startsWith("@");
          const refName = token.value;

          let resolvedName = refName;
          if (isRefLocal && currentScope) {
              resolvedName = currentScope + refName;
          }

          if (resolvedName === targetName) {
            // Found a reference
            const startToken = token;
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
