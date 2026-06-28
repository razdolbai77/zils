// LSP Server Entrypoint
import {
  createConnection,
  ProposedFeatures,
  InitializeParams,
  InitializeResult,
} from 'vscode-languageserver/node';

const connection = createConnection(ProposedFeatures.all);

connection.onInitialize((params: InitializeParams): InitializeResult => {
  return {
    capabilities: {}
  };
});

connection.listen();
