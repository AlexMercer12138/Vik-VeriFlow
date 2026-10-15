import { randomUUID } from 'node:crypto';
import { readFile, unlink } from 'node:fs/promises';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { parseArchDesignText } from '@veriflow/schematic-core/arch-design';
import { emptyBoard, inferredBankType, inspectBoardDraft, parseBoardDraft, validateInterfaceDefinition } from './boardEditorModel';
import { boardLibraryHtml } from './boardLibraryView';
import { readPhysicalBoardFile, UserPhysicalBoardLibrary, type BoardInterfaceTemplate, type SavedPhysicalBoard } from './physicalBoardLibrary';

type BoardSnapshot = { draft: SavedPhysicalBoard; expected?: SavedPhysicalBoard };
export class BoardLibraryDocument implements vscode.CustomDocument {
    readonly panels = new Set<vscode.WebviewPanel>();
    readonly disposeEvent = new vscode.EventEmitter<void>();
    readonly onDidDispose = this.disposeEvent.event;
    draft: SavedPhysicalBoard;
    expected?: SavedPhysicalBoard;
    saved: BoardSnapshot;
    generation = 0;
    initialized = false;
    tail = Promise.resolve();
    constructor(readonly uri: vscode.Uri, snapshot: BoardSnapshot) {
        this.draft = parseBoardDraft(snapshot.draft);
        this.expected = snapshot.expected;
        this.saved = structuredClone(snapshot);
    }
    dispose(): void { this.disposeEvent.fire(); this.disposeEvent.dispose(); }
}

/** Native custom-document edits provide VS Code's dirty-close confirmation and undo history. */
export class BoardLibraryEditor implements vscode.CustomEditorProvider<BoardLibraryDocument>, vscode.Disposable {
    static readonly viewType = 'veriflow.boardLibrary';
    private edits?: vscode.EventEmitter<vscode.CustomDocumentEditEvent<BoardLibraryDocument>>;
    readonly onDidChangeCustomDocument: vscode.Event<vscode.CustomDocumentEditEvent<BoardLibraryDocument>> = (listener, thisArgs, disposables) =>
        (this.edits ??= new vscode.EventEmitter<vscode.CustomDocumentEditEvent<BoardLibraryDocument>>()).event(listener, thisArgs, disposables);
    private readonly registration: vscode.Disposable;
    private readonly documents = new Set<BoardLibraryDocument>();
    constructor(private readonly context: vscode.ExtensionContext, private readonly librarySource: UserPhysicalBoardLibrary | (() => UserPhysicalBoardLibrary),
        private readonly interfaceRootSource: string | (() => string), private readonly onLibraryChange: () => void) {
        this.registration = vscode.window.registerCustomEditorProvider(BoardLibraryEditor.viewType, this,
            { webviewOptions: { retainContextWhenHidden: true }, supportsMultipleEditorsPerDocument: false });
    }
    private get library(): UserPhysicalBoardLibrary { return typeof this.librarySource === 'function' ? this.librarySource() : this.librarySource; }
    private get interfaceRoot(): string { return typeof this.interfaceRootSource === 'function' ? this.interfaceRootSource() : this.interfaceRootSource; }
    dispose(): void { this.registration.dispose(); this.edits?.dispose(); for (const doc of this.documents) for (const panel of doc.panels) panel.dispose(); }
    private uniqueId(base: string): string {
        const ids = new Set(this.library.list().map(b => b.id));
        const candidate = base.replace(/[^A-Za-z0-9_.-]/g, '_').replace(/^[^A-Za-z0-9_]+/, '') || 'board';
        let id = candidate;
        for (let i = 2; ids.has(id); i++) id = candidate + '-' + i;
        return id;
    }
    async open(id?: string): Promise<void> {
        const existing = [...this.documents].find(doc => id && doc.expected?.id === id);
        if (existing) { for (const panel of existing.panels) panel.reveal(); return; }
        const board = id ? this.library.get(id) : emptyBoard();
        await this.openDraft(board, id ? structuredClone(board) : undefined);
    }
    async openDraft(draft: SavedPhysicalBoard, expected?: SavedPhysicalBoard): Promise<void> {
        draft = parseBoardDraft(draft);
        const directory = vscode.Uri.joinPath(this.context.globalStorageUri, 'board-editor');
        await vscode.workspace.fs.createDirectory(directory);
        const uri = vscode.Uri.joinPath(directory, randomUUID() + '.vfboard');
        await vscode.workspace.fs.writeFile(uri, Buffer.from(JSON.stringify({ draft, expected })));
        await vscode.commands.executeCommand('vscode.openWith', uri, BoardLibraryEditor.viewType);
    }
    async importBoard(): Promise<void> {
        const files = await vscode.window.showOpenDialog({ title: 'Import Board JSON', canSelectMany: false, filters: { 'Board JSON': ['json'] } });
        if (!files?.[0]) return;
        const file = files[0].fsPath, data = await readPhysicalBoardFile(file, this.interfaceRoot);
        const input = JSON.parse(await readFile(file, 'utf8'));
        const base = path.basename(file, '.json') === 'board' ? path.basename(path.dirname(file)) : path.basename(file, '.json');
        await this.openDraft({ ...data, id: this.uniqueId(typeof input.id === 'string' ? input.id : base), name: typeof input.name === 'string' ? input.name : base });
    }
    async openCustomDocument(uri: vscode.Uri, context: vscode.CustomDocumentOpenContext): Promise<BoardLibraryDocument> {
        const snapshot = JSON.parse(await readFile(context.backupId ? vscode.Uri.parse(context.backupId).fsPath : uri.fsPath, 'utf8')) as BoardSnapshot;
        const doc = new BoardLibraryDocument(uri, snapshot);
        this.documents.add(doc);
        doc.onDidDispose(() => this.documents.delete(doc));
        return doc;
    }
    private snapshot(doc: BoardLibraryDocument): BoardSnapshot { return structuredClone({ draft: doc.draft, expected: doc.expected }); }
    private validation(doc: BoardLibraryDocument) {
        return { ...inspectBoardDraft(doc.draft), bankTypes: Object.fromEntries((doc.draft.model.banks ?? []).map(bank => [bank.id, inferredBankType(doc.draft.model, bank.id)])) };
    }
    private templates(doc: BoardLibraryDocument): BoardInterfaceTemplate[] {
        const templates = this.library.templates();
        for (const [reference, definition] of Object.entries(doc.draft.definitions)) {
            const existing = templates.find(t => t.reference === reference);
            if (!existing) templates.push({ reference, name: reference, definition });
            else if (!reference.startsWith('library:interfaces/')) existing.definition = definition;
        }
        return templates;
    }
    private async publish(doc: BoardLibraryDocument): Promise<void> {
        const message = { type: 'state', draft: doc.draft, saved: !!doc.expected, boards: this.library.list().map(b => ({ id: b.id, name: b.name })),
            templates: this.templates(doc), ...this.validation(doc) };
        for (const panel of doc.panels) { panel.title = 'Board · ' + (doc.draft.name || 'New'); await panel.webview.postMessage(message); }
    }
    private replace(doc: BoardLibraryDocument, value: SavedPhysicalBoard): void {
        const before = structuredClone(doc.draft), after = parseBoardDraft(value);
        for (const bank of after.model.banks ?? []) bank.type ??= inferredBankType(after.model, bank.id);
        if (JSON.stringify(before) === JSON.stringify(after)) return;
        doc.draft = after; doc.generation++;
        this.edits?.fire({ document: doc, label: 'Edit Board', undo: async () => { doc.draft = before; doc.generation++; await this.publish(doc); },
            redo: async () => { doc.draft = after; doc.generation++; await this.publish(doc); } });
    }
    async saveCustomDocument(doc: BoardLibraryDocument): Promise<void> {
        const generation = doc.generation;
        this.library.saveBoard(doc.draft, doc.expected);
        const saved = this.library.get(doc.draft.id);
        doc.expected = saved;
        doc.saved = { draft: saved, expected: saved };
        await vscode.workspace.fs.writeFile(doc.uri, Buffer.from(JSON.stringify(doc.saved)));
        this.onLibraryChange();
        if (generation === doc.generation) { doc.draft = structuredClone(saved); await this.publish(doc); }
    }
    async saveCustomDocumentAs(doc: BoardLibraryDocument, destination: vscode.Uri): Promise<void> {
        const copy = structuredClone(doc.draft); copy.id = this.uniqueId(copy.id + '-copy'); copy.name += ' copy';
        this.library.saveBoard(copy);
        const saved = this.library.get(copy.id);
        await vscode.workspace.fs.writeFile(destination, Buffer.from(JSON.stringify({ draft: saved, expected: saved })));
        this.onLibraryChange();
    }
    async revertCustomDocument(doc: BoardLibraryDocument): Promise<void> {
        const saved = doc.expected ? this.library.get(doc.expected.id) : doc.saved.draft;
        doc.draft = structuredClone(saved); doc.expected = doc.expected ? structuredClone(saved) : undefined;
        doc.generation++; doc.saved = this.snapshot(doc); await this.publish(doc);
    }
    async backupCustomDocument(doc: BoardLibraryDocument, context: vscode.CustomDocumentBackupContext): Promise<vscode.CustomDocumentBackup> {
        await vscode.workspace.fs.writeFile(context.destination, Buffer.from(JSON.stringify(this.snapshot(doc))));
        return { id: context.destination.toString(), delete: async () => { try { await unlink(context.destination.fsPath); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; } } };
    }
    async resolveCustomEditor(doc: BoardLibraryDocument, panel: vscode.WebviewPanel): Promise<void> {
        doc.panels.add(panel);
        panel.webview.options = { enableScripts: true, localResourceRoots: [] };
        const messages = panel.webview.onDidReceiveMessage(message => {
            doc.tail = doc.tail.then(async () => {
                if (!message || typeof message.type !== 'string') return;
                if (message.type === 'ready') {
                    if (!doc.initialized && !doc.expected && JSON.stringify(doc.draft) !== JSON.stringify(emptyBoard())) {
                        const imported = doc.draft; doc.draft = emptyBoard(); this.replace(doc, imported);
                    }
                    doc.initialized = true;
                    await this.publish(doc); return;
                }
                if (message.type === 'change') {
                    this.replace(doc, parseBoardDraft(message.draft));
                    await panel.webview.postMessage({ type: 'validation', ...this.validation(doc) }); return;
                }
                if (message.type === 'save') { void vscode.commands.executeCommand('workbench.action.files.save'); return; }
                if (message.type === 'new') { await this.open(); return; }
                if (message.type === 'open') { if (typeof message.id !== 'string') throw new Error('Invalid board ID'); await this.open(message.id); return; }
                if (message.type === 'copy') {
                    const copy = structuredClone(doc.draft); copy.id = this.uniqueId(copy.id + '-copy'); copy.name += ' copy';
                    await this.openDraft(copy); return;
                }
                if (message.type === 'import') { await this.importBoard(); return; }
                if (message.type === 'saveNew') {
                    const id = await vscode.window.showInputBox({ title: 'New Board ID', value: this.uniqueId(doc.draft.id + '-copy'), validateInput: value => /^[A-Za-z0-9_][A-Za-z0-9_.-]*$/.test(value) ? undefined : 'Use letters, numbers, underscores, dots and hyphens; start with a letter, number or underscore' });
                    if (!id) return;
                    const name = await vscode.window.showInputBox({ title: 'New Board Name', value: doc.draft.name + ' copy', validateInput: value => value.trim() ? undefined : 'Enter a board name' });
                    if (!name) return;
                    this.library.saveBoard({ ...doc.draft, id, name }); this.onLibraryChange(); await this.open(id); return;
                }
                if (message.type === 'export') {
                    const errors = this.validation(doc).issues.filter(i => i.severity === 'error');
                    if (errors.length) throw new Error(errors.map(i => i.message).join('\n'));
                    const target = await vscode.window.showSaveDialog({ title: 'Export Board with Interface Snapshots', defaultUri: vscode.Uri.file(path.join(path.dirname(doc.uri.fsPath), doc.draft.id + '.json')), filters: { JSON: ['json'] } });
                    if (target) await vscode.workspace.fs.writeFile(target, Buffer.from(JSON.stringify(doc.draft, null, 2)));
                    return;
                }
                if (message.type === 'delete') {
                    if (!doc.expected) throw new Error('This board has not been saved');
                    const references = vscode.workspace.textDocuments.filter(document => {
                        if (!/\.ad$/i.test(document.uri.path)) return false;
                        const parsed = parseArchDesignText(document.getText());
                        return parsed.status === 'editable' && parsed.design.physical?.board === 'user:' + doc.expected!.id;
                    }).map(document => document.uri.fsPath);
                    const answer = await vscode.window.showWarningMessage('Delete user board ' + doc.expected.name + '?', { modal: true,
                        detail: references.length ? 'Open AD documents referencing this board:\n' + references.join('\n') : 'No open AD documents reference this board.' }, 'Delete');
                    if (answer === 'Delete') {
                        this.library.deleteBoard(doc.expected.id, doc.expected); doc.expected = undefined;
                        this.replace(doc, emptyBoard()); this.onLibraryChange(); await this.publish(doc);
                    }
                    return;
                }
                if (message.type === 'saveTemplate' || message.type === 'useTemplate') {
                    validateInterfaceDefinition(message.definition);
                    let reference: string;
                    if (message.type === 'saveTemplate') {
                        if (typeof message.id !== 'string' || typeof message.name !== 'string') throw new Error('Invalid template');
                        const existing = this.library.templates().find(t => t.reference === 'user-interfaces/' + message.id + '.json');
                        if (existing && await vscode.window.showWarningMessage('Replace user interface template ' + existing.name + '?', { modal: true }, 'Replace') !== 'Replace') return;
                        this.library.saveTemplate(message.id, message.name, message.definition);
                        reference = 'user-interfaces/' + message.id + '.json';
                    } else {
                        if (typeof message.reference !== 'string' || !/^board-interfaces\/[A-Za-z0-9_][A-Za-z0-9_.-]*\.json$/.test(message.reference) || typeof message.name !== 'string') throw new Error('Invalid template reference');
                        reference = message.reference;
                    }
                    const templates = this.templates(doc).filter(t => t.reference !== reference);
                    templates.push({ reference, name: message.name, definition: message.definition, user: true });
                    await panel.webview.postMessage({ type: 'templates', templates, reference, notice: message.type === 'saveTemplate' ? 'Saved to the user interface library. Existing board interface snapshots are unchanged.' : 'Interface ready. Enter an instance name to add it.' });
                }
            }).catch(async error => { await panel.webview.postMessage({ type: 'error', message: error instanceof Error ? error.message : String(error) }); });
        });
        panel.onDidDispose(() => { messages.dispose(); doc.panels.delete(panel); });
        panel.webview.html = boardLibraryHtml();
    }
}
