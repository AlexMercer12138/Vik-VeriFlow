import * as vscode from 'vscode';
import * as path from 'path';
import * as os from 'os';
import { mkdtemp, rm, writeFile, stat, lstat, readFile } from 'fs/promises';
import { createHash } from 'crypto';
import { createSimulationTask, parseSimulationTask, type SimulationTaskDocument } from '@veriflow/hdl-runtime/simulationTask';
import { createSimulationRequest, type SimulatorBackend } from '@veriflow/flow-core';
import type { PreparedSimulationTask } from '@veriflow/hdl-runtime/simulationTaskWorkspace';
import type { HdlDefinitionSummary } from '../core';
import type { InterfaceProtocolCatalog } from '@veriflow/schematic-core/interfaces';
import { SimulationRunCoordinator } from '../workbench/simulationRunCoordinator';
import { getActiveCanvas } from '../workbench/moduleTargets';
import { SimulationTaskEditorProvider, replaceTaskDocument, type TaskEditorServices, type TaskExecutionState } from './taskEditorProvider';
import * as output from '../output';
interface InputFingerprint { hash: string; taskDocument: boolean }
export interface SimulationTaskServices {
    definitions(uri: vscode.Uri): Promise<readonly HdlDefinitionSummary[]>;
    onDidInvalidate?(listener: () => void): vscode.Disposable;
    interfaces(uri: vscode.Uri): Promise<InterfaceProtocolCatalog>;
    prepare(task: SimulationTaskDocument, uri: vscode.Uri, signal?: AbortSignal): Promise<PreparedSimulationTask>;
    backend(uri: vscode.Uri): Promise<SimulatorBackend>;
    openWave(file: string, uri: vscode.Uri): Promise<void>;
    coordinator: SimulationRunCoordinator;
}
export class SimulationTaskController implements vscode.Disposable, TaskEditorServices {
    private readonly emitter = new vscode.EventEmitter<void>();
    readonly onDidChange = this.emitter.event;
    private readonly subscriptions: vscode.Disposable[] = [this.emitter];
    private readonly states = new Map<string, TaskExecutionState & { wave?: string; fingerprints?: Map<string, InputFingerprint> }>();
    private configurationRevision = 0;
    private readonly artifactDirectories = new Set<string>();
    private runningTask?: { uri: vscode.Uri; abort: AbortController };
    readonly editor: SimulationTaskEditorProvider;
    constructor(private readonly context: vscode.ExtensionContext, private readonly services: SimulationTaskServices) {
        this.editor = new SimulationTaskEditorProvider(context, this);
        const invalidate = (uri: vscode.Uri) => {
            for (const [key, state] of this.states) if (state.canOpenWave && state.fingerprints?.has(inputKey(uri.fsPath))) {
                void this.inputsUnchanged(state.fingerprints).then(unchanged => {
                    if (!unchanged && this.states.get(key) === state) {
                        this.states.set(key, { status: 'idle', canOpenWave: false, error: 'Sources changed. Run the task again to view its waveform.' });
                        this.emitter.fire();
                    }
                });
            }
        };
        const watcher = vscode.workspace.createFileSystemWatcher('**/*.{st,ad,v,sv,vh,svh}');
        this.subscriptions.push(watcher, watcher.onDidChange(invalidate), watcher.onDidCreate(invalidate), watcher.onDidDelete(invalidate),
            vscode.workspace.onDidChangeTextDocument(event => invalidate(event.document.uri)));
        const invalidation = this.services.onDidInvalidate?.(() => this.emitter.fire());
        if (invalidation) this.subscriptions.push(invalidation);
        this.subscriptions.push(vscode.workspace.onDidChangeConfiguration(event => {
            if (!event.affectsConfiguration('veriflow')) return;
            this.configurationRevision++;
            for (const [key, state] of this.states) if (state.canOpenWave) this.states.set(key, { status: 'idle', canOpenWave: false, error: 'Settings changed. Run the task again.' });
            this.emitter.fire();
        }));
        const commands: Array<[string, (...args: any[]) => unknown]> = [
            ['veriflow.newSimulationTask', () => this.create()],
            ['veriflow.openSimulationTask', (uri?: vscode.Uri) => this.open(uri)],
            ['veriflow.runSimulationTask', () => this.withActive(document => this.run(document))],
            ['veriflow.cancelSimulationTask', () => { const active = getActiveCanvas(); if (active?.kind === 'st') this.cancel(active.uri); }],
            ['veriflow.openSimulationTaskWave', () => this.withActive(document => this.openWave(document.uri))],
            ['veriflow.exportSimulationTestbench', () => this.withActive(document => this.generate(document))],
        ];
        for (const [command, handler] of commands) this.subscriptions.push(vscode.commands.registerCommand(command, async (...args: any[]) => {
            try { return await handler(...args); } catch (error) { void vscode.window.showErrorMessage(`VeriFlow: ${error instanceof Error ? error.message : String(error)}`); }
        }));
    }
    dispose(): void { this.runningTask?.abort.abort(); this.subscriptions.forEach(item => item.dispose()); for (const directory of this.artifactDirectories) void rm(directory, { recursive: true, force: true }).catch(() => {}); this.artifactDirectories.clear(); }
    definitions(uri: vscode.Uri): Promise<readonly HdlDefinitionSummary[]> { return this.services.definitions(uri); }
    interfaces(uri: vscode.Uri): Promise<InterfaceProtocolCatalog> { return this.services.interfaces(uri); }
    execution(uri: vscode.Uri): TaskExecutionState { const state = this.states.get(uri.toString()); return state ? { status: state.status, canOpenWave: state.canOpenWave, ...(state.error ? { error: state.error } : {}) } : { status: 'idle', canOpenWave: false }; }
    cancel(uri: vscode.Uri): void { this.services.coordinator.cancel({ kind: 'st', uri: uri.toString() }); }
    async open(uri?: vscode.Uri): Promise<void> { const active = uri ? undefined : getActiveCanvas(); const target = uri ?? (active?.kind === 'st' ? active.uri : undefined); if (!target) throw new Error('Open a Simulation Task from the sidebar first.'); await vscode.commands.executeCommand('vscode.openWith', target, SimulationTaskEditorProvider.viewType); }
    async files(): Promise<vscode.Uri[]> { return vscode.workspace.findFiles('**/*.st', '**/{node_modules,.git,.veriflow,.trash}/**'); }
    async create(): Promise<vscode.Uri | undefined> {
        const root = vscode.workspace.workspaceFolders?.[0]?.uri;
        if (!root) throw new Error('Open a workspace folder before creating a simulation task.');
        const uri = await vscode.window.showSaveDialog({ title: 'Create Simulation Task', defaultUri: vscode.Uri.joinPath(root, 'simulation.st'), filters: { 'Simulation Task': ['st'] } });
        if (!uri) return;
        if (path.extname(uri.fsPath).toLowerCase() !== '.st') throw new Error('Simulation task files must use the .st extension.');
        const edit = new vscode.WorkspaceEdit(); edit.createFile(uri, { overwrite: false });
        edit.insert(uri, new vscode.Position(0, 0), `${JSON.stringify(createSimulationTask(path.basename(uri.fsPath)), null, 2)}\n`);
        if (!await vscode.workspace.applyEdit(edit)) throw new Error('Could not create the simulation task.');
        const document = await vscode.workspace.openTextDocument(uri); await document.save(); await this.open(uri); return uri;
    }
    private async withActive(action: (document: vscode.TextDocument) => Promise<void>): Promise<void> {
        const active = getActiveCanvas();
        if (active?.kind !== 'st') throw new Error('Open a Simulation Task canvas first.');
        await action(await vscode.workspace.openTextDocument(active.uri));
    }
    async generate(document: vscode.TextDocument): Promise<void> {
        if (!await vscode.workspace.saveAll()) throw new Error('Save the task and its sources before generating the testbench.');
        const version = document.version, task = parseSimulationTask(document.getText());
        const prepared = await this.services.prepare(task, document.uri);
        try {
            const filename = `${path.basename(document.uri.fsPath, path.extname(document.uri.fsPath))}_tb.v`;
            const uri = vscode.Uri.file(path.join(path.dirname(document.uri.fsPath), filename));
            if (document.version !== version) throw new Error('The task changed while preparing the testbench. Generate it again.');
            if (prepared.inputFiles.some(file => inputKey(file) === inputKey(uri.fsPath))) throw new Error('The testbench cannot overwrite a source module.');
            if (vscode.workspace.textDocuments?.some(item => inputKey(item.uri.fsPath) === inputKey(uri.fsPath) && item.isDirty)) throw new Error('Save the exported testbench before generating it again.');
            const existing = await lstat(uri.fsPath).catch(error => {
                if (error.code === 'ENOENT') return undefined;
                throw error;
            });
            if (existing) {
                const marker = `// Generated Simulation Task: ${prepared.generatedTestbench.moduleName}`;
                if (!existing.isFile() || existing.isSymbolicLink()
                    || (await readFile(uri.fsPath, 'utf8')).split(/\r?\n/, 1)[0] !== marker) {
                    throw new Error(`Cannot overwrite an existing file that was not generated for this task: ${filename}`);
                }
            }
            task.settings.exportPath = filename;
            parseSimulationTask(JSON.stringify(task));
            if (existing) await vscode.workspace.fs.writeFile(uri, Buffer.from(prepared.generatedTestbench.text));
            else await writeFile(uri.fsPath, prepared.generatedTestbench.text, { flag: 'wx' });
            await replaceTaskDocument(document, task); await document.save(); this.emitter.fire();
            await vscode.window.showTextDocument(uri, { preview: true });
        } finally { await prepared.dispose(); }
    }
    async run(document: vscode.TextDocument): Promise<void> {
        if (!vscode.workspace.isTrusted) throw new Error('Trust this workspace before running HDL or external simulator commands.');
        const abort = new AbortController();
        const lease = this.services.coordinator.acquire({ kind: 'st', uri: document.uri.toString() }, () => abort.abort());
        const owner = { uri: document.uri, abort }; this.runningTask = owner;
        const key = document.uri.toString(); this.states.set(key, { status: 'running', canOpenWave: false }); this.emitter.fire();
        let publishedFailure: Error | undefined;
        try {
            output.show(true);
            output.appendInfo(`Running Simulation Task: ${document.uri.fsPath}`);
            const configurationRevision = this.configurationRevision;
            const backend = await this.services.backend(document.uri);
            if (!await vscode.workspace.saveAll()) throw new Error('Save the task and its sources before running.');
            const task = parseSimulationTask(document.getText());
            const prepared = await this.services.prepare(task, document.uri, abort.signal);
            try {
                const fingerprints = new Map(await Promise.all(prepared.inputFiles.map(async file => [inputKey(file),
                    await this.inputFingerprint(file, inputKey(file) === inputKey(document.uri.fsPath))] as const)));
                const outputDirectory = await mkdtemp(path.join(os.tmpdir(), 'veriflow-st-wave-'));
                this.artifactDirectories.add(outputDirectory);
                const generated = path.join(prepared.temporaryDirectory, `${prepared.generatedTestbench.moduleName}.v`);
                await writeFile(generated, prepared.generatedTestbench.text);
                const sources = [generated, ...prepared.additionalSources];
                const stagedFiles = new Set([...sources, ...prepared.runtimeFiles].map(inputKey));
                const includeFiles = prepared.inputFiles.filter(file => /\.(v|sv|vh|svh)$/i.test(file) && !stagedFiles.has(inputKey(file)));
                const wave = path.join(outputDirectory, path.basename(task.settings.waveform.filename));
                await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: `Simulation: ${path.basename(document.uri.fsPath)}`, cancellable: true }, async (_progress, token) => {
                    const cancellation = token.onCancellationRequested(() => abort.abort());
                    if (token.isCancellationRequested) abort.abort();
                    try {
                        const result = await backend.compileAndRun(createSimulationRequest({
                            files: sources, includeFiles,
                            includeDirs: prepared.includeDirs, defines: prepared.defines, runtimeFiles: prepared.runtimeFiles,
                            output: path.join(prepared.temporaryDirectory, 'simulation.vvp'), cwd: prepared.temporaryDirectory,
                            topModule: prepared.generatedTestbench.moduleName, signal: abort.signal,
                            artifacts: task.settings.waveform.enabled ? [{ kind: 'vcd', path: task.settings.waveform.filename, destination: wave, required: true }] : [],
                        }));
                        const log = output.appendSimulationResult(result);
                        await writeFile(path.join(outputDirectory, 'simulation.log'), log);
                        const writtenWave = result.artifacts.some(item => item.kind === 'vcd' && item.written) && await stat(wave).then(item => item.isFile()).catch(() => false);
                        if (abort.signal.aborted) this.states.set(key, { status: 'stopped', canOpenWave: false });
                        else if (!result.success) {
                            publishedFailure = new Error(result.stderr || result.cause?.message || 'Simulation failed. See VeriFlow output.');
                            throw publishedFailure;
                        }
                        else if (configurationRevision !== this.configurationRevision || !await this.inputsUnchanged(fingerprints)) this.states.set(key, { status: 'idle', canOpenWave: false, error: 'Sources changed during simulation. Run the task again.' });
                        else this.states.set(key, { status: 'completed', canOpenWave: writtenWave, ...(writtenWave ? { wave, fingerprints } : {}) });
                    } finally { cancellation.dispose(); }
                });
            } finally { await prepared.dispose(); }
            if (this.states.get(key)?.canOpenWave) {
                try { await this.openWave(document.uri); }
                catch (error) {
                    const message = `Simulation completed, but the waveform could not be opened: ${error instanceof Error ? error.message : String(error)}`;
                    output.appendError(message);
                    void vscode.window.showErrorMessage(`VeriFlow: ${message}`);
                }
            }
        } catch (error) {
            if (abort.signal.aborted) { output.appendInfo('Simulation cancelled'); this.states.set(key, { status: 'stopped', canOpenWave: false }); }
            else { const message = error instanceof Error ? error.message : String(error);
                if (!publishedFailure || error !== publishedFailure) output.appendError(message);
                this.states.set(key, { status: 'failed', canOpenWave: false, error: message }); throw error; }
        } finally { lease.release(); if (this.runningTask === owner) this.runningTask = undefined; this.emitter.fire(); }
    }
    private async inputFingerprint(file: string, taskDocument: boolean): Promise<InputFingerprint> {
        const document = vscode.workspace.textDocuments?.find(item => inputKey(item.uri.fsPath) === inputKey(file) && item.isDirty);
        let bytes: string | Buffer = document ? document.getText() : await readFile(file);
        if (taskDocument) {
            const task = parseSimulationTask(bytes.toString());
            // Canvas layout and export location do not affect the generated simulation.
            const { presentation: _presentation, settings, ...inputs } = task;
            const { exportPath: _exportPath, ...simulationSettings } = settings;
            bytes = JSON.stringify({ ...inputs, settings: simulationSettings });
        }
        return { hash: createHash('sha256').update(bytes).digest('hex'), taskDocument };
    }
    private async inputsUnchanged(inputs: ReadonlyMap<string, InputFingerprint>): Promise<boolean> {
        try { return (await Promise.all([...inputs].map(async ([file, fingerprint]) =>
            (await this.inputFingerprint(file, fingerprint.taskDocument)).hash === fingerprint.hash))).every(Boolean); }
        catch { return false; }
    }
    async openWave(uri: vscode.Uri): Promise<void> {
        const state = this.states.get(uri.toString());
        if (!state?.canOpenWave || !state.wave) throw new Error('Run this task with waveform recording enabled first.');
        if (state.fingerprints && !await this.inputsUnchanged(state.fingerprints)) { this.states.set(uri.toString(), { status: 'idle', canOpenWave: false }); this.emitter.fire(); throw new Error('Sources changed. Run the task again to view its waveform.'); }
        await this.services.openWave(state.wave, uri);
    }
}

function inputKey(file: string): string { const key = path.resolve(file); return process.platform === 'win32' ? key.toLowerCase() : key; }
