import * as path from 'path';
import { readFile } from 'fs/promises';
import * as vscode from 'vscode';
import { applyArchDesignEdit, createPhysicalBoard, bindPhysicalSignal, physicalIoStandards, setPhysicalIoStandard, generateXdc, parseArchDesignText, parsePhysicalConfiguration, physicalMembers, physicalGroupMembers, physicalPairs, physicalSelectionMembers, physicalSignalMembers, setPhysicalSelection, serializeArchDesign, type PhysicalBoard, type PhysicalConfiguration, type PhysicalPort } from '@veriflow/schematic-core/arch-design';
import { ArchDesignGeneratedFileConflictError, archDesignXdcOutputPath, publishGeneratedFile } from './archDesignExport';
import { UserPhysicalBoardLibrary, readPhysicalBoardFile } from './physicalBoardLibrary';
import { physicalPinsHtml } from './physicalPinsView';

type BoardChoice = { label: string; reference: string };
export type PhysicalPinsPanelServices = {
    ports(document: vscode.TextDocument): Promise<readonly PhysicalPort[]>;
    library?: UserPhysicalBoardLibrary;
};
const relativeModelPath = /^(?![A-Za-z][A-Za-z0-9+.-]*:)(?![/\\])(?!.*[\r\n\0]).+$/;
export class PhysicalPinsPanel {
    private readonly panels = new Map<string, vscode.WebviewPanel>();
    private userLibrary?: UserPhysicalBoardLibrary;
    constructor(private readonly context: vscode.ExtensionContext, private readonly services: PhysicalPinsPanelServices) {}
    private get interfaceRoot(): string { return path.join(this.context.extensionUri.fsPath, 'resources', 'physical-models', 'interfaces'); }
    private get library(): UserPhysicalBoardLibrary { return this.services.library ?? (this.userLibrary ??= new UserPhysicalBoardLibrary({ interfaceRoot: this.interfaceRoot })); }
    dispose(): void { for (const panel of [...this.panels.values()]) panel.dispose(); }
    async loadBoard(owner: vscode.Uri, reference: string, references?: (sources: vscode.Uri[]) => void): Promise<PhysicalBoard> {
        if (/^user:[A-Za-z0-9_][A-Za-z0-9_.-]*$/.test(reference)) {
            references?.([vscode.Uri.file(this.library.configPath)]);
            return this.library.load(reference.slice(5));
        }
        if (!relativeModelPath.test(reference)) throw new Error('Choose a saved user board or use a relative workspace board path');
        const file = path.resolve(path.dirname(owner.fsPath), reference);
        references?.([vscode.Uri.file(file)]);
        const data = await readPhysicalBoardFile(file, this.interfaceRoot, files => references?.(files.map(f => vscode.Uri.file(f))));
        return createPhysicalBoard(data.model, data.definitions);
    }
    async open(uri?: vscode.Uri): Promise<void> {
        uri ??= vscode.window.activeTextEditor?.document.uri;
        if (!uri || !/\.(ad|v|sv)$/i.test(uri.path)) throw new Error('Choose an .ad, .v or .sv file');
        if (uri.scheme !== 'file') throw new Error('Pin constraints currently require a local file');
        const existing = this.panels.get(uri.toString());
        if (existing) { existing.reveal(); return; }
        const owner = uri, document = await vscode.workspace.openTextDocument(owner), isAd = /\.ad$/i.test(owner.path);
        const getDesign = () => {
            const parsed = parseArchDesignText(document.getText());
            if (parsed.status !== 'editable') throw new Error('AD is not editable');
            return parsed.design;
        };
        if (isAd) getDesign();
        const panel = vscode.window.createWebviewPanel('veriflow.physicalPins', 'Pin Constraints · ' + path.basename(owner.fsPath), vscode.ViewColumn.Active, { enableScripts: true, retainContextWhenHidden: true });
        this.panels.set(owner.toString(), panel);
        let disposed = false, board: PhysicalBoard | undefined, configuration: PhysicalConfiguration = { board: '', bindings: [] };
        let choices: BoardChoice[] = [], ports: readonly PhysicalPort[] = [], sources: vscode.Uri[] = [];
        let revision = 0, tail = Promise.resolve(), loadedVersion = document.version, ownEditText: string | undefined;
        let boardError: string | undefined, libraryError: string | undefined, notice = '', savedPhysical: string | undefined;
        const load = async () => {
            const version = document.version;
            ports = await this.services.ports(document);
            if (isAd) {
                const physical = getDesign().physical, persisted = JSON.stringify(physical ?? null);
                if (persisted !== savedPhysical) { configuration = physical ?? { board: '', bindings: [] }; savedPhysical = persisted; }
            }
            choices = []; libraryError = undefined;
            try { choices = this.library.list().map(b => ({ label: b.name, reference: 'user:' + b.id })); }
            catch (error) { libraryError = error instanceof Error ? error.message : String(error); }
            board = undefined; boardError = undefined; sources = [];
            if (configuration.board) {
                try { board = await this.loadBoard(owner, configuration.board, value => { sources = value; }); }
                catch (error) { boardError = error instanceof Error ? error.message : String(error); }
                if (!choices.some(c => c.reference === configuration.board)) choices.push({ label: configuration.board, reference: configuration.board });
            }
            if (document.version !== version) throw new Error('Document changed; retry after refresh');
            loadedVersion = version;
        };
        const availability = () => Object.fromEntries(Object.entries(board?.definitions ?? {}).map(([iface, definition]) => {
            const selected = new Set(physicalSelectionMembers(configuration, iface)), cache = new Map<string, string | undefined>();
            const reason = (members: string[]) => {
                if (members.every(m => selected.has(m))) return undefined;
                const key = members.join('\0');
                if (!cache.has(key)) {
                    try { setPhysicalSelection(board!, configuration, iface, members, true); cache.set(key, undefined); }
                    catch (error) { cache.set(key, error instanceof Error ? error.message : String(error)); }
                }
                return cache.get(key);
            };
            return [iface, {
                interface: reason(physicalMembers(definition)),
                groups: Object.fromEntries((definition.groups ?? []).map(group => [group.id, reason(physicalGroupMembers(definition, group.id))])),
                members: Object.fromEntries(physicalMembers(definition).map(member => [member, reason([member])])),
            }];
        }));
        const publish = async () => {
            if (disposed) return;
            const result = board ? generateXdc(board, configuration, ports) : undefined;
            const issues = [...(libraryError ? [{ severity: 'error', message: libraryError }] : []),
                ...(boardError ? [{ severity: 'error', message: boardError }] : []), ...result?.diagnostics ?? []];
            let output: string | undefined;
            try { output = isAd ? archDesignXdcOutputPath(owner.fsPath, getDesign()) : owner.fsPath.replace(/\.(v|sv)$/i, '.xdc'); }
            catch (error) { issues.push({ severity: 'error', message: error instanceof Error ? error.message : String(error) }); }
            await panel.webview.postMessage({ type: 'state', revision: ++revision, isAd, choices, ports, configuration,
                board: board?.model, ioOptions: board && Object.fromEntries(Object.entries(board.definitions).map(([id, def]) => [id, Object.fromEntries(physicalMembers(def).map(member => {
                    const binding = configuration.bindings.find(b => b.source.interface === id && b.source.member === member);
                    return [member, physicalIoStandards(board!, configuration, id, member, ports.find(p => p.name === binding?.port.name)?.direction)];
                }))])),
                interfaces: board && Object.fromEntries(Object.entries(board.definitions).map(([id, def]) => [id, { ...def, members: physicalMembers(def) }])),
                availability: availability(), issues, notice, output: output ?? '(fix export settings)',
                canConfirm: !!output && !!result?.text && configuration.bindings.length > 0 && !boardError && !libraryError });
        };
        const report = async (error: unknown) => {
            if (!disposed) await panel.webview.postMessage({ type: 'error', message: error instanceof Error ? error.message : String(error) });
        };
        const persistAd = async () => {
            const version = document.version;
            if (version !== loadedVersion) throw new Error('AD changed; retry after refresh');
            const text = serializeArchDesign(applyArchDesignEdit(getDesign(), { type: 'setPhysical', physical: configuration }));
            const edit = new vscode.WorkspaceEdit();
            edit.replace(owner, new vscode.Range(document.positionAt(0), document.positionAt(document.getText().length)), text);
            ownEditText = text;
            try { if (!await vscode.workspace.applyEdit(edit)) throw new Error('Unable to update AD pin bindings'); }
            finally { ownEditText = undefined; }
            loadedVersion = document.version;
            savedPhysical = JSON.stringify(getDesign().physical ?? null);
            if (!await document.save()) throw new Error('Save AD before generating XDC');
            if (document.version !== loadedVersion) throw new Error('AD changed during save; retry confirmation');
            if (document.isDirty) throw new Error('AD changed during save; retry confirmation');
        };
        const subscription = vscode.workspace.onDidChangeTextDocument(event => {
            if (event.document.uri.toString() !== owner.toString() || !event.contentChanges.length || (ownEditText !== undefined && event.document.getText() === ownEditText)) return;
            tail = tail.then(async () => { notice = ''; await load(); await publish(); }).catch(report);
        });
        const watcher = vscode.workspace.createFileSystemWatcher('**/*.json');
        const userWatcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(path.dirname(this.library.configPath), path.basename(this.library.configPath)));
        const refresh = (changed: vscode.Uri) => {
            if (changed.fsPath !== this.library.configPath && !sources.some(source => source.toString() === changed.toString())) return;
            tail = tail.then(async () => { notice = ''; await load(); await publish(); }).catch(report);
        };
        const changes = [watcher, userWatcher].flatMap(w => [w.onDidChange(refresh), w.onDidCreate(refresh), w.onDidDelete(refresh)]);
        panel.onDidDispose(() => { disposed = true; subscription.dispose(); watcher.dispose(); userWatcher.dispose(); changes.forEach(s => s.dispose()); this.panels.delete(owner.toString()); });
        const clear = (iface: string, members: readonly string[]) => {
            const definition = board?.definitions[iface];
            if (!definition) throw new Error('Unknown interface');
            const removed = new Set(members);
            if (definition.kind === 'fixed')
                for (const pair of physicalPairs(definition))
                    if (removed.has(pair.positive) || removed.has(pair.negative)) { removed.add(pair.positive); removed.add(pair.negative); }
            configuration = { ...configuration, bindings: configuration.bindings.filter(b => b.source.interface !== iface || !removed.has(b.source.member)) };
        };
        panel.webview.onDidReceiveMessage(message => {
            tail = tail.then(async () => {
                if (disposed) return;
                if (message?.type === 'ready') { await load(); await publish(); return; }
                if (message?.revision !== revision) throw new Error('Pins changed; retry this action');
                if (document.version !== loadedVersion) throw new Error('Document changed; retry after refresh');
                notice = '';
                if (message.type === 'board') {
                    if (!choices.some(c => c.reference === message.reference)) throw new Error('Unknown board');
                    const loaded = await this.loadBoard(owner, message.reference, value => { sources = value; });
                    configuration = { board: message.reference, selections: [], bindings: [] }; board = loaded; boardError = undefined;
                } else if (message.type === 'import') {
                    const files = await vscode.window.showOpenDialog({ title: 'Import board into user library', canSelectMany: false, filters: { 'Board JSON': ['json'] } });
                    if (files?.[0]) {
                        const id = await this.library.importBoard(files[0].fsPath);
                        configuration = { board: 'user:' + id, selections: [], bindings: [] };
                        await load();
                    }
                } else if (message.type === 'library') {
                    this.library.ensureFile();
                    await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(vscode.Uri.file(this.library.configPath)), { preview: false });
                } else if (message.type === 'settings') {
                    configuration = parsePhysicalConfiguration({ ...configuration, railVoltages: message.railVoltages });
                } else if (message.type === 'standard') {
                    if (!board || !Array.isArray(message.members) || typeof message.standard !== 'string') throw new Error('Invalid IO standard choice');
                    configuration = setPhysicalIoStandard(board, configuration, message.interface, message.members, message.standard, ports);
                } else if (message.type === 'select') {
                    if (!board || !Array.isArray(message.members) || typeof message.checked !== 'boolean') throw new Error('Invalid selection');
                    configuration = setPhysicalSelection(board, configuration, message.interface, message.members, message.checked);
                } else if (message.type === 'bind') {
                    if (!board) throw new Error('Choose a board first');
                    if (!message.port) {
                        clear(message.interface, physicalSignalMembers(board.definitions[message.interface], message.signal));
                        await publish(); return;
                    }
                    const definition = board.definitions[message.interface];
                    let signal = message.signal;
                    if (definition?.kind === 'fixed') {
                        const members = physicalSignalMembers(definition, signal), pairs = physicalPairs(definition);
                        const partners = members.map(member => /_n$/.test(message.port) ? pairs.find(p => p.positive === member)?.negative
                            : /_p$/.test(message.port) ? pairs.find(p => p.negative === member)?.positive : undefined);
                        if (partners.every(Boolean)) signal = definition.signals.find(s => JSON.stringify(physicalSignalMembers(definition, s)) === JSON.stringify(partners)) ?? partners[0];
                    }
                    const bindings = bindPhysicalSignal(board, ports, message.interface, signal, message.port);
                    if (bindings.some(b => !physicalSelectionMembers(configuration, b.source.interface).includes(b.source.member))) throw new Error('Select the physical signal before assigning a port');
                    const names = new Set(bindings.map(b => b.port.name)), targets = new Set(bindings.map(b => JSON.stringify(b.source)));
                    configuration = { ...configuration, bindings: [...configuration.bindings.filter(b => !names.has(b.port.name) && !targets.has(JSON.stringify(b.source))), ...bindings] };
                } else if (message.type === 'clear') {
                    if (!Array.isArray(message.members) || !message.members.every((m: unknown) => typeof m === 'string')) throw new Error('Invalid assignment');
                    clear(message.interface, message.members);
                } else if (message.type === 'remove') {
                    if (typeof message.port !== 'string') throw new Error('Invalid port');
                    for (const binding of configuration.bindings.filter(b => b.port.name === message.port)) clear(binding.source.interface, [binding.source.member]);
                } else if (message.type === 'confirm') {
                    const version = document.version;
                    // Re-read hardware and RTL, preserving the draft until confirmation succeeds.
                    await load();
                    if (!board) throw new Error(boardError ?? 'Choose a board first');
                    const result = generateXdc(board, configuration, ports);
                    if (!result.text || !configuration.bindings.length) throw new Error(result.diagnostics.map(d => d.message).join('\n') || 'Select signals and assign at least one port');
                    const defaultPath = isAd ? archDesignXdcOutputPath(owner.fsPath, getDesign()) : owner.fsPath.replace(/\.(v|sv)$/i, '.xdc');
                    const target = isAd ? vscode.Uri.file(defaultPath) : await vscode.window.showSaveDialog({ title: 'Save Pin Constraints', defaultUri: vscode.Uri.file(defaultPath), filters: { XDC: ['xdc'] }, saveLabel: 'Generate XDC' });
                    if (!target) { await publish(); return; }
                    if (target.scheme !== 'file' || !/\.xdc$/i.test(target.path)) throw new Error('Output must be a local .xdc file');
                    if (document.version !== version) throw new Error('Document changed during confirmation; retry');
                    const relative = path.relative(path.dirname(target.fsPath), owner.fsPath), source = path.isAbsolute(relative) ? owner.fsPath : relative;
                    const marker = '# vik-veriflow:generated xdc source=' + encodeURIComponent(source.replace(/\\/g, '/')) + '\n';
                    if (isAd) {
                        try {
                            if (!(await readFile(target.fsPath, 'utf8')).startsWith(marker)) throw new ArchDesignGeneratedFileConflictError(target.fsPath);
                        } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
                        if (document.version !== version) throw new Error('AD changed; retry confirmation');
                        await persistAd();
                    }
                    const exportVersion = document.version;
                    await publishGeneratedFile(target.fsPath, marker + '# Board: ' + configuration.board + '\n' + result.text, {}, text => text.startsWith(marker));
                    if (document.version !== exportVersion) throw new Error('Document changed during export; confirm again to update XDC');
                    notice = isAd ? 'XDC generated. Pin bindings saved in AD.' : 'XDC saved. No bindings stored in RTL.';
                    await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(target), { preview: true });
                } else return;
                await publish();
            }).catch(async error => { await report(error); await publish().catch(report); });
        });
        panel.webview.html = physicalPinsHtml();
    }
}
