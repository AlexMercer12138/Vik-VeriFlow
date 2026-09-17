import { randomUUID } from 'crypto';
import type * as vscode from 'vscode';
import type { ExtensionSettings } from './config';

export interface WorkflowServices {
    settings(): ExtensionSettings;
    run(): Promise<void>;
}

/** Session guard for the existing generic simulation pipeline; it owns no task model. */
export class WorkflowController implements vscode.Disposable {
    private runningId?: string;
    constructor(_context: vscode.ExtensionContext, private readonly services: WorkflowServices) {}
    settings(): ExtensionSettings { return this.services.settings(); }
    assertIdle(): void {
        if (this.runningId) throw new Error('Wait for the current simulation, or cancel it, before changing the simulation entry.');
    }
    beginRun(_top: string, _files: readonly string[], _settings: ExtensionSettings): string {
        const id = randomUUID();
        this.runningId = id;
        return id;
    }
    async finishRun(id: string, _status: 'completed' | 'failed' | 'cancelled', _log: string, _waveFile?: string): Promise<void> {
        if (this.runningId === id) this.runningId = undefined;
    }
    dispose(): void { this.runningId = undefined; }
}
