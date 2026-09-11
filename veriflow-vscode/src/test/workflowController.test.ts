import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import Module = require('module');
import { pathToFileURL, fileURLToPath } from 'url';
import type { WorkflowController } from '../workflowController';
import type { HdlDefinitionSummary } from '../core';

class Emitter<T> {
    private listeners = new Set<(value: T) => void>();
    event = (listener: (value: T) => void) => { this.listeners.add(listener); return { dispose: () => this.listeners.delete(listener) }; };
    fire(value: T): void { for (const listener of this.listeners) listener(value); }
    dispose(): void { this.listeners.clear(); }
}
class Uri {
    constructor(readonly fsPath: string) {}
    static file(file: string): Uri { return new Uri(file); }
    static parse(value: string): Uri { return new Uri(fileURLToPath(value)); }
    toString(): string { return pathToFileURL(this.fsPath).toString(); }
}
class TreeItem {
    constructor(readonly label: string, public collapsibleState = 0) {}
}
async function main(): Promise<void> {
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'veriflow-workflow-'));
    const dutPath = path.join(temp, 'soc.v');
    const tbPath = path.join(temp, 'tb_soc.v');
    fs.writeFileSync(dutPath, 'module soc; endmodule');
    fs.writeFileSync(tbPath, 'module tb_soc; endmodule');
    const definition = (name: string, file: string): HdlDefinitionSummary => ({
        name, key: name, uri: Uri.file(file).toString(), kind: 'module', declarationStart: 0,
        declarationLine: 1, parameters: [], ports: [], dependencies: [], modelFingerprint: name,
    });
    const defs = [definition('soc', dutPath), definition('tb_soc', tbPath)];
    const changes = new Emitter<any>();
    const configChanges = new Emitter<any>();
    const commands = new Map<string, (...args: any[]) => unknown>();
    const opened: any[] = [];
    const queue: any[] = [];
    const events: string[] = [];
    let persisted: any;
    let generatorKey: string | undefined;
    let runCount = 0;
    let exportValid = true;
    let includesDut = true;
    const disposable = { dispose(): void {} };
    const vscode = {
        Uri, TreeItem, EventEmitter: Emitter,
        ThemeIcon: class { constructor(readonly id: string) {} },
        TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 },
        RelativePattern: class {},
        commands: {
            registerCommand: (id: string, callback: (...args: any[]) => unknown) => { commands.set(id, callback); return disposable; },
            executeCommand: async (...args: any[]) => { opened.push(args); },
        },
        workspace: {
            asRelativePath: (uri: Uri) => path.basename(uri.fsPath),
            onDidChangeTextDocument: changes.event,
            onDidChangeConfiguration: configChanges.event,
            createFileSystemWatcher: () => ({ ...disposable, onDidCreate: () => disposable, onDidChange: () => disposable, onDidDelete: () => disposable }),
            openTextDocument: async (value: any) => value instanceof Uri
                ? { isDirty: false, getText: () => fs.readFileSync(value.fsPath, 'utf8') }
                : value,
            saveAll: async () => true,
        },
        window: {
            showQuickPick: async (choices: any[]) => { const answer = queue.shift(); return typeof answer === 'number' ? choices[answer] : answer; },
            showInputBox: async () => queue.shift(),
            showWarningMessage: async () => queue.shift(),
            showErrorMessage: async (message: string) => { throw new Error(message); },
            showTextDocument: async (doc: any) => { opened.push(doc); },
        },
    };
    const loader = Module as typeof Module & { _load: (...args: any[]) => any };
    const original = loader._load;
    loader._load = function(request: string, ...args: any[]): any {
        if (request === 'vscode') return vscode;
        if (request === './archDesign/archDesignExport') return { exportArchDesignToFile: async () => {
            events.push('export');
            return exportValid ? { status: 'published', outputPath: dutPath } : { status: 'invalid', diagnostics: [{}] };
        } };
        if (request === '@veriflow/schematic-core/arch-design') return { parseArchDesignText: () => ({ status: 'editable', design: { module: 'soc' } }) };
        return original.call(this, request, ...args);
    };
    let controller: WorkflowController | undefined;
    try {
        const { WorkflowController: Controller } = require('../workflowController') as typeof import('../workflowController');
        const moduleEvents = new Emitter<any>();
        const modules: any = { onDidChangeTreeData: moduleEvents.event, topModule: undefined,
            getChildren: () => [{ itemType: 'libSection', label: 'Module library', children: [] }, { itemType: 'depSection', label: 'Dependency tree', children: [] }] };
        const designs: any = { onDidChangeTreeData: new Emitter<any>().event, getChildren: async () => [] };
        const settings: any = { simulator: 'builtin', libDirs: [], defines: {}, waveFileTemplate: '{top_module}.vcd' };
        controller = new Controller({ workspaceState: { get: () => undefined, update: async (_key: string, value: any) => { persisted = value; } }, storageUri: Uri.file(path.join(temp, 'storage')) } as never, {
            scan: async () => { events.push('scan'); }, definitions: () => defs,
            settings: () => settings,
            selectEntry: async entry => {
                if (!defs.some(item => item.key === entry.definitionKey)) throw new Error('Entry missing');
                modules.topModule = entry; controller!.entrySelected(entry);
            },
            run: async () => { runCount++; }, analyze: async () => {},
            analyzeDesign: async key => ({ topModule: key, topDefinitionKey: key, files: [dutPath], moduleMap: Object.fromEntries(includesDut ? [["soc", dutPath]] : []), depGraph: {}, missingModules: [], ambiguousModules: {} }),
            openWave: async filepath => { opened.push(['configuredViewer', Uri.file(filepath)]); },
            openGenerator: key => { generatorKey = key; }, protocols: { load: async () => ({ catalog: {} }) } as never,
        }, modules, designs);
        queue.push(1);
        await controller.runTask();
        assert.strictEqual(runCount, 1, 'first Run selects an entry and runs without a second click');
        assert.strictEqual(controller.state.activeTask?.entry.name, 'tb_soc');
        const initialTask = controller.state.activeTask!.id;
        controller.state.removeTask(initialTask);
        await controller.runTask();
        assert.strictEqual(runCount, 2, 'a legacy selected entry is adopted as a task');
        assert.strictEqual(controller.state.activeTask?.entry.name, 'tb_soc');
        runCount = 0;
        queue.push(0);
        await controller.selectDesign();
        assert.strictEqual(controller.state.design?.name, 'soc');
        await controller.newTask(undefined, true);
        assert.strictEqual(generatorKey, 'soc');
        await controller.generated({ name: 'tb_soc', filepath: tbPath, waveFile: 'custom.vcd', definitionKeys: ['soc'], runAfterGenerate: true });
        assert.strictEqual(runCount, 1);
        assert.strictEqual(controller.state.activeTask?.entry.name, 'tb_soc');
        assert.strictEqual(controller.state.design?.name, 'soc');
        assert.strictEqual(controller.settings().waveFileTemplate, 'custom.vcd');
        const simRows = await controller.simulationView.getChildren();
        assert.ok(simRows.some(row => row.label === 'Simulation entry'));
        assert.ok(!simRows.some(row => row.label === 'Module library'));
        const designRows = await controller.designView.getChildren();
        assert.ok(designRows.some(row => row.label === 'Module library'));
        assert.ok(!designRows.some(row => row.label === 'Dependency tree'));
        const id = controller.beginRun('tb_soc', [dutPath, tbPath], settings);
        const wave = path.join(temp, 'custom.vcd'); fs.writeFileSync(wave, 'original wave');
        await controller.finishRun(id, 'completed', 'original log', wave);
        const captured = controller.state.latestRun!.wavePath!;
        fs.writeFileSync(wave, 'new wave');
        await commands.get('veriflow.openRunWave')!(id);
        assert.strictEqual(opened.at(-1)[1].fsPath, captured);
        assert.strictEqual(fs.readFileSync(captured, 'utf8'), 'original wave');
        assert.strictEqual(opened.at(-1)[0], 'configuredViewer');
        changes.fire({ contentChanges: [{}], document: { uri: Uri.file(dutPath), getText: () => 'changed' } });
        assert.strictEqual(controller.state.latestRun!.outdated, true);
        await commands.get('veriflow.openRunLog')!(id);
        assert.match(opened.at(-1).content, /original log/);
        const taskId = controller.state.activeTask!.id;
        controller.state.addTask('other', { name: 'soc', definitionKey: 'soc', uri: defs[0].uri });
        await controller.selectTask(taskId);
        assert.strictEqual(controller.state.activeTask!.entry.name, 'tb_soc');
        const missing = controller.state.addTask('missing', { name: 'missing', definitionKey: 'missing', uri: defs[0].uri });
        controller.state.selectTask(taskId);
        await assert.rejects(controller.selectTask(missing.id), /entry missing is missing/);
        assert.strictEqual(controller.state.activeTask!.id, taskId, 'failed selection keeps the previous task active');
        assert.strictEqual(modules.topModule.name, 'tb_soc');
        controller.state.removeTask(missing.id);
        defs[1] = { ...defs[1], key: 'tb_soc:offset-after-comment' };
        await controller.selectTask(taskId);
        assert.strictEqual(controller.state.activeTask!.entry.definitionKey, defs[1].key, 'saved entries rebind after declaration offsets change');
        assert.strictEqual(modules.topModule.definitionKey, defs[1].key);
        const fresh = controller.beginRun('tb_soc', [dutPath, tbPath], controller.settings());
        await controller.finishRun(fresh, 'completed', 'fresh');
        await controller.analyzeTask();
        assert.strictEqual(controller.state.latestRun!.outdated, false, 'unchanged dependency analysis preserves result freshness');
        const unrelated = controller.state.addTask('different settings', { ...controller.state.activeTask!.entry }, undefined, { simulator: 'custom' });
        settings.waveViewer = 'custom';
        configChanges.fire({ affectsConfiguration: () => true });
        assert.strictEqual(controller.state.latestRun!.outdated, false, 'viewer changes and switching tasks do not change the producing task inputs');
        controller.state.removeTask(unrelated.id);
        await controller.selectTask(taskId);
        includesDut = false;
        const runsBeforeMismatch = runCount;
        await assert.rejects(controller.runTask(), /does not instantiate/);
        assert.strictEqual(runCount, runsBeforeMismatch, 'mismatched DUT must block simulation');
        assert.strictEqual(controller.state.latestRun!.status, 'failed');
        assert.match(controller.state.latestRun!.log!, /does not instantiate/);
        includesDut = true;
        const ad = path.join(temp, 'soc.ad'); fs.writeFileSync(ad, '{}');
        await controller.selectDesign(Uri.file(ad));
        exportValid = false;
        await assert.rejects(controller.newTask(undefined, true), /graphical design error/);
        exportValid = true;
        await controller.newTask(undefined, true);
        assert.strictEqual(controller.state.design!.adUri, Uri.file(ad).toString());
        assert.ok(events.includes('export'));
        await new Promise(resolve => setImmediate(resolve));
        assert.ok(persisted.tasks.length >= 1);
        console.log('Workflow controller tests passed');
    } finally {
        controller?.dispose(); loader._load = original;
        fs.rmSync(temp, { recursive: true, force: true });
    }
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
