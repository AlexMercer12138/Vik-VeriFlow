import * as vscode from 'vscode';
import { randomBytes } from 'node:crypto';
import type { HdlDefinitionSummary } from '../core';
import type { ModuleReference } from './moduleTargets';
import { buildModuleBrowserTree, type ModuleBrowserRoot } from './moduleBrowserModel';
import { moduleBrowserHtml } from './moduleBrowserWebview';

export class ModuleBrowserItem {
    readonly reference: ModuleReference;
    constructor(readonly definition: HdlDefinitionSummary) {
        this.reference = { uri: definition.uri, module: definition.name, definitionKey: definition.key };
    }
}

export interface ModuleBrowserServices {
    definitions(): Promise<readonly HdlDefinitionSummary[]>;
    roots?(): readonly ModuleBrowserRoot[];
}

/** Every indexed module is one row; source identity is never collapsed by name or file. */
export class ModuleBrowserProvider implements vscode.WebviewViewProvider, vscode.Disposable {
    private readonly watcher = vscode.workspace.createFileSystemWatcher('**/*.{v,sv,vh,svh}');
    private readonly subscriptions: vscode.Disposable[];
    private view?: vscode.WebviewView;
    private revision = 0;
    constructor(private readonly services: ModuleBrowserServices) {
        this.subscriptions = [this.watcher, this.watcher.onDidCreate(() => this.refresh()),
            this.watcher.onDidChange(() => this.refresh()), this.watcher.onDidDelete(() => this.refresh())];
    }
    refresh(): void {
        void this.updateView().catch(error => {
            void this.view?.webview.postMessage({ type: 'error', message: error instanceof Error ? error.message : 'Could not load modules.' });
        });
    }
    dispose(): void { this.revision++; this.view = undefined; this.subscriptions.forEach(value => value.dispose()); }
    resolveWebviewView(view: vscode.WebviewView): void {
        this.view = view;
        view.webview.options = { enableScripts: true, localResourceRoots: [] };
        this.subscriptions.push(view.webview.onDidReceiveMessage(message => {
            if (message?.type === 'ready') this.refresh();
            if (message?.type === 'open') void this.openModule(message).catch(error => vscode.window.showErrorMessage(String(error)));
        }), view.onDidDispose(() => { if (this.view === view) { this.view = undefined; this.revision++; } }));
        view.webview.html = moduleBrowserHtml(randomBytes(18).toString('base64'));
    }
    private async updateView(): Promise<void> {
        const view = this.view, revision = ++this.revision;
        if (!view) return;
        const definitions = await this.services.definitions();
        if (this.view !== view || revision !== this.revision) return;
        await view.webview.postMessage({ type: 'modules', roots: buildModuleBrowserTree(definitions, this.services.roots?.() ?? []) });
    }
    /** Payloads carry only identities: all source data comes from the current index. */
    async resolveSelection(payload: unknown, selected?: readonly ModuleBrowserItem[]): Promise<ModuleBrowserItem[]> {
        const value = payload && typeof payload === 'object' ? payload as Record<string, unknown> : undefined;
        let keys: unknown[];
        if (selected?.length) keys = selected.map(item => item instanceof ModuleBrowserItem ? item.definition.key : undefined);
        else if (payload instanceof ModuleBrowserItem) keys = [payload.definition.key];
        else if (typeof value?.moduleKey === 'string') {
            keys = Array.isArray(value.moduleKeys) ? value.moduleKeys : [value.moduleKey];
            if (!keys.includes(value.moduleKey)) return [];
        } else return [];
        if (!keys.length || keys.some(key => typeof key !== 'string')) return [];
        const definitions = await this.services.definitions();
        const items: ModuleBrowserItem[] = [];
        for (const key of new Set(keys)) {
            const matches = definitions.filter(definition => definition.kind === 'module' && definition.key === key);
            if (matches.length !== 1) return [];
            items.push(new ModuleBrowserItem(matches[0]));
        }
        return items;
    }
    async openModule(item: unknown): Promise<void> {
        const payload = item instanceof ModuleBrowserItem ? item : { moduleKey: (item as { moduleKey?: unknown })?.moduleKey };
        const definition = (await this.resolveSelection(payload))[0]?.definition; if (!definition) return;
        const document = await vscode.workspace.openTextDocument(vscode.Uri.parse(definition.uri));
        const position = document.positionAt(definition.declarationStart);
        await vscode.window.showTextDocument(document, { selection: new vscode.Range(position, position) });
    }
    async copyInstantiation(item: unknown): Promise<void> {
        const payload = item instanceof ModuleBrowserItem ? item : { moduleKey: (item as { moduleKey?: unknown })?.moduleKey };
        const definition = (await this.resolveSelection(payload))[0]?.definition; if (!definition) return;
        const parameters = definition.parameters.length ? ` #(\n${definition.parameters.map(parameter => `    .${parameter.name}(${parameter.defaultExpression ?? ''})`).join(',\n')}\n)` : '';
        await vscode.env.clipboard.writeText(`${definition.name}${parameters} u_${definition.name} (\n${definition.ports.map(port => `    .${port.name}()`).join(',\n')}\n);`);
    }
}
