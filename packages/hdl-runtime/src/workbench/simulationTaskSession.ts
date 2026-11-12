import { applyTaskEdit, parseSimulationTask, type SimulationTaskDocument, type TaskEdit, type TaskModuleDefinition } from '../simulationTask';
import type { PreparedSimulationTask } from '../simulationTaskWorkspace';
import type { SimulatorBackend } from '@veriflow/flow-core';
import { createInterfaceProtocolCatalog, type InterfaceProtocolCatalog } from '@veriflow/schematic-core/interfaces';
import type { WebviewCommand, HostEvent } from './protocol';
import type { WorkbenchDocumentHost, WorkbenchDocumentSnapshot } from './documentHost';
import { archDesignPresentationFromLayout } from './editorSupport';
import { projectSimulationTask } from './taskProjection';
import { relayoutAll } from './layoutStore';
import { runSimulationTask } from './simulationTaskRunner';

export type SimulationTaskExecutionState = Readonly<{
    status: 'idle' | 'running' | 'completed' | 'failed' | 'stopped';
    canOpenWave: boolean;
    error?: string;
}>;

export interface SimulationTaskSessionServices {
    documents: WorkbenchDocumentHost;
    modules?(filepath: string, task: SimulationTaskDocument): Promise<readonly TaskModuleDefinition[]>;
    interfaces?(filepath: string): Promise<InterfaceProtocolCatalog>;
    prepare(task: SimulationTaskDocument, filepath: string, signal: AbortSignal): Promise<PreparedSimulationTask>;
    backend(filepath: string): Promise<SimulatorBackend>;
    generate?(filepath: string, task: SimulationTaskDocument): Promise<void>;
    artifactDirectory?(filepath: string): string | Promise<string>;
    openWave?(filepath: string, wavePath: string): Promise<void>;
}

export class SimulationTaskSession {
    private filepath?: string;
    private snapshot?: WorkbenchDocumentSnapshot;
    private task?: SimulationTaskDocument;
    private modules: readonly TaskModuleDefinition[] = [];
    private projected?: ReturnType<typeof projectSimulationTask>;
    private viewVersion = 0;
    private wavePath?: string;
    private activeAbort?: AbortController;
    private executionState: SimulationTaskExecutionState = { status: 'idle', canOpenWave: false };
    private readonly listeners = new Set<(event: HostEvent) => void>();
    private disposed = false;

    constructor(private readonly services: SimulationTaskSessionServices) {}

    get execution(): SimulationTaskExecutionState {
        return this.executionState;
    }

    onEvent(listener: (event: HostEvent) => void): () => void {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    async open(filepath: string): Promise<void> {
        this.assertActive();
        const snapshot = await this.services.documents.readText(filepath);
        let task = parseSimulationTask(snapshot.text);
        const modules = await this.services.modules?.(filepath, task) ?? [];
        const interfaces = await (this.services.interfaces?.(filepath) ?? Promise.resolve(createInterfaceProtocolCatalog()));
        const originalTask = task;
        const projected = projectSimulationTask(task, modules, filepath, interfaces);
        task = projected.task;
        const normalizedText = `${JSON.stringify(task, null, 2)}\n`;
        const currentSnapshot = task === originalTask ? snapshot
            : await this.services.documents.replaceText(filepath, snapshot.version, normalizedText);
        this.filepath = filepath;
        this.snapshot = currentSnapshot;
        this.task = task;
        this.modules = modules;
        this.projected = projected;
        this.viewVersion++;
        this.wavePath = undefined;
        this.setExecution({ status: 'idle', canOpenWave: false });
        this.emit({ type: 'initialize', fileUri: filepath, documentKind: 'simulation-task', editable: true,
            capabilities: { addPort: false, exportRtl: false, run: true },
            modules: [{ key: projected.graph.moduleKey, name: filepath.split(/[\\/]/).pop() ?? filepath }],
            selectedModuleKey: projected.graph.moduleKey });
        this.emit({ type: 'graph', revision: currentSnapshot.version, graph: projected.graph, layout: projected.layout, fitOnFirstRender: true });
        this.emit({ type: 'diagnostics', errors: projected.projection.validation.diagnostics.length,
            warnings: projected.projection.validation.warnings.length,
            details: [...projected.projection.validation.diagnostics.map(item => ({ ...item, severity: 'error' as const })),
                ...projected.projection.validation.warnings.map(item => ({ ...item, severity: 'warning' as const }))] });
        this.emit({ type: 'simulationTaskState', revision: currentSnapshot.version, projection: projected.projection,
            task: { document: task, version: this.viewVersion, execution: this.executionState } });
    }

    async handle(command: WebviewCommand): Promise<void> {
        this.assertOpen();
        if ('revision' in command && command.revision !== this.snapshot!.version) {
            throw new Error('The task changed; retry this action.');
        }
        if (command.type === 'editSchematic') {
            await this.writeTask(applyTaskEdit(this.task!, this.modules, command.edit));
            return;
        }
        if (command.type === 'saveLayout' || command.type === 'relayoutAll') {
            if (command.moduleKey !== this.projected!.graph.moduleKey) return;
            const layout = command.type === 'saveLayout' ? command.layout
                : relayoutAll(this.projected!.graph, this.projected!.layout);
            const task = { ...this.task!, presentation: archDesignPresentationFromLayout(
                this.projected!.projection.design, this.projected!.graph, layout,
            ) };
            await this.writeTask(task);
            this.emit({ type: 'archDesignLayoutSaved', revision: this.snapshot!.version });
            return;
        }
        if (command.type === 'simulationTaskCommand') {
            const data = (command.payload ?? {}) as Record<string, unknown>;
            if (command.command === 'addPreset' || command.command === 'updatePreset' || command.command === 'updateTaskSettings') {
                await this.writeTask(applyTaskEdit(this.task!, this.modules,
                    { type: command.command, ...data } as TaskEdit));
            } else if (command.command === 'generateTestbench') {
                await this.services.generate?.(this.filepath!, this.task!);
            } else if (command.command === 'run') {
                await this.run();
            } else if (command.command === 'cancel') {
                this.cancel();
            } else if (command.command === 'openWave') {
                await this.openWave();
            }
        }
    }

    async run(signal?: AbortSignal): Promise<void> {
        this.assertOpen();
        if (this.activeAbort) throw new Error('This Simulation Task is already running.');
        const abort = new AbortController();
        this.activeAbort = abort;
        const forwardAbort = (): void => abort.abort(signal?.reason);
        if (signal?.aborted) forwardAbort();
        else signal?.addEventListener('abort', forwardAbort, { once: true });
        const runSignal = signal ? AbortSignal.any([signal, abort.signal]) : abort.signal;
        this.setExecution({ status: 'running', canOpenWave: false });
        let prepared: PreparedSimulationTask | undefined;
        try {
            prepared = await this.services.prepare(this.task!, this.filepath!, runSignal);
            runSignal.throwIfAborted();
            const backend = await this.services.backend(this.filepath!);
            const artifactDirectory = await this.services.artifactDirectory?.(this.filepath!);
            const result = await runSimulationTask(prepared, backend, {
                signal: runSignal,
                artifactDirectory,
                requireWaveform: this.task!.settings.waveform.enabled,
            });
            if (runSignal.aborted || result.cause?.code === 'ABORTED') {
                this.setExecution({ status: 'stopped', canOpenWave: false });
                return;
            }
            if (!result.success || result.exitCode !== 0) {
                const error = result.stderr || result.cause?.message || 'Simulation failed.';
                this.setExecution({ status: 'failed', canOpenWave: false, error });
                throw new Error(error);
            }
            const wave = result.artifacts.find(artifact => artifact.kind === 'vcd' && artifact.written);
            this.wavePath = wave?.destination;
            this.setExecution({ status: 'completed', canOpenWave: !!this.wavePath });
        } catch (error) {
            if (runSignal.aborted) this.setExecution({ status: 'stopped', canOpenWave: false });
            else if (this.executionState.status !== 'failed') {
                const message = error instanceof Error ? error.message : String(error);
                this.setExecution({ status: 'failed', canOpenWave: false, error: message });
            }
            if (!runSignal.aborted) throw error;
        } finally {
            signal?.removeEventListener('abort', forwardAbort);
            if (prepared) await prepared.dispose();
            if (this.activeAbort === abort) this.activeAbort = undefined;
        }
    }

    cancel(): void {
        this.activeAbort?.abort();
    }

    async openWave(): Promise<void> {
        this.assertOpen();
        if (!this.executionState.canOpenWave || !this.wavePath || !this.services.openWave) {
            throw new Error('Run this task with waveform recording enabled first.');
        }
        await this.services.openWave(this.filepath!, this.wavePath);
    }

    dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        this.cancel();
        this.listeners.clear();
    }

    private setExecution(execution: SimulationTaskExecutionState): void {
        this.executionState = execution;
        this.emit({ type: 'simulationTaskExecution', execution });
    }

    private async writeTask(task: SimulationTaskDocument): Promise<void> {
        const text = `${JSON.stringify(task, null, 2)}\n`;
        this.snapshot = await this.services.documents.replaceText(this.filepath!, this.snapshot!.version, text);
        this.task = task;
        this.viewVersion++;
        const interfaces = await (this.services.interfaces?.(this.filepath!) ?? Promise.resolve(createInterfaceProtocolCatalog()));
        this.projected = projectSimulationTask(task, this.modules, this.filepath!, interfaces);
        this.task = this.projected.task;
        this.emit({ type: 'graph', revision: this.snapshot.version, graph: this.projected.graph,
            layout: this.projected.layout, fitOnFirstRender: true });
        this.emit({ type: 'simulationTaskState', revision: this.snapshot.version,
            projection: this.projected.projection,
            task: { document: this.task, version: this.viewVersion, execution: this.executionState } });
    }

    private emit(event: HostEvent): void {
        if (!this.disposed) this.listeners.forEach(listener => listener(event));
    }

    private assertActive(): void {
        if (this.disposed) throw new Error('Simulation Task session is disposed.');
    }

    private assertOpen(): void {
        this.assertActive();
        if (!this.filepath || !this.snapshot || !this.task) throw new Error('Open a Simulation Task first.');
    }
}
