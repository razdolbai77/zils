import {
  createConnection,
  ProposedFeatures,
  InitializeResult,
  Connection,
} from 'vscode-languageserver/node';
import { CpuDialect } from './asm/metadata';

export function startServer(
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    dialect: CpuDialect = CpuDialect.Z80,
    inputStream: NodeJS.ReadableStream = process.stdin,
    outputStream: NodeJS.WritableStream = process.stdout
): Connection {
  const connection = createConnection(ProposedFeatures.all, inputStream, outputStream);

  connection.onInitialize((): InitializeResult => {
    return {
      capabilities: {}
    };
  });

  connection.listen();
  return connection;
}

if (require.main === module) {
  startServer();
}
