import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { parseArchDesignText } from '@veriflow/schematic-core/arch-design';
import { exportArchDesignToFile } from './archDesign/archDesignExport';
import type { WorkspaceInterfaceProtocolLoader } from './archDesign/interfaceProtocolLoader';
import type { ModuleTreeProvider } from './moduleTreeProvider';
import type { ArchDesignTreeProvider } from './archDesign/archDesignTreeProvider';
import type { HdlDefinitionSummary, DependencyResult } from './core';
import type { ExtensionSettings, TopModuleSelection } from './config';
import { WorkflowState, DesignSelection, TaskSettings, RunStatus } from './workflowState';
import { WorkflowTreeProvider } from './workflowViews';

export type WorkflowServices = {
    scan(): Promise<void>;
    definitions(): readonly HdlDefinitionSummary[];
    entryDefinitions?(): readonly HdlDefinitionSummary[];
    settings(): ExtensionSettings;
    selectEntry(entry: TopModuleSelection): Promise<void>;
    run(): Promise<void>;
    analyze(): Promise<void>;
    analyzeDesign(key: string, settings?: ExtensionSettings): Promise<DependencyResult>;
    openWave(filepath: string): Promise<void>;
    openGenerator(key?: string): void;
    protocols: WorkspaceInterfaceProtocolLoader;
};
function fingerprint(text: string | Buffer): string {
    return crypto.createHash('sha256').update(text).digest('hex');
}
function fileFingerprint(filepath: string): string {
    try { return fingerprint(fs.readFileSync(filepath)); } catch { return ''; }
}
function settingsSignature(settings: ExtensionSettings): string {
    return JSON.stringify({ libDirs: settings.libDirs, defines: settings.defines,
        simulator: settings.simulator, simulatorCompileCmd: settings.simulatorCompileCmd,
        simulatorRunCmd: settings.simulatorRunCmd, waveFileTemplate: settings.waveFileTemplate });
}
function interfaceSignature(definition: HdlDefinitionSummary): string {
    return JSON.stringify({ ports: definition.ports, parameters: definition.parameters });
}
function asSelection(definition: HdlDefinitionSummary): DesignSelection {
    return { definitionKey: definition.key, name: definition.name, uri: definition.uri,
        interfaceSignature: interfaceSignature(definition) };
}
function uriFrom(value: unknown): vscode.Uri | undefined {
    if (value instanceof vscode.Uri) return value;
    if (value && typeof value === 'object') {
        const item = value as { resourceUri?: vscode.Uri; fileUri?: string; filePath?: string };
        return item.resourceUri ?? (item.fileUri ? vscode.Uri.parse(item.fileUri)
            : item.filePath ? vscode.Uri.file(item.filePath) : undefined);
    }
    return undefined;
}

export class WorkflowController implements vscode.Disposable {
    readonly state: WorkflowState;
    readonly designView: WorkflowTreeProvider;
    readonly simulationView: WorkflowTreeProvider;
    readonly resultsView: WorkflowTreeProvider;
    private readonly subscriptions: vscode.Disposable[] = [];
    private runWatchers: vscode.Disposable[] = [];
    private persistTail: Promise<void> = Promise.resolve();
    private disposed = false;
    private busy = false;
    private designRevision = 0;
    private generatorDesign?: DesignSelection;
    private synchronizingEntry = false;

    constructor(private readonly context: vscode.ExtensionContext,
        private readonly services: WorkflowServices,
        private readonly modules: ModuleTreeProvider, designs: ArchDesignTreeProvider) {
        this.state = new WorkflowState(context.workspaceState.get('veriflow.workflow'));
        this.designView = new WorkflowTreeProvider('design', this.state, modules, designs, () => this.settings().simulator);
        this.simulationView = new WorkflowTreeProvider('simulation', this.state, modules, designs, () => this.settings().simulator);
        this.resultsView = new WorkflowTreeProvider('results', this.state, modules, designs, () => this.settings().simulator);
        this.subscriptions.push(this.designView, this.simulationView, this.resultsView,
            modules.onDidChangeTreeData(() => this.refresh()),
            designs.onDidChangeTreeData(() => this.designView.refresh()),
            vscode.workspace.onDidChangeTextDocument(event => {
                if (!event.contentChanges.length) return;
                if (this.state.markFileChanged(event.document.uri.fsPath, fingerprint(event.document.getText()))) this.save();
            }),
            vscode.workspace.onDidChangeConfiguration(event => {
                if (event.affectsConfiguration('veriflow')) {
                    if (this.state.markSettingsChanged(this.runSettingsSignature())) this.save();
                    this.refresh();
                }
            }));
        const commands: Array<[string, (...args: unknown[]) => unknown]> = [
            ['veriflow.selectDesign', value => this.selectDesign(value)],
            ['veriflow.analyzeDesign', () => this.analyzeDesign()],
            ['veriflow.newSimulationTask', value => this.newTask(value)],
            ['veriflow.generateTestbench', () => this.newTask(undefined, true)],
            ['veriflow.selectSimulationTask', value => this.selectTask(typeof value === 'string' ? value : undefined)],
            ['veriflow.configureSimulationTask', () => this.configureTask()],
            ['veriflow.setTaskDesign', () => this.setTaskDesign()],
            ['veriflow.removeSimulationTask', value => this.removeTask(value)],
            ['veriflow.runSimulationTask', () => this.runTask()],
            ['veriflow.analyzeSimulationTask', () => this.analyzeTask()],
            ['veriflow.openRunWave', id => this.openWave(id)],
            ['veriflow.openRunLog', id => this.openLog(id)],
        ];
        for (const [name, callback] of commands) this.subscriptions.push(vscode.commands.registerCommand(name,
            async (...args: unknown[]) => {
                try { await callback(...args); }
                catch (error) { await vscode.window.showErrorMessage(`VeriFlow: ${error instanceof Error ? error.message : String(error)}`); }
            }));
        this.watchRunInputs();
        if (this.state.markSettingsChanged(this.runSettingsSignature())) this.save();
    }
    private runSettingsSignature(): string {
        const task = this.state.tasks.find(item => item.id === this.state.latestRun?.taskId);
        return settingsSignature({ ...this.services.settings(), ...task?.settings });
    }
    settings(): ExtensionSettings {
        return { ...this.services.settings(), ...this.state.activeTask?.settings };
    }
    refresh(): void {
        if (this.disposed) return;
        this.designView.refresh(); this.simulationView.refresh(); this.resultsView.refresh();
    }
    private save(): void {
        if (this.disposed) return;
        const snapshot = this.state.serialize();
        this.persistTail = this.persistTail.then(() => this.context.workspaceState.update('veriflow.workflow', snapshot))
            .catch(error => { void vscode.window.showErrorMessage(`Unable to save VeriFlow tasks: ${String(error)}`); });
        this.refresh();
    }
    assertIdle(): void {
        if (this.busy || this.synchronizingEntry || this.state.latestRun?.status === 'running') throw new Error('Wait for the current simulation, or cancel it, before changing tasks.');
    }
    private find(selection: DesignSelection): HdlDefinitionSummary | undefined {
        const all = this.services.definitions();
        return all.find(item => item.key === selection.definitionKey && item.uri === selection.uri && item.name === selection.name)
            ?? all.find(item => item.name === selection.name && item.uri === selection.uri);
    }
    private async pickModule(title: string, entryOnly = false): Promise<DesignSelection | undefined> {
        await this.services.scan();
        if (this.disposed) return;
        const definitions = entryOnly ? this.services.entryDefinitions?.() ?? this.services.definitions() : this.services.definitions();
        const picked = await vscode.window.showQuickPick(definitions.map(definition => ({
            label: definition.name, description: vscode.workspace.asRelativePath(vscode.Uri.parse(definition.uri)), definition,
        })), { title, matchOnDescription: true });
        return picked && asSelection(picked.definition);
    }
    async selectDesign(value?: unknown): Promise<DesignSelection | undefined> {
        let selected: DesignSelection | undefined;
        const uri = uriFrom(value);
        if (uri && path.extname(uri.fsPath).toLowerCase() === '.ad') {
            const doc = await vscode.workspace.openTextDocument(uri);
            const parsed = parseArchDesignText(doc.getText());
            if (parsed.status !== 'editable') throw new Error('This graphical design cannot be edited.');
            selected = { definitionKey: '', name: parsed.design.module, uri: uri.toString(), adUri: uri.toString() };
        } else if (uri) {
            await this.services.scan();
            const candidate = value as { moduleName?: string };
            const matches = this.services.definitions().filter(item => item.uri === uri.toString()
                && (!candidate.moduleName || item.name === candidate.moduleName));
            if (matches.length === 1) selected = asSelection(matches[0]);
            else selected = await this.pickModule('Select design top');
        } else selected = await this.pickModule('Select design top');
        if (!selected || this.disposed) return;
        this.state.setDesign(selected);
        this.designRevision++;
        this.designView.designDependencies = undefined;
        this.save();
        if (!selected.adUri) await this.analyzeDesign();
        return selected;
    }
    async analyzeDesign(): Promise<void> {
        const selected = this.state.design;
        if (!selected) { await this.selectDesign(); return; }
        const version = this.designRevision;
        const prepared = await this.prepareDesign(selected);
        const result = await this.services.analyzeDesign(prepared.definitionKey);
        if (this.disposed || version !== this.designRevision) return;
        this.state.setDesign(prepared);
        this.designView.designDependencies = result;
        this.save();
    }
    private async prepareDesign(selected: DesignSelection): Promise<DesignSelection> {
        if (!selected.adUri) {
            await this.services.scan();
            const definition = this.find(selected);
            if (!definition) throw new Error(`Design ${selected.name} is missing. Select its current definition.`);
            return asSelection(definition);
        }
        const uri = vscode.Uri.parse(selected.adUri);
        const doc = await vscode.workspace.openTextDocument(uri);
        if (doc.isDirty && !await doc.save()) throw new Error('Save the graphical design before simulating.');
        const parsed = parseArchDesignText(doc.getText());
        if (parsed.status !== 'editable') throw new Error('The graphical design is invalid.');
        await this.services.scan();
        const protocols = await this.services.protocols.load(uri.toString());
        const result = await exportArchDesignToFile(uri.fsPath, parsed.design, this.services.definitions(), { interfaceCatalog: protocols.catalog });
        if (result.status !== 'published') throw new Error(`Fix ${result.diagnostics.length} graphical design error(s) before simulating.`);
        await this.services.scan();
        const outputUri = vscode.Uri.file(result.outputPath).toString();
        const definition = this.services.definitions().find(item => item.uri === outputUri && item.name === parsed.design.module);
        if (!definition) throw new Error('Generated RTL is not in the module index. Check the output path and library directories.');
        return { ...asSelection(definition), adUri: selected.adUri };
    }
    async newTask(value?: unknown, generate = false): Promise<void> {
        this.assertIdle();
        if (value) await this.selectDesign(value);
        const choice = generate ? 'Generate Testbench for current design' : await vscode.window.showQuickPick([
            'Use existing Testbench', 'Generate Testbench for current design',
        ], { title: 'New simulation task' });
        if (!choice) return;
        if (choice.startsWith('Generate')) {
            let selected = this.state.design ?? await this.selectDesign();
            if (!selected) return;
            selected = await this.prepareDesign(selected);
            this.assertIdle();
            this.state.setDesign(selected); this.save();
            this.generatorDesign = { ...selected };
            this.services.openGenerator(selected.definitionKey);
            return;
        }
        const entry = await this.pickModule('Select simulation entry (Testbench)', true);
        if (!entry) return;
        const name = await vscode.window.showInputBox({ title: 'Simulation task name', value: entry.name, validateInput: value => value.trim() ? undefined : 'Enter a name.' });
        if (!name?.trim()) return;
        this.assertIdle();
        await this.synchronizeEntry(entry);
        this.state.addTask(name.trim(), entry, this.state.design);
        this.save();
    }
    async generated(result: { name: string; filepath: string; waveFile: string; definitionKeys: string[]; runAfterGenerate: boolean }): Promise<void> {
        this.assertIdle();
        const uri = vscode.Uri.file(result.filepath).toString();
        const definition = this.services.definitions().find(item => item.uri === uri && item.name === result.name);
        if (!definition) throw new Error('Testbench generated, but its module is not indexed. Add its output directory to VeriFlow library directories.');
        const current = this.generatorDesign;
        const designKey = current && result.definitionKeys.includes(current.definitionKey)
            ? current.definitionKey : result.definitionKeys.length === 1 ? result.definitionKeys[0] : undefined;
        const dut = this.services.definitions().find(item => item.key === designKey);
        const design = dut ? { ...asSelection(dut), ...(current?.definitionKey === dut.key ? { adUri: current.adUri } : {}) } : undefined;
        const entry = asSelection(definition);
        await this.synchronizeEntry(entry);
        this.state.addTask(result.name, entry, design, { waveFileTemplate: result.waveFile });
        this.save();
        if (result.runAfterGenerate) await this.runTask();
    }
    async selectTask(id?: string): Promise<void> {
        this.assertIdle();
        if (!this.state.tasks.length) { await this.newTask(); return; }
        const selected = id ?? (await vscode.window.showQuickPick(this.state.tasks.map(task => ({ label: task.name, description: task.entry.name, id: task.id })), { title: 'Select simulation task' }))?.id;
        if (!selected) return;
        this.assertIdle();
        const task = this.state.tasks.find(item => item.id === selected);
        if (!task) return;
        const entry = await this.resolveEntry(task.entry);
        this.assertIdle();
        await this.synchronizeEntry(entry);
        if (JSON.stringify(task.entry) !== JSON.stringify(entry)) this.state.updateTask(task.id, { entry });
        this.state.selectTask(selected);
        this.save();
    }
    entrySelected(entry: TopModuleSelection): void {
        if (this.synchronizingEntry) return;
        const definition = this.services.definitions().find(item => item.key === entry.definitionKey);
        if (!definition) return;
        const active = this.state.activeTask;
        if (active?.entry.definitionKey === entry.definitionKey) { this.refresh(); return; }
        if (active) this.state.updateTask(active.id, { entry: asSelection(definition) });
        else this.state.addTask(entry.name, asSelection(definition), this.state.design);
        this.save();
    }
    private async setTaskDesign(): Promise<void> {
        this.assertIdle();
        const task = this.state.activeTask;
        if (!task) { await this.newTask(); return; }
        const selected = await this.selectDesign();
        this.assertIdle();
        if (selected) { this.state.updateTask(task.id, { design: selected }); this.save(); }
    }
    private async configureTask(): Promise<void> {
        this.assertIdle();
        const task = this.state.activeTask;
        if (!task) { await this.newTask(); return; }
        const action = await vscode.window.showQuickPick(['Rename task', 'Simulator', 'Waveform path', 'Use workspace defaults'], { title: `Configure ${task.name}` });
        if (!action) return;
        let settings: TaskSettings = { ...task.settings };
        if (action === 'Rename task') {
            const name = await vscode.window.showInputBox({ title: 'Task name', value: task.name });
            this.assertIdle();
            if (name?.trim()) this.state.updateTask(task.id, { name: name.trim() });
        } else if (action === 'Simulator') {
            const simulator = await vscode.window.showQuickPick(['builtin', 'custom'], { title: 'Simulation backend' });
            if (!simulator) return;
            settings.simulator = simulator;
            if (simulator === 'custom') {
                const compile = await vscode.window.showInputBox({ title: 'Compile command ({files}, {output}, {top_module})', value: this.settings().simulatorCompileCmd });
                if (compile === undefined) return;
                const run = await vscode.window.showInputBox({ title: 'Run command ({output})', value: this.settings().simulatorRunCmd });
                if (run === undefined) return;
                settings = { ...settings, simulatorCompileCmd: compile, simulatorRunCmd: run };
            }
            this.assertIdle();
            this.state.updateTask(task.id, { settings });
        } else if (action === 'Waveform path') {
            const wave = await vscode.window.showInputBox({ title: 'Waveform path (must match the Testbench dump file)', value: this.settings().waveFileTemplate });
            this.assertIdle();
            if (wave?.trim()) this.state.updateTask(task.id, { settings: { ...settings, waveFileTemplate: wave.trim() } });
        } else { this.assertIdle(); this.state.updateTask(task.id, { settings: {} }); }
        this.save();
    }
    private async removeTask(value: unknown): Promise<void> {
        this.assertIdle();
        const id = typeof value === 'string' ? value : (value as { id?: string } | undefined)?.id;
        if (!id) return;
        const next = this.state.tasks.find(task => task.id !== id);
        if (this.state.activeTask?.id === id && next) {
            const entry = await this.resolveEntry(next.entry);
            this.assertIdle();
            await this.synchronizeEntry(entry);
            if (JSON.stringify(next.entry) !== JSON.stringify(entry)) this.state.updateTask(next.id, { entry });
        }
        this.state.removeTask(id);
        this.save();
    }
    private async prepareTask(): Promise<boolean> {
        const task = this.state.activeTask;
        if (!task) return true;
        if (task.design) {
            const prepared = await this.prepareDesign(task.design);
            if (task.design.interfaceSignature && task.design.interfaceSignature !== prepared.interfaceSignature) {
                const choice = await vscode.window.showWarningMessage('The design ports or parameters changed. Check the Testbench before running.', 'Open Testbench', 'Run anyway');
                if (choice !== 'Run anyway') {
                    if (choice === 'Open Testbench') await vscode.window.showTextDocument(vscode.Uri.parse(task.entry.uri));
                    return false;
                }
            }
            if (JSON.stringify(task.design) !== JSON.stringify(prepared)) this.state.updateTask(task.id, { design: prepared });
        }
        const entry = await this.resolveEntry(task.entry);
        if (task.design) {
            const dependencies = await this.services.analyzeDesign(entry.definitionKey, this.settings());
            const source = dependencies.moduleMap[task.design.name];
            const expected = vscode.Uri.parse(task.design.uri).fsPath;
            const actual = source && (/^[A-Za-z][A-Za-z0-9+.-]*:\/\//.test(source) ? vscode.Uri.parse(source).fsPath : source);
            const normalize = (file: string): string => process.platform === 'win32' ? path.resolve(file).toLowerCase() : path.resolve(file);
            if (!actual || normalize(actual) !== normalize(expected)) {
                throw new Error(`Testbench ${entry.name} does not instantiate the selected design ${task.design.name}. Update the Testbench or choose its actual design under test.`);
            }
        }
        await this.synchronizeEntry(entry);
        if (JSON.stringify(task.entry) !== JSON.stringify(entry)) this.state.updateTask(task.id, { entry });
        this.save();
        return true;
    }
    private async ensureTask(): Promise<boolean> {
        if (this.state.activeTask) return true;
        await this.services.scan();
        this.assertIdle();
        if (this.modules.topModule) this.entrySelected(this.modules.topModule);
        if (!this.state.activeTask) await this.selectSimulationEntry();
        return !!this.state.activeTask;
    }
    private async resolveEntry(selected: DesignSelection): Promise<DesignSelection> {
        await this.services.scan();
        const definition = this.find(selected);
        if (!definition) throw new Error(`Simulation entry ${selected.name} is missing. Select its current definition.`);
        return asSelection(definition);
    }
    async runTask(): Promise<void> {
        this.assertIdle();
        if (!await this.ensureTask()) return;
        this.assertIdle(); this.busy = true;
        try {
            if (!await vscode.workspace.saveAll(false)) return;
            if (await this.prepareTask()) await this.services.run();
        } catch (error) {
            const task = this.state.activeTask;
            if (task && !this.disposed) {
                const id = this.beginRun(task.entry.name, [vscode.Uri.parse(task.entry.uri).fsPath], this.settings());
                await this.finishRun(id, 'failed', error instanceof Error ? error.message : String(error));
            }
            throw error;
        } finally { this.busy = false; }
    }
    async selectSimulationEntry(): Promise<void> {
        this.assertIdle();
        const selected = await this.pickModule('Select simulation entry / Testbench', true);
        if (!selected) return;
        this.assertIdle();
        await this.synchronizeEntry(selected);
        this.entrySelected(selected);
    }
    async analyzeTask(): Promise<void> {
        this.assertIdle();
        if (!await this.ensureTask()) return;
        this.assertIdle(); this.busy = true;
        try { if (await this.prepareTask()) await this.services.analyze(); }
        finally { this.busy = false; }
    }
    private async synchronizeEntry(entry: TopModuleSelection): Promise<void> {
        this.synchronizingEntry = true;
        try {
            await this.services.selectEntry(entry);
            if (this.disposed || this.modules.topModule?.definitionKey !== entry.definitionKey) throw new Error('Simulation entry changed while preparing this task. Select the task again.');
        } finally { this.synchronizingEntry = false; }
    }
    async openLatestWave(): Promise<void> {
        this.assertIdle();
        const latest = this.state.latestRun;
        if (latest?.wavePath) { await this.openWave(latest.id); return; }
        await this.runTask();
        const completed = this.state.latestRun;
        if (completed?.wavePath) await this.openWave(completed.id);
        else await vscode.window.showInformationMessage('This run did not produce a waveform. Check the Testbench dump file and task waveform path.');
    }
    beginRun(top: string, files: string[], settings: ExtensionSettings): string {
        const allFiles = [...files];
        const design = this.state.activeTask?.design;
        if (design?.adUri) allFiles.push(vscode.Uri.parse(design.adUri).fsPath);
        const run = this.state.beginRun({ top, files: Object.fromEntries(allFiles.map(file => [file, fileFingerprint(file)])), settings: settingsSignature(settings) });
        this.watchRunInputs(); this.save();
        return run.id;
    }
    async finishRun(id: string, status: Exclude<RunStatus, 'running'>, log: string, waveFile?: string): Promise<void> {
        let wavePath: string | undefined;
        if (status === 'completed' && waveFile) {
            try {
                const directory = path.join(this.context.storageUri!.fsPath, 'runs', id);
                await fs.promises.mkdir(directory, { recursive: true });
                const destination = path.join(directory, path.basename(waveFile));
                await fs.promises.copyFile(waveFile, destination, fs.constants.COPYFILE_EXCL);
                wavePath = destination;
            } catch (error) {
                log += `\nWaveform snapshot unavailable: ${error instanceof Error ? error.message : String(error)}`;
            }
        }
        if (!this.disposed && this.state.finishRun(id, status, { log, wavePath })) this.save();
    }
    private watchRunInputs(): void {
        for (const watcher of this.runWatchers) watcher.dispose();
        this.runWatchers = [];
        for (const file of Object.keys(this.state.latestRun?.files ?? {})) {
            const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(path.dirname(file), path.basename(file).replace(/([*?{}[\]])/g, '[$1]')));
            const changed = (): void => { if (this.state.markFileChanged(file, fileFingerprint(file))) this.save(); };
            this.runWatchers.push(watcher, watcher.onDidChange(changed), watcher.onDidDelete(changed), watcher.onDidCreate(changed));
            changed();
        }
    }
    private async openWave(id: unknown): Promise<void> {
        const run = this.state.latestRun;
        if (!run?.wavePath || run.id !== id) return;
        await this.services.openWave(run.wavePath);
    }
    private async openLog(id: unknown): Promise<void> {
        const run = this.state.latestRun;
        if (!run || run.id !== id) return;
        const doc = await vscode.workspace.openTextDocument({ content: `${run.taskName} — ${run.top}\n${run.startedAt} — ${run.status}\n\n${run.log ?? 'Run is in progress.'}`, language: 'log' });
        await vscode.window.showTextDocument(doc, { preview: true });
    }
    dispose(): void {
        this.disposed = true;
        for (const disposable of [...this.subscriptions, ...this.runWatchers]) disposable.dispose();
    }
}
