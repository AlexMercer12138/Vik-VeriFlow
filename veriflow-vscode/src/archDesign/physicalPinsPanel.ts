import * as path from 'node:path';
import { readFile } from 'node:fs/promises';
import * as vscode from 'vscode';
import { applyArchDesignEdit, bindPhysicalSignal, generateConstraints, parseArchDesignText, parsePhysicalConfiguration, physicalPins, physicalSignalMembers, serializeArchDesign, type PhysicalBoard, type PhysicalConfiguration, type PhysicalPort } from '@veriflow/schematic-core/arch-design';
import { resolvePhysicalBoard, resolvePhysicalConfiguration, UserPhysicalBoardLibrary, constraintArtifacts } from '@veriflow/hdl-runtime/physical';
import { checkArtifactPlan, publishArtifactPlan, publishGeneratedFile } from '@veriflow/hdl-runtime/archDesign';
import { physicalPinsHtml } from './physicalPinsView';
import { BoardLibraryEditor } from './boardLibraryEditor';
export type PhysicalPinsPanelServices = {
    ports(document: vscode.TextDocument): Promise<readonly PhysicalPort[]>;
    library?: UserPhysicalBoardLibrary;
};
export class PhysicalPinsPanel {
    private readonly panels = new Map<string, vscode.WebviewPanel>();
    private userLibrary?: UserPhysicalBoardLibrary;
    private boardEditor?: BoardLibraryEditor;
    private readonly refresh = new Set<() => void>();
    constructor(private readonly context: vscode.ExtensionContext, private readonly services: PhysicalPinsPanelServices) { }
    private get library(): UserPhysicalBoardLibrary { return this.services.library ?? (this.userLibrary ??= new UserPhysicalBoardLibrary()); }
    private get editor(): BoardLibraryEditor { return this.boardEditor ??= new BoardLibraryEditor(this.context, () => this.library, () => { for (const refresh of this.refresh)
        refresh(); }); }
    registerBoardEditor(): void { void this.editor; }
    async manageBoards(): Promise<void> { await this.editor.open(); }
    dispose(): void { this.boardEditor?.dispose(); for (const panel of this.panels.values())
        panel.dispose(); }
    async loadBoard(owner: vscode.Uri, reference: string): Promise<PhysicalBoard> { return resolvePhysicalBoard(owner.fsPath, reference, { library: this.library }); }
    async open(uri?: vscode.Uri): Promise<void> {
        uri ??= vscode.window.activeTextEditor?.document.uri;
        if (!uri || uri.scheme !== 'file' || !/\.(ad|v|sv)$/i.test(uri.path))
            throw new Error('Choose a local .ad, .v or .sv file');
        const owner = uri, existing = this.panels.get(owner.toString());
        if (existing) {
            existing.reveal();
            return;
        }
        const document = await vscode.workspace.openTextDocument(owner), isAd = /\.ad$/i.test(owner.path);
        const design = () => { const parsed = parseArchDesignText(document.getText()); if (parsed.status !== 'editable')
            throw new Error('AD is not editable'); return parsed.design; };
        let configuration: PhysicalConfiguration = isAd ? design().physical ?? { board: '', bindings: [] } : { board: '', bindings: [] };
        let configurationOwner = owner.fsPath, bindingSnapshot: string | undefined, version = document.version, revision = 0;
        let board: PhysicalBoard | undefined, ports: readonly PhysicalPort[] = [], inputs: {
            path: string;
            text: string;
        }[] = [], notice = '';
        let error = '', tail = Promise.resolve(), disposed = false;
        const active = new Set<string>(), key = (card: string | undefined, iface: string, signal: string) => JSON.stringify([card ?? '', iface, signal]);
        const panel = vscode.window.createWebviewPanel('veriflow.physicalPins', 'Pin Constraints · ' + path.basename(owner.fsPath), vscode.ViewColumn.Active, { enableScripts: true, retainContextWhenHidden: true });
        this.panels.set(owner.toString(), panel);
        const outputPath = () => {
            const ext = board?.model.extension ?? '.xdc';
            if (!isAd)
                return owner.fsPath.replace(/\.(v|sv)$/i, ext);
            const d = design(), rtl = d.export.output ? path.resolve(path.dirname(owner.fsPath), d.export.output) : owner.fsPath.replace(/\.ad$/i, d.export.language === 'systemverilog' ? '.sv' : '.v');
            const configured = d.export.constraintsOutput;
            return configured ? path.resolve(path.dirname(owner.fsPath), configured) : rtl.slice(0, -path.extname(rtl).length) + ext;
        };
        const interfaces = () => board ? [
            ...board.model.interfaces.map(iface => ({ ...iface, card: undefined as string | undefined })),
            ...Object.entries(board.cards ?? {}).flatMap(([card, model]) => model.interfaces.map(iface => ({ ...iface, card }))),
        ] : [];
        const synchronizeActive = () => {
            for (const iface of interfaces())
                for (const signal of iface.signals)
                    if (configuration.bindings.some(b => (b.source.card ?? '') === (iface.card ?? '') && b.source.interface === iface.id && physicalSignalMembers(iface, signal.id).includes(b.source.member)))
                        active.add(key(iface.card, iface.id, signal.id));
        };
        const load = async () => {
            const currentVersion = document.version;
            ports = await this.services.ports(document);
            inputs = [];
            board = undefined;
            board = configuration.board ? await resolvePhysicalConfiguration(configurationOwner, configuration, { library: this.library, onInput: (file, text) => inputs.push({ path: file, text }) }) : undefined;
            if (document.version !== currentVersion)
                throw new Error('Document changed; refresh before continuing');
            version = currentVersion;
            synchronizeActive();
        };
        const publish = async () => {
            if (disposed)
                return;
            const result = board ? generateConstraints(board, configuration, ports) : undefined;
            const missing = interfaces().flatMap(iface => iface.signals.filter(signal => active.has(key(iface.card, iface.id, signal.id))).flatMap(signal => physicalSignalMembers(iface, signal.id)
                .filter(member => !configuration.bindings.some(b => (b.source.card ?? '') === (iface.card ?? '') && b.source.interface === iface.id && b.source.member === member))));
            let choices: ReturnType<UserPhysicalBoardLibrary['list']> = [];
            try {
                choices = this.library.list();
            }
            catch (e) {
                error = (e as Error).message;
            }
            let output: string;
            try {
                output = outputPath();
            }
            catch (e) {
                output = '';
                error = (e as Error).message;
            }
            await panel.webview.postMessage({ type: 'state', revision: ++revision, isAd, configuration, choices: choices.map(b => ({ id: b.id, name: b.name, kind: b.model.kind })),
                interfaces: interfaces(), active: [...active], ports, pins: board ? physicalPins(board.model) : [],
                cards: Object.entries(board?.cards ?? {}).map(([id, model]) => ({ id, pins: physicalPins(model) })),
                diagnostics: [...result?.diagnostics ?? [], ...missing.map(member => ({ severity: 'error', message: 'Assign selected signal: ' + member }))],
                preview: result?.text ?? '', error, notice, output, canConfirm: !error && !!board && configuration.bindings.length > 0 && result?.text !== undefined && !missing.length });
        };
        const clear = (card: string | undefined, iface: string, members: string[]) => {
            configuration = { ...configuration, bindings: configuration.bindings.filter(b => (b.source.card ?? '') !== (card ?? '') || b.source.interface !== iface || !members.includes(b.source.member)) };
        };
        const rebase = (config: PhysicalConfiguration, from: string, to: string): PhysicalConfiguration => {
            const ref = (value: string) => value.startsWith('user:') ? value : path.relative(path.dirname(to), path.resolve(path.dirname(from), value)).replace(/\\/g, '/');
            return { ...config, board: ref(config.board), ...(config.cards ? { cards: config.cards.map(card => ({ ...card, board: ref(card.board) })) } : {}) };
        };
        const saveAd = async () => {
            const before = document.getText(), text = serializeArchDesign(applyArchDesignEdit(design(), { type: 'setPhysical', physical: configuration }));
            if (text !== before) {
                const edit = new vscode.WorkspaceEdit();
                edit.replace(owner, new vscode.Range(document.positionAt(0), document.positionAt(before.length)), text);
                if (!await vscode.workspace.applyEdit(edit))
                    throw new Error('Could not update AD');
            }
            if (!await document.save())
                throw new Error('Save AD before generating constraints');
            version = document.version;
        };
        const refresh = () => { tail = tail.then(async () => { await load(); await publish(); }).catch(async (e) => { error = (e as Error).message; await publish(); }); };
        this.refresh.add(refresh);
        const messages = panel.webview.onDidReceiveMessage(message => {
            tail = tail.then(async () => {
                if (!message || typeof message.type !== 'string')
                    return;
                error = '';
                notice = '';
                if (message.type === 'ready') {
                    await load();
                    await publish();
                    return;
                }
                if (message.revision !== revision)
                    throw new Error('Panel changed; retry the action');
                if (message.type === 'library') {
                    await this.manageBoards();
                    await publish();
                    return;
                }
                if (message.type === 'import') {
                    await this.editor.importBoard();
                    await publish();
                    return;
                }
                if (message.type === 'refresh') {
                    configuration = isAd ? design().physical ?? { board: '', bindings: [] } : configuration;
                    active.clear();
                    await load();
                    await publish();
                    return;
                }
                if (document.version !== version)
                    throw new Error('Source document changed; refresh the panel');
                if (message.type === 'board') {
                    configuration = parsePhysicalConfiguration({ board: message.board, bindings: [] });
                    active.clear();
                    await load();
                }
                else if (message.type === 'select') {
                    const iface = interfaces().find(i => (i.card ?? '') === (message.card ?? '') && i.id === message.interface);
                    if (!iface)
                        throw new Error('Unknown interface');
                    const signals = message.signal ? iface.signals.filter(s => s.id === message.signal) : iface.signals;
                    for (const signal of signals) {
                        const k = key(iface.card, iface.id, signal.id);
                        if (message.checked)
                            active.add(k);
                        else {
                            active.delete(k);
                            clear(iface.card, iface.id, physicalSignalMembers(iface, signal.id));
                        }
                    }
                }
                else if (message.type === 'bind') {
                    if (!board)
                        throw new Error('Choose a board');
                    const iface = interfaces().find(i => (i.card ?? '') === (message.card ?? '') && i.id === message.interface);
                    if (!iface)
                        throw new Error('Unknown interface');
                    const members = physicalSignalMembers(iface, message.signal);
                    const next = message.port ? bindPhysicalSignal(board, ports, iface.id, message.signal, message.port, iface.card) : [];
                    clear(iface.card, iface.id, members);
                    configuration = { ...configuration, bindings: [...configuration.bindings, ...next] };
                }
                else if (message.type === 'add-card') {
                    const id = String(message.id ?? '').trim();
                    if (!id || !/^[A-Za-z0-9_][A-Za-z0-9_.-]*$/.test(id))
                        throw new Error('Enter a daughtercard instance ID');
                    configuration = parsePhysicalConfiguration({ ...configuration, cards: [...configuration.cards ?? [], { id, board: message.board, connections: [] }] });
                    await load();
                }
                else if (message.type === 'remove-card') {
                    configuration = { ...configuration, cards: configuration.cards?.filter(c => c.id !== message.id), bindings: configuration.bindings.filter(b => b.source.card !== message.id) };
                    await load();
                }
                else if (message.type === 'map-card') {
                    configuration = parsePhysicalConfiguration({ ...configuration, cards: configuration.cards?.map(card => card.id !== message.id ? card : { ...card, connections: [...card.connections.filter(c => c.cardPin !== message.pin), ...(message.target ? [{ cardPin: message.pin, boardPin: message.target }] : [])] }) });
                }
                else if (message.type === 'load-bindings') {
                    if (isAd)
                        throw new Error('AD bindings are stored in AD');
                    const files = await vscode.window.showOpenDialog({ canSelectMany: false, filters: { JSON: ['json'] } });
                    if (!files?.[0]) {
                        await publish();
                        return;
                    }
                    if (document.isDirty && !await document.save())
                        throw new Error('Save RTL before loading bindings');
                    const text = await readFile(files[0].fsPath, 'utf8');
                    configuration = parsePhysicalConfiguration(JSON.parse(text));
                    configurationOwner = files[0].fsPath;
                    bindingSnapshot = text;
                    active.clear();
                    await load();
                }
                else if (message.type === 'save-bindings') {
                    if (isAd)
                        throw new Error('AD bindings are stored in AD');
                    const target = await vscode.window.showSaveDialog({ defaultUri: vscode.Uri.file(owner.fsPath.replace(/\.(v|sv)$/i, '.pins.json')), filters: { JSON: ['json'] } });
                    if (!target) {
                        await publish();
                        return;
                    }
                    if (!configuration.board)
                        throw new Error('Choose a board');
                    const text = JSON.stringify(rebase(configuration, configurationOwner, target.fsPath), null, 2) + '\n';
                    await publishGeneratedFile(target.fsPath, text, {}, previous => target.fsPath === configurationOwner && previous === bindingSnapshot);
                    configuration = parsePhysicalConfiguration(JSON.parse(text));
                    configurationOwner = target.fsPath;
                    bindingSnapshot = text;
                    notice = 'Bindings saved';
                }
                else if (message.type === 'confirm') {
                    const previousBoard = JSON.stringify(board);
                    await load();
                    if (!board)
                        throw new Error('Choose a board');
                    if (previousBoard !== JSON.stringify(board))
                        throw new Error('Board constraints changed; review the refreshed panel and confirm again');
                    for (const iface of interfaces())
                        for (const signal of iface.signals)
                            if (active.has(key(iface.card, iface.id, signal.id)))
                                for (const member of physicalSignalMembers(iface, signal.id))
                                    if (!configuration.bindings.some(b => (b.source.card ?? '') === (iface.card ?? '') && b.source.interface === iface.id && b.source.member === member))
                                        throw new Error('Assign selected signal: ' + member);
                    const generated = generateConstraints(board, configuration, ports);
                    if (generated.text === undefined || !configuration.bindings.length)
                        throw new Error(generated.diagnostics.map(d => d.message).join('\n') || 'Assign ports first');
                    const dialogVersion = document.version;
                    const target = isAd ? vscode.Uri.file(outputPath()) : await vscode.window.showSaveDialog({ defaultUri: vscode.Uri.file(outputPath()), filters: { Constraints: [board.model.extension.slice(1)] } });
                    if (!target) {
                        await publish();
                        return;
                    }
                    if (target.scheme !== 'file')
                        throw new Error('Choose a local constraint output file');
                    if (path.extname(target.fsPath) !== board.model.extension)
                        throw new Error('Output must use ' + board.model.extension);
                    const artifacts = await constraintArtifacts(owner.fsPath, target.fsPath, generated.text);
                    await checkArtifactPlan({ diagnostics: [], inputs, artifacts });
                    if (document.version !== dialogVersion)
                        throw new Error('Source changed during export; refresh and confirm again');
                    if (vscode.workspace.textDocuments.some(d => d.isDirty && artifacts.some(a => path.resolve(a.path).toLowerCase() === path.resolve(d.uri.fsPath).toLowerCase())))
                        throw new Error('Save output editors before exporting');
                    if (isAd)
                        await saveAd();
                    else {
                        if (document.isDirty && !await document.save())
                            throw new Error('Save RTL before exporting');
                        if (document.version !== dialogVersion)
                            throw new Error('RTL changed while saving; refresh and confirm again');
                    }
                    const exportVersion = document.version, sourceText = document.getText();
                    await publishArtifactPlan({ diagnostics: [], inputs: [...inputs, { path: owner.fsPath, text: sourceText }, ...(!isAd && bindingSnapshot !== undefined ? [{ path: configurationOwner, text: bindingSnapshot }] : [])], artifacts });
                    if (document.version !== exportVersion)
                        throw new Error('Source changed during export; refresh and export again');
                    notice = isAd ? 'Constraints exported and bindings saved in AD.' : 'Constraints exported. Save bindings to reuse this configuration.';
                }
                await publish();
            }).catch(async (e) => { error = e instanceof Error ? e.message : String(e); await publish(); });
        });
        panel.onDidDispose(() => { disposed = true; messages.dispose(); this.refresh.delete(refresh); this.panels.delete(owner.toString()); });
        panel.webview.html = physicalPinsHtml();
    }
}
