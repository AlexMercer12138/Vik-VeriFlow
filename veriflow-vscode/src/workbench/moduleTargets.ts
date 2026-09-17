import * as vscode from 'vscode';
import type { HdlDefinitionSummary } from '../core';

export type ModuleReference = Readonly<{ uri: string; module: string; definitionKey?: string }>;
export type ModuleTargetKind = 'ad' | 'st';
export type ActiveCanvas = Readonly<{ kind: ModuleTargetKind; uri: vscode.Uri }>;

/** The active group's current custom editor is the only eligible insertion target. */
export function getActiveCanvas(): ActiveCanvas | undefined {
    const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
    if (!(input instanceof vscode.TabInputCustom)) return undefined;
    const kind = input.viewType === 'veriflow.archDesignEditor' ? 'ad'
        : input.viewType === 'veriflow.simulationTask' ? 'st' : undefined;
    return kind && input.uri.path.toLowerCase().endsWith(`.${kind}`) ? { kind, uri: input.uri } : undefined;
}

export class ActiveCanvasContext implements vscode.Disposable {
    private readonly subscriptions: vscode.Disposable[];
    constructor() {
        const update = () => { void vscode.commands.executeCommand('setContext', 'veriflow.activeCanvas', !!getActiveCanvas()); };
        this.subscriptions = [vscode.window.tabGroups.onDidChangeTabs(update), vscode.window.tabGroups.onDidChangeTabGroups(update)];
        update();
    }
    dispose(): void { this.subscriptions.forEach(subscription => subscription.dispose()); }
}

export interface ModuleTargetServices {
    definitions(): Promise<readonly HdlDefinitionSummary[]>;
    targetDefinitions(target: vscode.Uri): Promise<readonly HdlDefinitionSummary[]>;
    insert(kind: ModuleTargetKind, target: vscode.Uri, definitions: readonly HdlDefinitionSummary[], position?: { x: number; y: number }): Promise<void>;
}

export class ModuleTargetService {
    constructor(private readonly services: ModuleTargetServices) {}
    async add(references: readonly ModuleReference[], position?: { x: number; y: number }, cancellation?: { readonly isCancellationRequested: boolean }): Promise<boolean> {
        const target = getActiveCanvas();
        if (!target || !references.length || cancellation?.isCancellationRequested) return false;
        const definitions = await this.services.definitions();
        const current = getActiveCanvas();
        if (!current || current.kind !== target.kind || current.uri.toString() !== target.uri.toString() || cancellation?.isCancellationRequested) return false;
        const selected = references.map(reference => {
            const matches = definitions.filter(definition => definition.kind === 'module'
                && definition.uri === reference.uri && definition.name === reference.module
                && (reference.definitionKey === undefined || definition.key === reference.definitionKey));
            if (matches.length !== 1) throw new Error(`Module ${reference.module} in ${reference.uri} is missing or ambiguous. Refresh Module Browser and select it again.`);
            return matches[0];
        });
        const targetDefinitions = await this.services.targetDefinitions(target.uri);
        const latest = getActiveCanvas();
        if (!latest || latest.kind !== target.kind || latest.uri.toString() !== target.uri.toString() || cancellation?.isCancellationRequested) return false;
        for (const definition of selected) {
            if (!targetDefinitions.some(candidate => candidate.key === definition.key)) {
                throw new Error(`Module ${definition.name} is outside this canvas's configured sources. Add its directory to veriflow.libDirs for the workspace containing ${target.uri.path}, then try Add to Canvas again.`);
            }
        }
        await this.services.insert(target.kind, target.uri, selected, position);
        return true;
    }
}
