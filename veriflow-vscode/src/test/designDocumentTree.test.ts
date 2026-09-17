import assert from 'node:assert/strict';
import Module = require('module');

async function main(): Promise<void> {
    class TreeItem { constructor(public label: string, public collapsibleState = 0) {} }
    class ThemeIcon { constructor(public id: string) {} }
    class EventEmitter { event = () => ({ dispose() {} }); fire() {} dispose() {} }
    const noop = () => ({ dispose() {} });
    const uri = (value: string) => ({ fsPath: new URL(value).pathname, path: new URL(value).pathname, toString: () => value });
    const loader = Module as unknown as { _load: (...args: any[]) => any }, original = loader._load;
    loader._load = function(name: string, ...args: any[]): any {
        return name === 'vscode' ? { TreeItem, ThemeIcon, EventEmitter, TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 }, Uri: { parse: uri },
            workspace: { createFileSystemWatcher: () => ({ dispose() {}, onDidCreate: noop, onDidChange: noop, onDidDelete: noop }),
                asRelativePath: (value: any) => value.path.replace('/project/', '') },
        } : original.call(this, name, ...args);
    };
    try {
        const { DesignDocumentTreeProvider } = require('../workbench/designDocumentTree');
        for (const kind of ['ad', 'st']) {
            let exportedFiles: any[] = [{ uri: uri('file:///project/generated/custom.v'), exists: true }];
            const definition = { uri: 'file:///project/rtl/dut.v', declarationStart: 10 };
            const provider = new DesignDocumentTreeProvider(kind, {
                files: async () => [uri(`file:///project/designs/top.${kind}`)],
                load: async () => ({ dependencies: [{ label: 'u_dut : dut', definition, children: [
                    { label: 'dut', definition, status: 'recursive', children: [] },
                    { label: 'unknown', status: 'unresolved', children: [] },
                ] }], exportedFiles }),
            });
            const roots = await provider.getChildren();
            assert.equal(roots.length, 1);
            assert.equal(roots[0].label, `top.${kind}`);
            assert.equal(roots[0].iconPath.id, 'circuit-board');
            assert.equal(roots[0].collapsibleState, 1);
            assert.equal(roots[0].description, 'designs');
            assert.equal(roots[0].command.arguments[1], kind === 'ad' ? 'veriflow.archDesignEditor' : 'veriflow.simulationTask');
            const children = await provider.getChildren(roots[0]);
            assert.equal(children[0].label, 'Dependency tree');
            const dependencies = await provider.getChildren(children[0]);
            assert.equal(dependencies[0].label, 'u_dut : dut');
            const nested = await provider.getChildren(dependencies[0]);
            assert.match(nested[0].description, /recursive/);
            assert.equal(nested[1].command, undefined, 'unresolved dependency cannot open an invented source');
            assert.equal(children[1].label, 'custom.v');
            assert.equal(children[1].resourceUri.toString(), 'file:///project/generated/custom.v');
            assert.equal(children[1].command.arguments[0].toString(), 'file:///project/generated/custom.v');
            exportedFiles = [{ uri: uri('file:///project/generated/missing.v'), exists: false }];
            const missing = (await provider.getChildren(roots[0]))[1];
            assert.equal(missing.label, 'missing.v');
            assert.match(missing.description, /not generated/);
            assert.equal(missing.command, undefined);
            exportedFiles = [];
            assert.equal((await provider.getChildren(roots[0]))[1].label, 'No exported file');
            provider.dispose();
        }
    } finally { loader._load = original; }
    console.log('Shared AD/ST dependency and export tree tests passed');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
