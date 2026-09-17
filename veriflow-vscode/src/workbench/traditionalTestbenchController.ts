import * as path from 'path';
import * as vscode from 'vscode';
import type { DependencyResult, HdlDefinitionSummary } from '../core';
import type { ExtensionSettings } from '../config';
import type { SimulationService } from '../core/simulationService';
import { canonicalizeSourceUri } from '../core/hdl/preprocessor';
import { isFreshWaveform, waveIdentity } from '../workflowArtifact';
import { SimulationRunCoordinator, type SimulationRunTarget } from './simulationRunCoordinator';
import * as output from '../output';
export interface TraditionalTestbenchServices {
    definitions(): Promise<readonly HdlDefinitionSummary[]>;
    refreshDefinitions?(uri: vscode.Uri): Promise<void>;
    selectTop(definition: HdlDefinitionSummary): Promise<void>;
    dependencies(definition: HdlDefinitionSummary, settings: ExtensionSettings): Promise<DependencyResult>;
    simulation: SimulationService;
    runtimeFiles?(definition: HdlDefinitionSummary, dependencies: DependencyResult): Promise<readonly string[]>;
    waveFile?(definition: HdlDefinitionSummary, dependencies: DependencyResult, settings: ExtensionSettings): Promise<string | undefined>;
    settings(uri: vscode.Uri): ExtensionSettings;
    workspaceRoot(uri: vscode.Uri): string | undefined;
    openWave(file: string, source: vscode.Uri): Promise<void>;
}
/** Executes a selected HDL top directly, without creating a task document or wrapper. */
export class TraditionalTestbenchController implements vscode.Disposable {
    private readonly subscriptions: vscode.Disposable[] = [];
    constructor(context: vscode.ExtensionContext, private readonly services: TraditionalTestbenchServices,
        private readonly coordinator: SimulationRunCoordinator) {
        const commands: Array<[string, (...args: any[]) => unknown]> = [
            ['veriflow.runTraditionalTestbench', (target?: HdlDefinitionSummary | vscode.Uri) => this.runFromEditor(target)],
            ['veriflow.selectTraditionalTestbench', () => this.run()],
            ['veriflow.cancelTraditionalTestbench', (target: SimulationRunTarget) => this.coordinator.cancel(target)],
        ];
        for (const [name, callback] of commands) this.subscriptions.push(vscode.commands.registerCommand(name, async (...args: any[]) => {
            try { return await callback(...args); } catch (error) { void vscode.window.showErrorMessage(`VeriFlow: ${error instanceof Error ? error.message : String(error)}`); }
        }));
        context.subscriptions.push(this);
    }
    dispose(): void { this.subscriptions.forEach(item => item.dispose()); }
    async choose(): Promise<HdlDefinitionSummary | undefined> {
        const definitions = (await this.services.definitions()).filter(definition => definition.kind === 'module');
        const choices = definitions.map(definition => ({ label: definition.name, description: definition.uri, definition }));
        const choice = await vscode.window.showQuickPick([...choices, { label: 'Browse HDL File', description: '', definition: undefined }], {
            title: 'Run traditional Testbench — select HDL top', matchOnDescription: true,
        });
        if (!choice) return undefined;
        if (choice.definition) return choice.definition;
        const files = await vscode.window.showOpenDialog({ canSelectMany: false, filters: { HDL: ['v', 'sv'] } });
        const uri = files?.[0]; if (!uri) return undefined;
        await vscode.workspace.openTextDocument(uri); await this.services.refreshDefinitions?.(uri);
        const modules = await this.modulesInFile(uri);
        if (!modules.length) throw new Error('No indexed module definition was found in this file.');
        if (modules.length === 1) return modules[0];
        return (await vscode.window.showQuickPick(modules.map(definition => ({ label: definition.name, description: definition.key, definition })), { title: 'Select HDL top in this file' }))?.definition;
    }
    async runFromEditor(target?: HdlDefinitionSummary | vscode.Uri): Promise<void> {
        if (target && 'kind' in target) { await this.run(target); return; }
        const uri = target ?? vscode.window.activeTextEditor?.document.uri;
        if (!uri || !/\.(v|sv)$/i.test(uri.path)) { await this.run(); return; }
        if (!await vscode.workspace.saveAll()) throw new Error('Save HDL sources before running.');
        await this.services.refreshDefinitions?.(uri);
        const definitions = await this.modulesInFile(uri);
        if (!definitions.length) throw new Error('No indexed module definition was found in this file.');
        const instantiated = new Set(definitions.flatMap(item => item.dependencies));
        const roots = definitions.filter(item => !instantiated.has(item.name));
        const candidates = roots.length ? roots : definitions;
        const selected = candidates.length === 1 ? candidates[0] : (await vscode.window.showQuickPick(candidates.map(item => ({ label: item.name, description: item.key, definition: item })), { title: 'Select Testbench top in current HDL file' }))?.definition;
        if (selected) await this.run(selected);
    }
    private async modulesInFile(uri: vscode.Uri): Promise<readonly HdlDefinitionSummary[]> {
        const sourceUri = canonicalizeSourceUri(uri.toString());
        return (await this.services.definitions()).filter(item => item.kind === 'module'
            && canonicalizeSourceUri(vscode.Uri.parse(item.uri).toString()) === sourceUri);
    }
    async run(definition?: HdlDefinitionSummary): Promise<void> {
        definition ??= await this.choose(); if (!definition) return;
        const source = vscode.Uri.parse(definition.uri);
        const target: SimulationRunTarget = { kind: 'testbench', uri: definition.uri, module: definition.name };
        const cancellation = new vscode.CancellationTokenSource();
        const lease = this.coordinator.acquire(target, () => cancellation.cancel());
        try {
            output.show(true);
            output.appendInfo(`Running Testbench: ${definition.name} (${source.fsPath})`);
            if (!await vscode.workspace.saveAll()) throw new Error('Save HDL sources before running.');
            await this.services.refreshDefinitions?.(source);
            const matches = (await this.services.definitions()).filter(item => item.kind === 'module' && item.uri === definition!.uri && item.name === definition!.name);
            const current = matches.length === 1 ? matches[0] : undefined;
            if (!current) throw new Error('The selected HDL top changed or disappeared. Select it again.');
            const settings = this.services.settings(source);
            if (!['builtin', 'custom'].includes(settings.simulator)) throw new Error('Choose builtin or custom in the VeriFlow simulator settings.');
            const root = this.services.workspaceRoot(source); if (!root) throw new Error('Open a workspace folder for this Testbench.');
            if (cancellation.token.isCancellationRequested) { output.appendInfo('Simulation cancelled.'); return; }
            await this.services.selectTop(current);
            const dependencies = await this.services.dependencies(current, settings);
            if (dependencies.missingModules.length || Object.keys(dependencies.ambiguousModules).length) throw new Error(`Unresolved HDL dependencies: ${[...dependencies.missingModules, ...Object.keys(dependencies.ambiguousModules)].join(', ')}`);
            if (cancellation.token.isCancellationRequested) { output.appendInfo('Simulation cancelled.'); return; }
            const waveFile = await this.services.waveFile?.(current, dependencies, settings)
                ?? path.resolve(root, settings.waveFileTemplate.replace(/\{top_module\}/g, current.name));
            const before = waveIdentity(waveFile);
            const runtimeFiles = await this.services.runtimeFiles?.(current, dependencies) ?? [];
            const outcome = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: `Testbench: ${current.name}`, cancellable: true }, async (_progress, token) => {
                const listener = token.onCancellationRequested(() => cancellation.cancel());
                if (token.isCancellationRequested) cancellation.cancel();
                try { return await this.services.simulation.run({ backendId: settings.simulator, workspaceRoot: root, topModule: current.name,
                    files: dependencies.files, runtimeFiles, libDirs: settings.libDirs, defines: settings.defines, waveFile,
                    simulatorCompileCmd: settings.simulatorCompileCmd, simulatorRunCmd: settings.simulatorRunCmd }, cancellation.token);
                } finally { listener.dispose(); }
            });
            const result = outcome.execution;
            output.appendSimulationResult(result);
            if (result.success && isFreshWaveform(settings.simulator, result.artifacts, waveFile, before, waveIdentity(waveFile))) {
                await this.services.openWave(waveFile, source);
            }
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            if (cancellation.token.isCancellationRequested) output.appendInfo(message);
            else output.appendError(message);
            throw error;
        } finally { cancellation.dispose(); lease.release(); }
    }
}
