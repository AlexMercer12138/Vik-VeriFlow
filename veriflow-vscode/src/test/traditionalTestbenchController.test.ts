import assert from 'node:assert/strict';
import Module = require('module');
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { SimulationRunCoordinator } from '../workbench/simulationRunCoordinator';
async function main(): Promise<void> {
    const disposable = { dispose() {} };
    class Emitter { event = () => disposable; fire(): void {} dispose(): void {} }
    class Uri {
        constructor(readonly value: string) {} get path(): string { return new URL(this.value).pathname; }
        get fsPath(): string { return this.path; }
        toString(): string { return this.value.replace(/^(file:\/\/\/[a-z]):/i, '$1%3A'); }
        static parse(value: string): Uri { return new Uri(value); }
    }
    class Cancellation {
        private listeners: Array<() => void> = [];
        token = { isCancellationRequested: false, onCancellationRequested: (listener: () => void) => { this.listeners.push(listener); return disposable; } };
        cancel(): void { this.token.isCancellationRequested = true; this.listeners.forEach(listener => listener()); } dispose(): void {}
    }
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'veriflow-traditional-'));
    let save = true, input: any, dependencyKey: string | undefined, selectedTop: string | undefined = 'stale-top';
    let backend = 'builtin', writeWave = false, reportWave = false, runCount = 0, dependencyIssue = false, cancelBeforeRun = false;
    let execution: any = { success: true, stdout: 'done', stderr: '', artifacts: [] };
    const opened: string[] = [], errors: string[] = [], picks: any[][] = [], order: string[] = [];
    const channels: string[] = [], printed: string[] = []; let shown = 0;
    let pick: number | undefined = 0;
    let discoveredWave: string | undefined;
    const commands = new Map<string, (...args: any[]) => any>();
    const vscode = { Uri, EventEmitter: Emitter, CancellationTokenSource: Cancellation,
        TreeItem: class { constructor(public label: string) {} }, TreeItemCollapsibleState: { None: 0, Expanded: 2, Collapsed: 1 }, ProgressLocation: { Notification: 15 },
        commands: { registerCommand: (name: string, callback: any) => { commands.set(name, callback); return disposable; } },
        workspace: { registerTextDocumentContentProvider: () => disposable, saveAll: async () => { order.push('save'); return save; }, asRelativePath: (uri: Uri) => uri.path },
        window: { withProgress: async (_options: any, callback: any) => callback({}, new Cancellation().token),
            createOutputChannel: (name: string) => { channels.push(name); return { ...disposable, appendLine: (text: string) => printed.push(text), show: () => shown++, clear: () => {} }; },
            showErrorMessage: async (message: string) => { errors.push(message); },
            showQuickPick: async (choices: any[]) => { picks.push(choices); return pick === undefined ? undefined : choices[pick]; },
            activeTextEditor: { document: { uri: Uri.parse('file:///workspace/b.sv') } } },
    };
    const loader = Module as unknown as { _load: (...args: any[]) => any }; const original = loader._load;
    loader._load = function (name: string, ...args: any[]): any { return name === 'vscode' ? vscode : original.call(this, name, ...args); };
    try {
        const { TraditionalTestbenchController } = require('../workbench/traditionalTestbenchController');
        let defs = ['a', 'b'].map(name => ({ kind: 'module', name: 'tb', uri: `file:///workspace/${name}.sv`, key: name, dependencies: [] as string[] }));
        const coordinator = new SimulationRunCoordinator();
        const controller = new TraditionalTestbenchController({ subscriptions: [] }, {
            definitions: async () => defs,
            refreshDefinitions: async () => { order.push('refresh'); },
            selectTop: async (definition: any) => { order.push('top'); selectedTop = definition.key; },
            settings: () => ({ simulator: backend, waveFileTemplate: '{top_module}.vcd', libDirs: [], defines: {}, simulatorCompileCmd: 'compile {files}', simulatorRunCmd: 'run {output}' }),
            workspaceRoot: () => root, openWave: async (file: string) => { opened.push(file); },
            dependencies: async (definition: any) => {
                order.push('dependencies'); dependencyKey = definition.key;
                assert.equal(selectedTop, definition.key, 'current file must replace the stale top before resolving dependencies');
                if (cancelBeforeRun) coordinator.cancel({ kind: 'testbench', uri: definition.uri, module: definition.name });
                return { files: [definition.uri], missingModules: dependencyIssue ? ['missing_dut'] : [], ambiguousModules: {} };
            },
            runtimeFiles: async () => ['/workspace/values.hex'],
            waveFile: async () => discoveredWave,
            simulation: { run: async (value: any) => { order.push('simulate'); runCount++; input = value;
                if (writeWave) fs.writeFileSync(value.waveFile, 'wave'.repeat(runCount));
                return { execution: { ...execution, artifacts: reportWave ? [{ kind: 'vcd', destination: value.waveFile, written: true }] : [] } }; } },
        }, coordinator);
        // Explorer context URI must win over the active editor and any previous top.
        await commands.get('veriflow.runTraditionalTestbench')!(Uri.parse('file:///workspace/a.sv'));
        assert.deepEqual(errors, [], 'a file URI must not be interpreted as an HDL definition');
        assert.deepEqual(channels, ['VeriFlow']); assert.ok(shown > 0);
        assert.ok(printed.includes('done'), 'traditional simulator stdout must reach the output window');
        assert.equal(dependencyKey, 'a'); assert.equal(selectedTop, 'a'); assert.equal(input.topModule, 'tb');
        assert.deepEqual(order.filter(value => ['top', 'dependencies', 'simulate'].includes(value)), ['top', 'dependencies', 'simulate']);
        assert.equal(order[0], 'save', 'save current edits before discovering file modules');
        selectedTop = undefined;
        await controller.runFromEditor();
        assert.equal(selectedTop, 'b', 'a configured top must not be a prerequisite');
        assert.equal(dependencyKey, 'b'); assert.equal(input.topModule, 'tb');
        assert.deepEqual(input.files, ['file:///workspace/b.sv']); assert.deepEqual(input.runtimeFiles, ['/workspace/values.hex']);
        assert.equal(coordinator.active, undefined);
        assert.equal(opened.length, 0);
        assert.equal(picks.length, 0, 'single module runs without prompting');
        dependencyIssue = true;
        const beforeDependencyFailure = runCount;
        await assert.rejects(controller.runFromEditor(), /Unresolved HDL dependencies: missing_dut/);
        assert.equal(runCount, beforeDependencyFailure); assert.equal(coordinator.active, undefined);
        dependencyIssue = false; cancelBeforeRun = true;
        await controller.runFromEditor();
        assert.equal(runCount, beforeDependencyFailure, 'cancellation during dependency resolution prevents execution');
        assert.equal(coordinator.active, undefined); cancelBeforeRun = false;

        // A fresh, reported artifact opens automatically; stale custom output does not.
        writeWave = true; reportWave = true;
        await controller.runFromEditor(Uri.parse('file:///workspace/b.sv'));
        assert.deepEqual(opened, [path.join(root, 'tb.vcd')]);
        backend = 'custom'; writeWave = false;
        await controller.runFromEditor();
        assert.equal(opened.length, 1, 'custom backend existence alone is not a fresh waveform');
        assert.equal(input.simulatorCompileCmd, 'compile {files}'); assert.equal(input.simulatorRunCmd, 'run {output}');
        writeWave = true;
        await controller.runFromEditor();
        assert.equal(opened.length, 2, 'fresh custom waveform opens with the configured viewer');
        discoveredWave = path.join(root, 'literal-name.vcd');
        for (const simulator of ['builtin', 'custom']) {
            backend = simulator;
            await controller.runFromEditor();
            assert.equal(input.waveFile, path.join(root, 'literal-name.vcd'));
            assert.equal(opened[opened.length - 1], path.join(root, 'literal-name.vcd'), 'actual literal dumpfile opens even when it differs from the template');
        }
        discoveredWave = undefined;
        for (const code of ['ABORTED', 'SIMULATION_TIMEOUT', 'COMPILE_FAILED']) {
            execution = { success: false, stdout: '', stderr: 'failure', cause: { code, message: code } };
            await controller.runFromEditor();
            assert.equal(opened.length, 4, 'unsuccessful runs never open waveforms');
            assert.ok(printed.some(line => line.includes('failure')), 'failed or cancelled simulation stderr must remain visible');
            assert.equal(coordinator.active, undefined);
        }
        execution = { success: true, stdout: 'done', stderr: '' }; writeWave = false; reportWave = false;

        const originalDefs = defs;
        defs = [...defs, { kind: 'module', name: 'helper', uri: 'file:///workspace/b.sv', key: 'helper', dependencies: [] }];
        defs[1] = { ...defs[1], dependencies: ['helper'] };
        await controller.runFromEditor();
        assert.equal(dependencyKey, 'b'); assert.equal(picks.length, 0, 'a unique file hierarchy root is selected automatically');
        defs = [...originalDefs, { kind: 'module', name: 'other_tb', uri: 'file:///workspace/b.sv', key: 'other', dependencies: [] }];
        pick = undefined;
        const beforeCancel = runCount;
        await controller.runFromEditor();
        assert.equal(picks.length, 1); assert.equal(runCount, beforeCancel, 'cancelled module choice must not simulate');
        pick = 1;
        await controller.runFromEditor();
        assert.equal(input.topModule, 'other_tb'); assert.equal(dependencyKey, 'other');
        await assert.rejects(controller.runFromEditor(Uri.parse('file:///workspace/empty.sv')), /No.*module/i);
        assert.equal(coordinator.active, undefined);
        defs = originalDefs;
        // VS Code encodes drive colons; the index stores canonical file URIs.
        defs = [{ ...defs[0], uri: 'file:///c:/workspace/encoded%20tb.sv', key: 'encoded' }];
        await controller.runFromEditor(Uri.parse('file:///c%3A/workspace/encoded%20tb.sv'));
        assert.equal(dependencyKey, 'encoded');
        if (process.platform === 'win32') {
            await controller.runFromEditor(Uri.parse('file:///C%3A/Workspace/Encoded%20TB.sv'));
            assert.equal(dependencyKey, 'encoded', 'Windows index and editor URI casing can differ');
        }
        defs = originalDefs;
        const lease = coordinator.acquire({ kind: 'st', uri: 'file:///other.st' }, () => {});
        await assert.rejects(controller.run(defs[0]), /already running/); lease.release();
        save = false;
        await assert.rejects(controller.run(defs[0]), /Save HDL/); assert.equal(coordinator.active, undefined);
        controller.dispose();
        require('../output').dispose();
    } finally { loader._load = original; fs.rmSync(root, { recursive: true, force: true }); }
    console.log('Traditional Testbench controller tests passed');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
