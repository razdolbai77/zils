import * as path from 'path';
import * as fs from 'fs';
import { workspace, ExtensionContext, window, commands, Uri } from 'vscode';
import { applyZaetsEditorOptions } from './editor-options';
import {
  LanguageClient,
  LanguageClientOptions,
  ServerOptions,
  TransportKind
} from 'vscode-languageclient/node';

let z80Client: LanguageClient;
let ez80Client: LanguageClient;

export function activate(context: ExtensionContext) {
  const localServerPath = context.asAbsolutePath(
    path.join('..', 'dist', 'src', 'cli.js')
  );

  const packagedServerPath = context.asAbsolutePath(
    path.join('node_modules', '@razdolbai', 'zils', 'dist', 'src', 'cli.js')
  );

  const serverModule = fs.existsSync(localServerPath) ? localServerPath : packagedServerPath;

  const debugOptions = { execArgv: ['--nolazy', '--inspect=6009'] };
  const debugOptionsZ80 = { execArgv: ['--nolazy', '--inspect=6010'] };

  const z80ServerOptions: ServerOptions = {
    run: { module: serverModule, transport: TransportKind.stdio, args: ['--stdio', '--asmsx'] },
    debug: {
      module: serverModule,
      transport: TransportKind.stdio,
      args: ['--stdio', '--asmsx'],
      options: debugOptionsZ80
    }
  };

  const ez80ServerOptions: ServerOptions = {
    run: { module: serverModule, transport: TransportKind.stdio, args: ['--stdio'] },
    debug: {
      module: serverModule,
      transport: TransportKind.stdio,
      args: ['--stdio'],
      options: debugOptions
    }
  };

  const z80ClientOptions: LanguageClientOptions = {
    documentSelector: [{ scheme: 'file', language: 'z80' }],
    synchronize: {
      fileEvents: workspace.createFileSystemWatcher('**/.clientrc')
    }
  };

  const ez80ClientOptions: LanguageClientOptions = {
    documentSelector: [{ scheme: 'file', language: 'ez80' }],
    synchronize: {
      fileEvents: workspace.createFileSystemWatcher('**/.clientrc')
    }
  };

  z80Client = new LanguageClient(
    'zaets-z80',
    'Zaets Z80 Language Server',
    z80ServerOptions,
    z80ClientOptions
  );

  ez80Client = new LanguageClient(
    'zaets-ez80',
    'Zaets eZ80 Language Server',
    ez80ServerOptions,
    ez80ClientOptions
  );

  z80Client.start();
  ez80Client.start();

  for (const editor of window.visibleTextEditors) {
    applyZaetsEditorOptions(editor);
  }

  context.subscriptions.push(
    window.onDidChangeActiveTextEditor(editor => {
      if (editor !== undefined) {
        applyZaetsEditorOptions(editor);
      }
    })
  );

  context.subscriptions.push(
    window.onDidChangeVisibleTextEditors(editors => {
      for (const editor of editors) {
        applyZaetsEditorOptions(editor);
      }
    })
  );

  context.subscriptions.push(
    commands.registerCommand('zaets.help', () => {
      const uri = Uri.file(context.asAbsolutePath('docs/help.md'));
      commands.executeCommand('markdown.showPreview', uri);
    })
  );

  context.subscriptions.push(
    commands.registerCommand('zaets.signaturesHelp', () => {
      const uri = Uri.file(context.asAbsolutePath('docs/signatures-help.md'));
      commands.executeCommand('markdown.showPreview', uri);
    })
  );
}

export function deactivate(): Thenable<void> | undefined {
  const promises: Thenable<void>[] = [];
  if (z80Client) {
    promises.push(z80Client.stop());
  }
  if (ez80Client) {
    promises.push(ez80Client.stop());
  }
  return Promise.all(promises).then(() => undefined);
}
