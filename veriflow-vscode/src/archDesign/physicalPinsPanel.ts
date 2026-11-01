import * as path from 'node:path';
import { readFile } from 'node:fs/promises';
import * as vscode from 'vscode';
import { applyArchDesignEdit, parseArchDesignText, serializeArchDesign, type PhysicalBoard, type PhysicalConfiguration, type PhysicalPort } from '@veriflow/schematic-core/arch-design';
import { ConstraintWorkbench, UserPhysicalBoardLibrary, resolvePhysicalBoard, type ConstraintSource } from '@veriflow/hdl-runtime/physical';
import { constraintWorkbenchHtml } from '@veriflow/schematic-webview/boardLibraryView';
export type PhysicalPinsPanelServices = {
    ports(document: vscode.TextDocument): Promise<readonly PhysicalPort[]>;
    module?(uri: vscode.Uri): string | undefined;
    inputs?(uri: vscode.Uri): Promise<{
        path: string;
        text: string;
    }[]>;
    library?: UserPhysicalBoardLibrary;
};
export class PhysicalPinsPanel {
    private panel?: vscode.WebviewPanel;
    private readonly session: ConstraintWorkbench;
    private readonly library: UserPhysicalBoardLibrary;
    private readonly documents = new Map<string, vscode.TextDocument>();
    constructor(private readonly context: vscode.ExtensionContext, private readonly services: PhysicalPinsPanelServices) {
        this.library = services.library ?? new UserPhysicalBoardLibrary();
        this.session = new ConstraintWorkbench({ library: this.library, source: file => this.source(file), saveAd: (source, config) => this.saveAd(source, config),
            openFile: async (kind) => { const files = await vscode.window.showOpenDialog({ title: kind === 'board' ? 'Import board' : kind === 'source' ? 'Open HDL / AD file' : 'Load bindings', canSelectMany: false, filters: kind === 'board' ? { 'Board file': ['json'] } : kind === 'source' ? { 'HDL / AD': ['v', 'sv', 'ad'] } : { 'Bindings': ['json'] } }); return files?.[0]?.fsPath; },
            saveFile: async (kind, suggestion) => { const base = this.sessionSourceFolder(); const target = await vscode.window.showSaveDialog({ title: kind === 'board' ? 'Export board' : kind === 'constraints' ? 'Export constraints' : 'Save bindings', defaultUri: vscode.Uri.file(path.isAbsolute(suggestion) ? suggestion : path.join(base, suggestion)), filters: kind === 'constraints' ? { 'Constraints': [path.extname(suggestion).slice(1)] } : { 'Board / bindings': ['json'] } }); return target?.fsPath; },
            confirmDelete: async (name) => await vscode.window.showWarningMessage('Delete board ' + name + '?', { modal: true }, 'Delete') === 'Delete',
            persist: async (value) => { await context.workspaceState?.update('constraint-workbench', value); },
        }, message => { void this.panel?.webview.postMessage(message); });
        this.session.restore(context.workspaceState?.get('constraint-workbench'));
    }
    private sessionSourceFolder() { return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? this.context.globalStorageUri?.fsPath ?? process.cwd(); }
    private async source(file: string): Promise<ConstraintSource> {
        const uri = vscode.Uri.file(file), document = await vscode.workspace.openTextDocument(uri);
        this.documents.set(file, document);
        const text = document.getText(), isAd = /\.ad$/i.test(file), ports = await this.services.ports(document);
        if (document.getText() !== text)
            throw new Error('Source changed while reading ports; retry');
        const inputs = this.services.inputs ? await this.services.inputs(uri) : [{ path: file, text }];
        let configuration: PhysicalConfiguration | undefined, configurationPath = file.replace(/\.(v|sv)$/i, '.pins.json'), configurationText: string | undefined, output: string | undefined, outputStem: string | undefined, module = this.services.module?.(uri) ?? path.basename(file, path.extname(file));
        if (isAd) {
            const parsed = parseArchDesignText(text);
            if (parsed.status !== 'editable')
                throw new Error('AD is not editable');
            configuration = parsed.design.physical;
            configurationPath = file;
            module = parsed.design.module;
            const rtl = parsed.design.export.output ? path.resolve(path.dirname(file), parsed.design.export.output) : undefined;
            if (rtl)
                outputStem = rtl.slice(0, -path.extname(rtl).length);
            if (parsed.design.export.constraintsOutput)
                output = path.resolve(path.dirname(file), parsed.design.export.constraintsOutput);
            else if (rtl && configuration?.board) {
                const board = await resolvePhysicalBoard(file, configuration.board, { library: this.library });
                output = rtl.slice(0, -path.extname(rtl).length) + board.model.extension;
            }
        }
        else
            try {
                configurationText = await readFile(configurationPath, 'utf8');
                configuration = JSON.parse(configurationText);
            }
            catch (e) {
                if ((e as NodeJS.ErrnoException).code !== 'ENOENT')
                    throw e;
            }
        return { path: file, text, module, ports, isAd, configuration, configurationPath, configurationText, output, outputStem, inputs };
    }
    private async saveAd(source: ConstraintSource, config: PhysicalConfiguration): Promise<ConstraintSource> {
        const doc = this.documents.get(source.path)!;
        if (doc.getText() !== source.text)
            throw new Error('Source changed; refresh before saving');
        const parsed = parseArchDesignText(doc.getText());
        if (parsed.status !== 'editable')
            throw new Error('AD is not editable');
        const text = serializeArchDesign(applyArchDesignEdit(parsed.design, { type: 'setPhysical', physical: config }));
        if (text !== doc.getText()) {
            const edit = new vscode.WorkspaceEdit();
            edit.replace(doc.uri, new vscode.Range(doc.positionAt(0), doc.positionAt(doc.getText().length)), text);
            if (!await vscode.workspace.applyEdit(edit))
                throw new Error('Could not update AD');
        }
        if (!await doc.save())
            throw new Error('Save AD before exporting');
        return this.source(source.path);
    }
    private async ensurePanel(): Promise<void> {
        if (this.panel) {
            this.panel.reveal(vscode.ViewColumn.Active);
            return;
        }
        const panel = vscode.window.createWebviewPanel('veriflow.constraints', 'Pin constraints', vscode.ViewColumn.Active, { enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, 'media', 'constraints')] });
        this.panel = panel;
        const listener=panel.webview.onDidReceiveMessage(message => { void this.session.dispatch(message); });
        panel.onDidDispose(() => { listener?.dispose();this.panel = undefined; });
        const root = vscode.Uri.joinPath(this.context.extensionUri, 'media', 'constraints'), css = panel.webview.asWebviewUri(vscode.Uri.joinPath(root, 'index.css')).toString(), script = panel.webview.asWebviewUri(vscode.Uri.joinPath(root, 'index.js')).toString();
        panel.webview.html = constraintWorkbenchHtml(await readFile(vscode.Uri.joinPath(root, 'index.html').fsPath, 'utf8'), css, script, panel.webview.cspSource);
    }
    async open(uri?: vscode.Uri): Promise<void> { uri ??= vscode.window.activeTextEditor?.document.uri; if (!uri || uri.scheme !== 'file' || !/\.(ad|v|sv)$/i.test(uri.path))
        throw new Error('Choose a local .ad, .v or .sv file'); await this.ensurePanel(); await this.session.open(uri.fsPath); }
    async manageBoards(): Promise<void> { await this.ensurePanel(); await this.session.open(); }
    async loadBoard(owner: vscode.Uri, reference: string): Promise<PhysicalBoard> { return resolvePhysicalBoard(owner.fsPath, reference, { library: this.library }); }
    dispose(): void { this.panel?.dispose(); }
}
