import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import Module = require('module');
import { createEmptyArchDesign, serializeArchDesign } from '@veriflow/schematic-core/arch-design';
import { UserPhysicalBoardLibrary } from '../archDesign/physicalBoardLibrary';

async function main(): Promise<void> {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'veriflow-board-editor-'));
    class Uri {
        constructor(readonly fsPath: string) {}
        get path(): string { return this.fsPath.replace(/\\/g, '/'); }
        toString(): string { return pathToFileURL(this.fsPath).toString(); }
        static file(value: string): Uri { return new Uri(path.resolve(value)); }
        static parse(value: string): Uri { return new Uri(fileURLToPath(value)); }
        static joinPath(base: Uri, ...parts: string[]): Uri { return Uri.file(path.join(base.fsPath, ...parts)); }
    }
    class EventEmitter<T> {
        listeners = new Set<(value: T) => void>();
        event = (listener: (value: T) => void) => { this.listeners.add(listener); return { dispose: () => this.listeners.delete(listener) }; };
        fire(value: T): void { this.listeners.forEach(listener => listener(value)); }
        dispose(): void { this.listeners.clear(); }
    }
    let opened: Uri | undefined, registration: any, warning = '', changes = 0;
    const textDocuments: any[] = [], messages: any[] = [];
    let receive: (message: any) => void = () => {};
    const mock = {
        Uri, EventEmitter,
        workspace: { textDocuments, fs: {
            createDirectory: async (uri: Uri) => fs.mkdir(uri.fsPath, { recursive: true }),
            writeFile: (uri: Uri, bytes: Uint8Array) => fs.writeFile(uri.fsPath, bytes),
        } },
        commands: { executeCommand: async (command: string, uri: Uri, viewType: string) => { if (command === 'vscode.openWith') { assert.equal(viewType, 'veriflow.boardLibrary'); opened = uri; } } },
        window: {
            registerCustomEditorProvider: (_type: string, provider: unknown) => { registration = provider; return { dispose() {} }; },
            showWarningMessage: async (_message: string, options: any) => { warning = options.detail ?? ''; return 'Delete'; },
            showSaveDialog: async () => Uri.file(path.join(directory, 'export.json')),
        },
    };
    const loader = Module as unknown as { _load: (...args: any[]) => any }, originalLoad = loader._load;
    loader._load = function(name: string, ...args: any[]): any { return name === 'vscode' ? mock : originalLoad.call(this, name, ...args); };
    try {
        const { BoardLibraryEditor } = require('../archDesign/boardLibraryEditor');
        const interfaceRoot = path.resolve(__dirname, '../../../data/physical-models/interfaces');
        const library = new UserPhysicalBoardLibrary({ configPath: path.join(directory, 'config.json'), interfaceRoot });
        const editor = new BoardLibraryEditor({ globalStorageUri: Uri.file(directory) }, library, interfaceRoot, () => changes++);
        assert.equal(registration, editor);
        const source = { id: 'clock', name: 'Clock', definitions: { 'clock.json': { kind: 'fixed', signals: ['clk'], function: { input: { clk: 'input' } } } },
            model: { kind: 'board', vendor: 'amd', device: 'xcau15p-ffvb676-2-i', fpgaPins: [{ id: 'P1' }], interfaces: [{ id: 'CLK', definition: 'clock.json' }], routes: [{ interface: 'CLK', member: 'clk', pin: 'P1' }] } };
        await editor.openDraft(source);
        const doc = await editor.openCustomDocument(opened!, {}), edits: any[] = [];
        editor.onDidChangeCustomDocument((edit: any) => edits.push(edit));
        const panel = { title: '', reveal() {}, onDidDispose: () => ({ dispose() {} }), dispose() {}, webview: { options: {}, html: '',
            postMessage: async (message: any) => { messages.push(message); return true; },
            onDidReceiveMessage: (callback: any) => { receive = callback; return { dispose() {} }; } } };
        await editor.resolveCustomEditor(doc, panel);
        receive({ type: 'ready' }); await doc.tail;
        assert.equal(edits.length, 1, 'imported and copied drafts need native dirty-close protection');
        const changed = structuredClone(source); changed.name = 'Clock 2';
        receive({ type: 'change', draft: changed }); await doc.tail;
        assert.equal(doc.draft.name, 'Clock 2');
        await edits.at(-1).undo(); assert.equal(doc.draft.name, 'Clock');
        await edits.at(-1).redo(); assert.equal(doc.draft.name, 'Clock 2');
        await editor.saveCustomDocument(doc);
        assert.equal(library.list()[0].name, 'Clock 2'); assert.equal(changes, 1);
        const backupFile = Uri.file(path.join(directory, 'backup'));
        const backup = await editor.backupCustomDocument(doc, { destination: backupFile });
        const restored = await editor.openCustomDocument(opened!, { backupId: backup.id });
        assert.deepEqual(restored.draft, doc.draft);
        receive({ type: 'export' }); await doc.tail;
        assert.equal(JSON.parse(await fs.readFile(path.join(directory, 'export.json'), 'utf8')).definitions['clock.json'].kind, 'fixed');
        const external = library.get('clock'); external.name = 'External'; library.saveBoard(external, library.get('clock'));
        await assert.rejects(() => editor.saveCustomDocument(doc), /changed/);
        await editor.revertCustomDocument(doc); assert.equal(doc.draft.name, 'External');
        const design = { ...createEmptyArchDesign('top'), physical: { board: 'user:clock', bindings: [] } };
        textDocuments.push({ uri: Uri.file(path.join(directory, 'open.ad')), getText: () => serializeArchDesign(design) });
        receive({ type: 'delete' }); await doc.tail;
        assert.ok(warning.includes('open.ad')); assert.equal(library.list().length, 0);
        await backup.delete(); editor.dispose();
        console.log('Board custom editor dirty edits, undo, save, stale edits, backup, export and deletion references passed');
    } finally {
        loader._load = originalLoad;
        assert.equal(path.dirname(directory), os.tmpdir());
        await fs.rm(directory, { recursive: true, force: true });
    }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
