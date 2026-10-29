import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import Module = require('module');
import { UserPhysicalBoardLibrary } from '../archDesign/physicalBoardLibrary';
async function main() {
    const root = await mkdtemp(path.join(os.tmpdir(), 'vf-pins-rtl-'));
    const loader = Module as unknown as { _load: (...args: any[]) => any }, original = loader._load;
    class Uri { scheme = 'file'; constructor(readonly fsPath: string) {} get path() { return this.fsPath.replace(/\\/g, '/'); } toString() { return pathToFileURL(this.fsPath).toString(); } static file(file: string) { return new Uri(path.resolve(file)); } }
    const source = path.join(root, 'top.v'), oldConfig = path.join(root, 'config', 'top.pins.json'), newConfig = path.join(root, 'new', 'deep', 'top.pins.json');
    const doc = { uri: Uri.file(source), version: 1, isDirty: false, getText: () => 'module top(output serial_tx); endmodule', save: async () => true };
    let receive: (message: any) => void = () => {}, state: any, nextState: ((value: any) => void) | undefined;
    let saveTarget: Uri | undefined = Uri.file(newConfig), changeDuringDialog = false;
    const mock = { Uri, ViewColumn: { Active: 1 }, workspace: { openTextDocument: async () => doc, textDocuments: [doc] }, window: {
        createWebviewPanel: () => ({ reveal() {}, dispose() {}, onDidDispose: () => ({ dispose() {} }), webview: { html: '', onDidReceiveMessage: (fn: any) => { receive = fn; return { dispose() {} }; }, postMessage: async (message: any) => { state = message; const resolve = nextState; nextState = undefined; resolve?.(message); return true; } } }),
        showOpenDialog: async () => [Uri.file(oldConfig)], showSaveDialog: async () => { if (changeDuringDialog) doc.version++; return saveTarget; },
    } };
    loader._load = function(name: string, ...args: any[]) { return name === 'vscode' ? mock : original.call(this, name, ...args); };
    const send = (type: string, data = {}): Promise<any> => new Promise(resolve => { nextState = resolve; receive({ type, revision: state?.revision, ...data }); });
    try {
        await mkdir(path.dirname(oldConfig), { recursive: true });
        await writeFile(source, doc.getText());
        await writeFile(path.join(root, 'board.json'), JSON.stringify({ kind: 'board', extension: '.pcf', constraints: 'set_io {{PORT:A1}} {{PIN:A1}}\n', interfaces: [{ id: 'UART', signals: [{ id: 'tx', direction: 'output', pins: ['A1'] }] }] }));
        await writeFile(oldConfig, JSON.stringify({ board: '../board.json', bindings: [] }));
        const { PhysicalPinsPanel } = require('../archDesign/physicalPinsPanel');
        const manager = new PhysicalPinsPanel({}, { library: new UserPhysicalBoardLibrary({ configPath: path.join(root, 'library.json') }), ports: async () => [{ name: 'serial_tx', direction: 'output' }] });
        await manager.open(doc.uri);
        await send('ready'); await send('load-bindings');
        await send('select', { interface: 'UART', signal: 'tx', checked: true });
        await send('bind', { interface: 'UART', signal: 'tx', port: 'serial_tx' });
        await send('save-bindings');
        const saved = await readFile(newConfig, 'utf8');
        assert.equal(JSON.parse(saved).board, '../../board.json');
        assert.equal(JSON.parse(saved).bindings[0].port.name, 'serial_tx');
        await writeFile(newConfig, 'manual edit');
        await send('save-bindings'); assert.match(state.error, /conflict/i); assert.equal(await readFile(newConfig, 'utf8'), 'manual edit');
        await writeFile(newConfig, saved);
        saveTarget = Uri.file(path.join(root, 'top.pcf')); await send('confirm');
        assert.equal(await readFile(saveTarget.fsPath, 'utf8'), 'set_io serial_tx A1\n');
        saveTarget = undefined; await send('save-bindings'); assert.equal(state.error, '');
        saveTarget = Uri.file(path.join(root, 'stale.pcf')); changeDuringDialog = true; await send('confirm');
        assert.match(state.error, /Source changed/); await assert.rejects(readFile(saveTarget.fsPath), { code: 'ENOENT' });
        manager.dispose(); console.log('RTL pin bindings rebase, save/load, custom extension, cancel and stale source protection passed');
    } finally { loader._load = original; await rm(root, { recursive: true, force: true }); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
