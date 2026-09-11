import { randomUUID } from 'crypto';
import type { ExtensionSettings } from './config';

export type DesignSelection = {
    definitionKey: string;
    name: string;
    uri: string;
    adUri?: string;
    interfaceSignature?: string;
};
export type TaskSettings = Partial<Pick<ExtensionSettings,
    'simulator' | 'simulatorCompileCmd' | 'simulatorRunCmd' | 'waveFileTemplate' | 'libDirs' | 'defines'>>;
export type SimulationTask = {
    id: string;
    name: string;
    entry: DesignSelection;
    design?: DesignSelection;
    settings: TaskSettings;
};
export type RunStatus = 'running' | 'completed' | 'failed' | 'cancelled';
export type WorkflowRun = {
    id: string;
    taskId?: string;
    taskName: string;
    top: string;
    startedAt: string;
    finishedAt?: string;
    status: RunStatus;
    outdated: boolean;
    files: Record<string, string>;
    settings: string;
    log?: string;
    wavePath?: string;
};
type SavedWorkflow = {
    version: 1;
    design?: DesignSelection;
    tasks: SimulationTask[];
    activeTaskId?: string;
    latestRun?: WorkflowRun;
};
function object(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}
function selection(value: unknown): value is DesignSelection {
    return object(value) && typeof value.definitionKey === 'string'
        && typeof value.name === 'string' && typeof value.uri === 'string'
        && (value.adUri === undefined || typeof value.adUri === 'string')
        && (value.interfaceSignature === undefined || typeof value.interfaceSignature === 'string');
}
function strings(value: unknown): value is Record<string, string> {
    return object(value) && Object.values(value).every(item => typeof item === 'string');
}
function task(value: unknown): value is SimulationTask {
    return object(value) && typeof value.id === 'string' && typeof value.name === 'string'
        && selection(value.entry) && (value.design === undefined || selection(value.design))
        && object(value.settings);
}
function run(value: unknown): value is WorkflowRun {
    return object(value) && typeof value.id === 'string' && typeof value.taskName === 'string'
        && typeof value.top === 'string' && typeof value.startedAt === 'string'
        && typeof value.settings === 'string' && strings(value.files)
        && typeof value.outdated === 'boolean'
        && (value.taskId === undefined || typeof value.taskId === 'string')
        && (value.finishedAt === undefined || typeof value.finishedAt === 'string')
        && ['running', 'completed', 'failed', 'cancelled'].includes(String(value.status))
        && (value.wavePath === undefined || typeof value.wavePath === 'string')
        && (value.log === undefined || typeof value.log === 'string');
}

/** Workspace-local UI state; HDL parsing and simulation remain in their existing services. */
export class WorkflowState {
    private data: SavedWorkflow;

    constructor(saved?: unknown) {
        const value = object(saved) && saved.version === 1 ? saved : {};
        this.data = {
            version: 1,
            design: selection(value.design) ? value.design : undefined,
            tasks: Array.isArray(value.tasks) ? value.tasks.filter(task) : [],
            activeTaskId: typeof value.activeTaskId === 'string' ? value.activeTaskId : undefined,
            latestRun: run(value.latestRun) ? { ...value.latestRun } : undefined,
        };
        if (this.data.latestRun?.status === 'running') {
            this.data.latestRun.status = 'cancelled';
            this.data.latestRun.log = 'The extension stopped before this run finished.';
            this.data.latestRun.wavePath = undefined;
        }
    }

    get design(): DesignSelection | undefined { return this.data.design; }
    get tasks(): readonly SimulationTask[] { return this.data.tasks; }
    get activeTask(): SimulationTask | undefined {
        return this.data.tasks.find(item => item.id === this.data.activeTaskId);
    }
    get latestRun(): WorkflowRun | undefined { return this.data.latestRun; }
    serialize(): SavedWorkflow { return JSON.parse(JSON.stringify(this.data)) as SavedWorkflow; }
    setDesign(design: DesignSelection): void { this.data.design = { ...design }; }

    addTask(name: string, entry: DesignSelection, design?: DesignSelection, settings: TaskSettings = {}): SimulationTask {
        const created: SimulationTask = {
            id: randomUUID(), name, entry: { ...entry },
            design: design ? { ...design } : undefined, settings: { ...settings },
        };
        this.data.tasks.push(created);
        this.data.activeTaskId = created.id;
        return created;
    }
    selectTask(id: string): void {
        if (!this.data.tasks.some(item => item.id === id)) throw new Error('Simulation task no longer exists.');
        this.data.activeTaskId = id;
    }
    updateTask(id: string, update: Partial<Pick<SimulationTask, 'entry' | 'design' | 'settings' | 'name'>>): void {
        const selected = this.data.tasks.find(item => item.id === id);
        if (!selected) throw new Error('Simulation task no longer exists.');
        const changed = (['entry', 'design', 'settings'] as const).some(key =>
            key in update && JSON.stringify(selected[key]) !== JSON.stringify(update[key]));
        Object.assign(selected, update);
        if (changed && this.data.latestRun?.taskId === id) this.data.latestRun.outdated = true;
    }
    removeTask(id: string): void {
        this.data.tasks = this.data.tasks.filter(item => item.id !== id);
        if (this.data.activeTaskId === id) this.data.activeTaskId = this.data.tasks[0]?.id;
    }
    beginRun(input: Pick<WorkflowRun, 'top' | 'files' | 'settings'>): WorkflowRun {
        const active = this.activeTask;
        const created: WorkflowRun = {
            id: randomUUID(), taskId: active?.id, taskName: active?.name ?? input.top,
            ...input, files: { ...input.files }, startedAt: new Date().toISOString(),
            status: 'running', outdated: false,
        };
        this.data.latestRun = created;
        return created;
    }
    finishRun(id: string, status: Exclude<RunStatus, 'running'>,
        artifacts: Pick<WorkflowRun, 'log' | 'wavePath'>): boolean {
        const latest = this.data.latestRun;
        if (latest?.id !== id) return false;
        Object.assign(latest, artifacts, { status, finishedAt: new Date().toISOString() });
        return true;
    }
    markFileChanged(filepath: string, fingerprint: string): boolean {
        const latest = this.data.latestRun;
        if (!latest || latest.files[filepath] === undefined || latest.files[filepath] === fingerprint) return false;
        latest.outdated = true;
        return true;
    }
    markSettingsChanged(settings: string): boolean {
        const latest = this.data.latestRun;
        if (!latest || latest.settings === settings) return false;
        latest.outdated = true;
        return true;
    }
}
