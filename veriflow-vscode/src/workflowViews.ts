import * as vscode from 'vscode';
import * as path from 'path';
import type { ModuleTreeProvider } from './moduleTreeProvider';
import type { ArchDesignTreeProvider } from './archDesign/archDesignTreeProvider';
import type { DependencyResult } from './core';
import type { WorkflowState } from './workflowState';

export class WorkflowItem extends vscode.TreeItem {
    children?: vscode.TreeItem[];
}
function item(label: string, description?: string, command?: string, args?: unknown[], icon = 'circle-outline'): WorkflowItem {
    const value = new WorkflowItem(label, vscode.TreeItemCollapsibleState.None);
    value.description = description;
    value.iconPath = new vscode.ThemeIcon(icon);
    if (command) value.command = { command, title: label, arguments: args };
    return value;
}
function section(label: string, children: vscode.TreeItem[], expanded = false): WorkflowItem {
    const value = new WorkflowItem(label, expanded ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.Collapsed);
    value.children = children;
    return value;
}

export class WorkflowTreeProvider implements vscode.TreeDataProvider<vscode.TreeItem>, vscode.Disposable {
    private readonly emitter = new vscode.EventEmitter<vscode.TreeItem | undefined>();
    readonly onDidChangeTreeData = this.emitter.event;
    designDependencies?: DependencyResult;
    constructor(
        private readonly kind: 'design' | 'simulation' | 'results',
        private readonly state: WorkflowState,
        private readonly modules: ModuleTreeProvider,
        private readonly designs: ArchDesignTreeProvider,
        private readonly simulator: () => string,
    ) {}
    refresh(): void { this.emitter.fire(undefined); }
    dispose(): void { this.emitter.dispose(); }
    getTreeItem(element: vscode.TreeItem): vscode.TreeItem { return element; }

    async getChildren(element?: vscode.TreeItem): Promise<vscode.TreeItem[]> {
        if (element) return (element as WorkflowItem).children ?? [];
        if (this.kind === 'results') return this.results();
        const roots = await this.modules.getChildren() ?? [];
        if (this.kind === 'design') {
            const selected = this.state.design;
            const files = await this.designs.getChildren();
            return [
                item('Design top', selected?.name ?? 'Select a design', 'veriflow.selectDesign', undefined, 'symbol-module'),
                section('Graphical designs', files, true),
                ...(this.designDependencies ? [this.hierarchy(this.designDependencies)] : []),
                ...roots.filter(root => root.itemType === 'libSection' || root.itemType === 'empty'),
            ];
        }
        const task = this.state.activeTask;
        return [
            item('Current task', task?.name ?? 'Create a simulation task', 'veriflow.selectSimulationTask', undefined, 'beaker'),
            item('Design under test', task?.design?.name ?? 'Not specified', 'veriflow.setTaskDesign', undefined, 'symbol-module'),
            item('Simulation entry', task?.entry.name ?? this.modules.topModule?.name ?? 'Select a Testbench', 'veriflow.selectTop', undefined, 'symbol-keyword'),
            item('Simulator', this.simulator(), 'veriflow.configureSimulationTask', undefined, 'settings-gear'),
            ...roots.filter(root => root.itemType === 'depSection'),
            section('Saved tasks', this.state.tasks.map(saved => {
                const value = item(saved.name, saved.entry.name, 'veriflow.selectSimulationTask', [saved.id], 'beaker');
                value.contextValue = 'simulationTask';
                value.id = saved.id;
                return value;
            })),
            item('New simulation task…', undefined, 'veriflow.newSimulationTask', undefined, 'add'),
        ];
    }

    private hierarchy(result: DependencyResult): WorkflowItem {
        const build = (name: string, parents: Set<string>): WorkflowItem => {
            const file = result.moduleMap[name];
            const value = item(name, file ? path.basename(file) : 'Missing definition', file ? 'vscode.open' : undefined,
                file ? [vscode.Uri.file(file)] : undefined, 'symbol-module');
            if (!parents.has(name)) {
                const next = new Set(parents).add(name);
                const children = (result.depGraph[name] ?? []).map(child => build(child, next));
                if (children.length) {
                    value.children = children;
                    value.collapsibleState = vscode.TreeItemCollapsibleState.Expanded;
                }
            }
            return value;
        };
        return section('Design hierarchy', [build(result.topModule, new Set())], true);
    }

    private results(): vscode.TreeItem[] {
        const run = this.state.latestRun;
        if (!run) return [item('No simulation has run yet', undefined, 'veriflow.newSimulationTask', undefined, 'info')];
        const labels = { running: 'Running', completed: 'Run completed', failed: 'Run failed', cancelled: 'Run cancelled' };
        return [
            item(run.taskName, labels[run.status], undefined, undefined, run.status === 'failed' ? 'error' : 'beaker'),
            item('Simulation entry', run.top),
            item('Started', new Date(run.startedAt).toLocaleString()),
            ...(run.outdated ? [item('Results are outdated', 'Inputs changed since this run', undefined, undefined, 'warning')] : []),
            ...(run.wavePath ? [item('Open waveform', path.basename(run.wavePath), 'veriflow.openRunWave', [run.id], 'pulse')] : []),
            item('Compile and run log', undefined, 'veriflow.openRunLog', [run.id], 'output'),
        ];
    }
}
