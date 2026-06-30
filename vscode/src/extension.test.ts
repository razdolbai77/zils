import test from 'node:test';
import * as assert from 'node:assert';
import proxyquire from 'proxyquire';

test('Zaets extension tests scaffolding', () => {
    assert.ok(true, 'Test environment is set up');
});

test('Extension activation and bundled-server launch plumbing', () => {
    let languageClientCreatedCount = 0;
    let startCalledCount = 0;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let languageClientArgs: any[] = [];
    
    class MockLanguageClient {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        constructor(...args: any[]) {
            languageClientCreatedCount++;
            languageClientArgs.push(args);
        }
        start() {
            startCalledCount++;
        }
        stop() {
            return Promise.resolve();
        }
    }

    const mockVscode = {
        workspace: {
            createFileSystemWatcher: () => 'mock-watcher'
        },
        CompletionItem: class {},

        '@noCallThru': true,
        '@global': true
    };

    const mockFs = {
        existsSync: (p: string) => {
            // Mock local server path exists to test local server plumbing
            if (p.includes('dist/src/cli.js')) {
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
        asAbsolutePath: (p: string) => `/mock/absolute/path/${p}`
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

    // Test eZ80 client
    const ez80Args = languageClientArgs[1];
    assert.strictEqual(ez80Args[0], 'zaets-ez80');
    assert.strictEqual(ez80Args[1], 'Zaets eZ80 Language Server');
    
    const ez80ServerOptions = ez80Args[2];
    assert.strictEqual(ez80ServerOptions.run.transport, 1);
    assert.deepStrictEqual(ez80ServerOptions.run.args, ['--stdio']);
    
    // Also test fallback behavior when local server is missing
    const mockFsPackaged = {
        existsSync: () => false, // local server missing
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
    
    languageClientArgs = [];
    extensionPackaged.activate(mockContext);
    
    // Check that it uses packaged path in node_modules
    const packagedArgs = languageClientArgs[0];
    const packagedServerModule = packagedArgs[2].run.module;
    assert.ok(packagedServerModule.includes('node_modules'), 'Should use packaged server when local server is not found');
});
