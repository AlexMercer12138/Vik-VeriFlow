import * as path from 'path';
import * as vscode from 'vscode';
import type { HdlDefinitionSummary } from '../core';
import type { ModuleTargetKind } from './moduleTargets';

export interface DesignDependency {
    label: string;
    definition?: HdlDefinitionSummary;
    status?: 'ambiguous' | 'unresolved' | 'recursive';
    children: DesignDependency[];
}
export interface DesignDocumentDetails {
    dependencies: DesignDependency[];
    exportedFiles?: readonly { uri: vscode.Uri; exists: boolean }[];
    error?: string;
}
export interface DesignDocumentTreeServices {
    files(): Promise<readonly vscode.Uri[]>;
    load(uri: vscode.Uri): Promise<DesignDocumentDetails>;
}
export class DesignDocumentTreeItem extends vscode.TreeItem {
    children?: DesignDocumentTreeItem[];
}

/** AD and ST share presentation; the host resolves each document's sources and exports. */
export class DesignDocumentTreeProvider implements vscode.TreeDataProvider<DesignDocumentTreeItem>, vscode.Disposable {
    private readonly emitter = new vscode.EventEmitter<DesignDocumentTreeItem | undefined>();
    readonly onDidChangeTreeData = this.emitter.event;
    private readonly subscriptions: vscode.Disposable[];
    constructor(private readonly kind: ModuleTargetKind, private readonly services: DesignDocumentTreeServices) {
        const watcher = vscode.workspace.createFileSystemWatcher('**/*.{ad,st,v,sv,vh,svh}');
        this.subscriptions = [this.emitter, watcher, watcher.onDidCreate(() => this.refresh()),
            watcher.onDidChange(() => this.refresh()), watcher.onDidDelete(() => this.refresh())];
    }
    refresh(): void { this.emitter.fire(undefined); }
    dispose(): void { this.subscriptions.forEach(subscription => subscription.dispose()); }
    getTreeItem(item: DesignDocumentTreeItem): vscode.TreeItem { return item; }
    async getChildren(item?: DesignDocumentTreeItem): Promise<DesignDocumentTreeItem[]> {
        if (item?.children) return item.children;
        if (!item) return (await this.services.files())
            .map(uri => this.documentItem(uri))
            .sort((left, right) => String(left.tooltip).localeCompare(String(right.tooltip)));
        if (!item.resourceUri || item.contextValue !== (this.kind === 'ad' ? 'archDesignFile' : 'simulationTaskFile')) return [];
        let details: DesignDocumentDetails;
        try { details = await this.services.load(item.resourceUri); }
        catch (error) { details = { dependencies: [], error: error instanceof Error ? error.message : String(error) }; }
        const dependencies = new DesignDocumentTreeItem('Dependency tree', vscode.TreeItemCollapsibleState.Collapsed);
        dependencies.iconPath = new vscode.ThemeIcon('references');
        dependencies.children = details.error ? [new DesignDocumentTreeItem(details.error)] : details.dependencies.map(entry => this.dependencyItem(entry));
        const exports = details.exportedFiles?.length ? details.exportedFiles.map(file => this.exportItem(file))
            : [new DesignDocumentTreeItem('No exported file', vscode.TreeItemCollapsibleState.None)];
        return [dependencies, ...exports];
    }
    private documentItem(uri: vscode.Uri): DesignDocumentTreeItem {
        const relative = vscode.workspace.asRelativePath(uri, true).replace(/\\/g, '/');
        const item = new DesignDocumentTreeItem(path.posix.basename(relative), vscode.TreeItemCollapsibleState.Collapsed);
        item.id = uri.toString();
        item.resourceUri = uri;
        item.description = path.posix.dirname(relative) === '.' ? undefined : path.posix.dirname(relative);
        item.tooltip = relative;
        item.iconPath = new vscode.ThemeIcon('circuit-board');
        item.contextValue = this.kind === 'ad' ? 'archDesignFile' : 'simulationTaskFile';
        item.command = { command: 'vscode.openWith', title: this.kind === 'ad' ? 'Open Architecture Design' : 'Open Simulation Task',
            arguments: [uri, this.kind === 'ad' ? 'veriflow.archDesignEditor' : 'veriflow.simulationTask'] };
        return item;
    }
    private dependencyItem(entry: DesignDependency): DesignDocumentTreeItem {
        const item = new DesignDocumentTreeItem(entry.label, entry.children.length ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None);
        item.iconPath = new vscode.ThemeIcon('symbol-module');
        item.children = entry.children.map(child => this.dependencyItem(child));
        if (entry.definition) {
            const uri = vscode.Uri.parse(entry.definition.uri);
            item.resourceUri = uri;
            item.description = [vscode.workspace.asRelativePath(uri, true), entry.status].filter(Boolean).join(' · ');
            item.command = { command: 'vscode.open', title: 'Open dependency source', arguments: [uri] };
        } else item.description = entry.status;
        return item;
    }
    private exportItem(file: { uri: vscode.Uri; exists: boolean }): DesignDocumentTreeItem {
        const item = new DesignDocumentTreeItem(path.posix.basename(file.uri.path), vscode.TreeItemCollapsibleState.None);
        const relative = vscode.workspace.asRelativePath(file.uri, true);
        item.resourceUri = file.uri;
        item.description = file.exists ? relative : `${relative} (not generated)`;
        item.tooltip = file.uri.fsPath;
        item.iconPath = new vscode.ThemeIcon('file-code');
        item.contextValue = file.exists ? 'designExportFile' : 'designExportMissing';
        if (file.exists) item.command = { command: 'vscode.open', title: 'Open exported HDL', arguments: [file.uri] };
        return item;
    }
}
