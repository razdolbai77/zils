import test from 'node:test';
import * as assert from 'node:assert';
import proxyquire from 'proxyquire';

type CapturedServerOptions = {
    run: { transport: number; args: string[]; module: string };
};

type CapturedClientOptions = {
    documentSelector: Array<{ scheme: string; language: string }>;
};

type CapturedClientArgs = [string, string, CapturedServerOptions, CapturedClientOptions];

type MockVscode = {
    watcherGlobs: string[];
    workspace: {
        createFileSystemWatcher: (glob: string) => string;
    };
    window: {
        visibleTextEditors: never[];
        onDidChangeActiveTextEditor: (listener: (editor: unknown) => void) => { dispose(): void };
        onDidChangeVisibleTextEditors: (listener: (editors: unknown[]) => void) => { dispose(): void };
        showErrorMessage: (message: string) => void;
    };
    commands: {
        registerCommand: (command: string, callback: () => void) => { dispose(): void };
    };
    Uri: {
        file: (path: string) => { path: string };
    };
    CompletionItem: new () => unknown;
    '@noCallThru': boolean;
    '@global': boolean;
};

function makeMockVscode(errorMessages: string[]): MockVscode {
    const watcherGlobs: string[] = [];
    return {
        watcherGlobs,
        workspace: {
            createFileSystemWatcher: (glob: string) => {
                watcherGlobs.push(glob);
                return 'mock-watcher';
            }
        },
        window: {
            visibleTextEditors: [],
            onDidChangeActiveTextEditor: () => ({ dispose: () => {} }),
            onDidChangeVisibleTextEditors: () => ({ dispose: () => {} }),
            showErrorMessage: (message: string) => {
                errorMessages.push(message);
            }
        },
        commands: {
            registerCommand: () => ({ dispose: () => {} })
        },
        Uri: {
            file: (p: string) => ({ path: p })
        },
        CompletionItem: class {},

        '@noCallThru': true,
        '@global': true
    };
}

test('Zaets extension tests scaffolding', () => {
    assert.ok(true, 'Test environment is set up');
});

test('Extension activation and bundled-server launch plumbing', () => {
    let languageClientCreatedCount = 0;
    let startCalledCount = 0;
    const languageClientArgs: CapturedClientArgs[] = [];

    class MockLanguageClient {
        constructor(...args: unknown[]) {
            languageClientCreatedCount++;
            // The mock records raw constructor args; the test asserts the
            // known LanguageClient argument tuple shape.
            languageClientArgs.push(args as unknown as CapturedClientArgs);
        }
        start() {
            startCalledCount++;
            return Promise.resolve();
        }
        stop() {
            return Promise.resolve();
        }
    }

    const errorMessages: string[] = [];
    const mockVscode = makeMockVscode(errorMessages);
    const watcherGlobs = mockVscode.watcherGlobs;

    const mockFs = {
        existsSync: (p: string) => {
            // Mock local server path exists to test local server plumbing.
            // Normalize separators: path.join emits backslashes on win32.
            if (p.replace(/\\/g, '/').includes('dist/src/cli.js')) {
                return true;
            }
            return false;
        },
        '@noCallThru': false
    };

    const extension = proxyquire('./extension', {
        'vscode': mockVscode,
        'vscode-languageclient/node': {
            LanguageClient: MockLanguageClient,
            TransportKind: { stdio: 1 },
            '@noCallThru': true
        },
        'fs': mockFs
    });

    const mockContext = {
        asAbsolutePath: (p: string) => `/mock/absolute/path/${p}`,
        subscriptions: [] as { dispose(): void }[]
    };

    extension.activate(mockContext);

    assert.strictEqual(languageClientCreatedCount, 2, 'Should create two language clients (Z80 and eZ80)');
    assert.strictEqual(startCalledCount, 2, 'Should start both language clients');

    // Test Z80 client
    const z80Args = languageClientArgs[0];
    assert.strictEqual(z80Args[0], 'zaets-z80');
    assert.strictEqual(z80Args[1], 'Zaets Z80 Language Server');

    // verify server options (stdio and args)
    const z80ServerOptions = z80Args[2];
    assert.strictEqual(z80ServerOptions.run.transport, 1);
    assert.deepStrictEqual(z80ServerOptions.run.args, ['--stdio', '--asmsx']);

    const z80ClientOptions = z80Args[3];
    assert.deepStrictEqual(z80ClientOptions.documentSelector, [
        { scheme: 'file', language: 'z80' },
        { scheme: 'untitled', language: 'z80' }
    ]);

    // Test eZ80 client
    const ez80Args = languageClientArgs[1];
    assert.strictEqual(ez80Args[0], 'zaets-ez80');
    assert.strictEqual(ez80Args[1], 'Zaets eZ80 Language Server');

    const ez80ServerOptions = ez80Args[2];
    assert.strictEqual(ez80ServerOptions.run.transport, 1);
    assert.deepStrictEqual(ez80ServerOptions.run.args, ['--stdio']);

    const ez80ClientOptions = ez80Args[3];
    assert.deepStrictEqual(ez80ClientOptions.documentSelector, [
        { scheme: 'file', language: 'ez80' },
        { scheme: 'untitled', language: 'ez80' }
    ]);
    assert.deepStrictEqual(watcherGlobs, ['**/*.{z80,asm,lib,inc}', '**/*.{ez80,asm,lib,inc}']);

    // Also test fallback behavior when local server is missing
    const mockFsPackaged = {
        existsSync: (p: string) => {
            if (p.includes('node_modules')) {
                return true;
            }
            return false;
        },
        '@noCallThru': false
    };

    const extensionPackaged = proxyquire('./extension', {
        'vscode': mockVscode,
        'vscode-languageclient/node': {
            LanguageClient: MockLanguageClient,
            TransportKind: { stdio: 1 },
            '@noCallThru': true
        },
        'fs': mockFsPackaged
    });

    languageClientArgs.length = 0;
    extensionPackaged.activate(mockContext);

    // Check that it uses packaged path in node_modules
    const packagedArgs = languageClientArgs[0];
    const packagedServerModule = packagedArgs[2].run.module;
    assert.ok(packagedServerModule.includes('node_modules'), 'Should use packaged server when local server is not found');
});

test('Extension aborts activation when no server module exists', () => {
    let languageClientCreatedCount = 0;

    class MockLanguageClient {
        constructor() {
            languageClientCreatedCount++;
        }
        start() {
            return Promise.resolve();
        }
        stop() {
            return Promise.resolve();
        }
    }

    const errorMessages: string[] = [];
    const mockVscode = makeMockVscode(errorMessages);

    const mockFsMissing = {
        existsSync: () => false,
        '@noCallThru': false
    };

    const extension = proxyquire('./extension', {
        'vscode': mockVscode,
        'vscode-languageclient/node': {
            LanguageClient: MockLanguageClient,
            TransportKind: { stdio: 1 },
            '@noCallThru': true
        },
        'fs': mockFsMissing
    });

    const mockContext = {
        asAbsolutePath: (p: string) => `/mock/absolute/path/${p}`,
        subscriptions: [] as { dispose(): void }[]
    };

    extension.activate(mockContext);

    assert.strictEqual(languageClientCreatedCount, 0, 'No language clients should be created without a server module');
    assert.ok(
        errorMessages.some((message) => message.includes('Zaets LSP failed to start')),
        'A start-failure error message should be shown'
    );
});

test('Extension surfaces language client start failures', async () => {
    class MockFailingLanguageClient {
        constructor() {}
        start() {
            return Promise.reject(new Error('server crashed'));
        }
        stop() {
            return Promise.resolve();
        }
    }

    const errorMessages: string[] = [];
    const mockVscode = makeMockVscode(errorMessages);

    const mockFs = {
        existsSync: () => true,
        '@noCallThru': false
    };

    const extension = proxyquire('./extension', {
        'vscode': mockVscode,
        'vscode-languageclient/node': {
            LanguageClient: MockFailingLanguageClient,
            TransportKind: { stdio: 1 },
            '@noCallThru': true
        },
        'fs': mockFs
    });

    const mockContext = {
        asAbsolutePath: (p: string) => `/mock/absolute/path/${p}`,
        subscriptions: [] as { dispose(): void }[]
    };

    extension.activate(mockContext);
    await Promise.resolve();
    await Promise.resolve();

    assert.strictEqual(errorMessages.length, 2, 'Both client start failures should be reported');
    assert.ok(
        errorMessages.every((message) => message.includes('Zaets LSP failed to start: server crashed')),
        'The error message should include the failure reason'
    );
});
