import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import Module = require('module');
import { UserPhysicalBoardLibrary } from '../archDesign/physicalBoardLibrary';
async function main() {
    const root = await mkdtemp(path.join(os.tmpdir(), 'vf-single-panel-'));
    const loader = Module as any, original = loader._load;
    class Uri {
        scheme = 'file';
        constructor(readonly fsPath: string) { }
        get path() { return this.fsPath.replace(/\\/g, '/'); }
        toString() { return pathToFileURL(this.fsPath).toString(); }
        static file(p: string) { return new Uri(path.resolve(p)); }
        static joinPath(base: Uri, ...parts: string[]) { return Uri.file(path.join(base.fsPath, ...parts)); }
    }
    let panels = 0, state: any, receive: any, visibility: any, portReads = 0;
    const docs = new Map<string, any>();
    for (const name of ['one.v', 'two.sv']) {
        const file = path.join(root, name), text = 'module top(output tx);endmodule';
        await writeFile(file, text);
        docs.set(file, { uri: Uri.file(file), version: 1, getText: () => text, save: async () => true });
    }
    const recovery = new Map();
    const mock = { Uri, ViewColumn: { Active: 1 }, workspace: { openTextDocument: async (uri: Uri) => docs.get(uri.fsPath), workspaceFolders: [], textDocuments: [...docs.values()] }, window: { createWebviewPanel: () => { panels++; return { reveal() { }, dispose() { }, onDidDispose() { }, onDidChangeViewState(fn: any) { visibility = fn; return {dispose() {}}; }, webview: { html: '', cspSource: 'https://webview.test', asWebviewUri: (uri: Uri) => uri, onDidReceiveMessage: (fn: any) => { receive = fn; }, postMessage: async (m: any) => { state = m; } } }; }, showOpenDialog: async () => undefined, showSaveDialog: async (o: any) => o.defaultUri, showWarningMessage: async () => undefined } };
    loader._load = function (name: string, ...args: any[]) { return name === 'vscode' ? mock : original.call(this, name, ...args); };
    try {
        const library = new UserPhysicalBoardLibrary({ configPath: path.join(root, 'library.json') });
        library.saveBoard({ id: 'b', name: 'Board', model: { kind: 'board', extension: '.pcf', pins: { tx: 'set_io {signal name} A1' }, interfaces: [{ id: 'U', signals: [{ id: 'tx', direction: 'output', pins: ['tx'] }] }] } });
        const { PhysicalPinsPanel } = require('../archDesign/physicalPinsPanel');
        const manager = new PhysicalPinsPanel({ extensionUri: Uri.file(path.resolve(__dirname, '../..')), globalStorageUri: Uri.file(root), workspaceState: { get: (k: string) => recovery.get(k), update: async (k: string, v: any) => recovery.set(k, v) } }, { library, ports: async () => {portReads++;return [{ name: 'tx', direction: 'output' }];} });
        await manager.open(Uri.file(path.join(root, 'one.v')));
        assert.equal(state.source.path, path.join(root, 'one.v'));
        await manager.manageBoards();
        await manager.open(Uri.file(path.join(root, 'two.sv')));
        assert.equal(state.source.path, path.join(root, 'two.sv'));
        assert.equal(panels, 1);
        assert.ok(receive);
        const before = portReads;
        visibility({webviewPanel:{active:true,visible:true}});
        await manager.open(Uri.file(path.join(root, 'two.sv')));
        assert.equal(portReads,before+2);
        manager.dispose();
        console.log('One constraints panel handles RTL context and board library without custom editors');
    }
    finally {
        loader._load = original;
        await rm(root, { recursive: true, force: true });
    }
}
main().catch(e => { console.error(e); process.exitCode = 1; });
