// LSP Server Entrypoint
import {
  createConnection,
  ProposedFeatures,
  InitializeResult,
} from 'vscode-languageserver/node';

const connection = createConnection(ProposedFeatures.all);

connection.onInitialize((): InitializeResult => {
  return {
    capabilities: {}
  };
});

connection.listen();
