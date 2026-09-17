import * as vscode from 'vscode';
import type { DependencyResult, ModuleDefinitionEntry, ModuleScanResult } from './core';
import type { TopModuleSelection } from './config';

/** Analysis state shared by commands; sidebar providers own their own presentation. */
export class HdlAnalysisState implements vscode.Disposable {
    private readonly emitter = new vscode.EventEmitter<void>();
    readonly onDidChange = this.emitter.event;
    private selectedTop: TopModuleSelection | undefined;
    private scanResult: ModuleScanResult | null = null;
    private dependencyResult: DependencyResult | null = null;

    get topModule(): TopModuleSelection | undefined { return this.selectedTop; }

    set topModule(value: TopModuleSelection | undefined) {
        this.selectedTop = value;
        this.emitter.fire();
    }

    get analyzeResult(): DependencyResult | null { return this.dependencyResult; }

    setScanResult(result: ModuleScanResult | null): void {
        this.scanResult = result;
        this.emitter.fire();
    }

    setAnalyzeResult(result: DependencyResult | null): void {
        this.dependencyResult = result;
        this.emitter.fire();
    }

    getWorkspaceDefinitions(): ModuleDefinitionEntry[] {
        return this.scanResult?.definitions.filter(definition => definition.workspace) ?? [];
    }

    dispose(): void { this.emitter.dispose(); }
}
