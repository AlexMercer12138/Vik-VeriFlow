import assert from 'node:assert/strict';
import Module = require('module');

async function main(): Promise<void> {
    class TreeItem { constructor(public label: string, public collapsibleState = 0) {} }
    class ThemeIcon { constructor(public id: string) {} }
    class EventEmitter { event = () => ({ dispose() {} }); fire() {} dispose() {} }
    const noop = () => ({ dispose() {} });
    const uri = (value: string) => ({ fsPath: new URL(value).pathname, path: new URL(value).pathname, toString: () => value });
    let opened: any;
    let copied = '';
    const loader = Module as unknown as { _load: (...args: any[]) => any }, original = loader._load;
    loader._load = function(name: string, ...args: any[]): any {
        return name === 'vscode' ? { TreeItem, ThemeIcon, EventEmitter, TreeItemCollapsibleState: { None: 0, Collapsed: 1 }, Uri: { parse: uri },
            Range: class { constructor(readonly start: any, readonly end: any) {} },
            workspace: { createFileSystemWatcher: () => ({ dispose() {}, onDidCreate: noop, onDidChange: noop, onDidDelete: noop }),
                findFiles: async () => [uri('file:///project/empty.v')], getWorkspaceFolder: () => undefined,
                asRelativePath: (value: any) => value.path.replace('/project/', 'root/'),
                openTextDocument: async (value: any) => ({ uri: value, positionAt: (offset: number) => offset }) },
            window: { showTextDocument: async (...values: any[]) => { opened = values; } },
            env: { clipboard: { writeText: async (value: string) => { copied = value; } } },
        } : original.call(this, name, ...args);
    };
    try {
        const { ModuleBrowserProvider } = require('../workbench/moduleBrowserProvider');
        const definitions = [
            { kind: 'module', name: 'a', uri: 'file:///project/design.v', key: 'one', declarationStart: 4 },
            { kind: 'module', name: 'b', uri: 'file:///project/design.v', key: 'two', declarationStart: 30 },
            { kind: 'module', name: 'a', uri: 'file:///project/lib.v', key: 'three', declarationStart: 60 },
            { kind: 'package', name: 'pkg', uri: 'file:///project/pkg.sv', key: 'four', declarationStart: 0 },
        ];
        const provider = new ModuleBrowserProvider({ definitions: async () => definitions });
        assert.equal(typeof provider.resolveSelection, 'function', 'webview commands resolve indexed module keys on the host');
        const items = await provider.resolveSelection({ moduleKey: 'one', moduleKeys: ['one', 'three', 'two'] });
        assert.deepEqual(items.map((item: any) => item.reference.definitionKey), ['one', 'three', 'two']);
        await provider.openModule(items[1]);
        assert.equal(opened[0].uri.toString(), 'file:///project/lib.v');
        assert.equal(opened[1].selection.start, 60);
        assert.deepEqual((await provider.resolveSelection({ moduleKey: 'one', moduleKeys: ['two', 'one', 'two'] })).map((item: any) => item.definition.key), ['two', 'one']);
        assert.deepEqual(await provider.resolveSelection({ moduleKey: 'missing', definition: definitions[0] }), []);
        assert.deepEqual(await provider.resolveSelection({ moduleKey: 'one', moduleKeys: ['two', 'missing'] }), [], 'stale multi-selection is rejected atomically');
        assert.deepEqual(await provider.resolveSelection({ moduleKey: 'four' }), []);
        assert.deepEqual(await provider.resolveSelection({ definition: { ...definitions[0], key: 'missing', uri: 'file:///secret' } }), []);
        opened = undefined;
        await provider.openModule({ moduleKey: 'one', definition: { ...definitions[0], uri: 'file:///secret' } });
        assert.equal(opened[0].uri.toString(), 'file:///project/design.v', 'forged payload paths never control host access');
        definitions[0] = { ...definitions[0], declarationStart: 12 };
        await provider.openModule(items[0]);
        assert.equal(opened[1].selection.start, 12, 'native item resolves the latest indexed location');
        definitions.splice(0, 1);
        opened = undefined;
        await provider.openModule({ moduleKey: 'one' });
        assert.equal(opened, undefined, 'removed definitions cannot be opened');
        definitions.push({ kind: 'module', name: 'safe', uri: 'file:///project/safe.v', key: 'copy', declarationStart: 0, parameters: [], ports: [] } as any);
        await provider.copyInstantiation({ moduleKey: 'copy' });
        assert.ok(copied.includes('safe'));
        provider.dispose();
    } finally { loader._load = original; }
    console.log('Module Browser identity and declaration navigation tests passed');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
