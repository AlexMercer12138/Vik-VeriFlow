import * as vscode from 'vscode';
import * as path from 'path';
import { readFileSync } from 'fs';
import { randomBytes } from 'crypto';
import { describeArchDesignSource, parseSimulationTask, type SimulationTaskDocument, type TaskModuleDefinition } from '@veriflow/hdl-runtime/simulationTask';
import { parseArchDesignText } from '@veriflow/schematic-core/arch-design';
import type { InterfaceProtocolCatalog } from '@veriflow/schematic-core/interfaces';
import type { HdlDefinitionSummary } from '../core';
import { buildSchematicWebviewHtml } from '../schematic/webviewSupport';
import { parseWebviewCommand } from '../schematic/protocol';
import { archDesignPresentationFromLayout } from '../archDesign/editorSupport';
import { projectSimulationTask, taskModuleKey } from './taskProjection';
import { applyTaskEdit } from './taskAuthoring';
export interface TaskExecutionState { status: 'idle' | 'running' | 'completed' | 'failed' | 'stopped'; canOpenWave: boolean; error?: string }
export interface TaskEditorServices {
    definitions(uri: vscode.Uri): Promise<readonly HdlDefinitionSummary[]>;
    interfaces(uri: vscode.Uri): Promise<InterfaceProtocolCatalog>;
    run(document: vscode.TextDocument): Promise<void>;
    generate(document: vscode.TextDocument): Promise<void>;
    cancel(uri: vscode.Uri): void;
    execution(uri: vscode.Uri): TaskExecutionState;
    openWave(uri: vscode.Uri): Promise<void>;
    onDidChange: vscode.Event<void>;
}
export class SimulationTaskEditorProvider implements vscode.CustomTextEditorProvider, vscode.Disposable {
    static readonly viewType = 'veriflow.simulationTask';
    constructor(private readonly context: vscode.ExtensionContext, private readonly services: TaskEditorServices) {}
    dispose(): void {}
    async modules(document: vscode.TextDocument, task: SimulationTaskDocument): Promise<TaskModuleDefinition[]> {
        const definitions = await this.services.definitions(document.uri);
        const modules: TaskModuleDefinition[] = definitions.map(definition => ({ module: definition.name,
            source: path.relative(path.dirname(document.uri.fsPath), vscode.Uri.parse(definition.uri).fsPath).replace(/\\/g, '/'),
            ports: definition.ports.map(port => ({ name: port.name, direction: port.direction, width: port.width.kind === 'known'
                ? port.width.bits : port.width.kind === 'symbolic' ? port.width.expression : undefined })),
            parameters: definition.parameters.map(parameter => ({ name: parameter.name, defaultValue: parameter.defaultExpression })) }));
        const designs = new Map<string, vscode.Uri>();
        for (const uri of await vscode.workspace.findFiles('**/*.ad', '**/{node_modules,.git,.veriflow,.trash}/**')) designs.set(uri.toString(), uri);
        for (const instance of task.instances) if ('source' in instance && instance.source.kind === 'ad') {
            const uri = vscode.Uri.file(path.resolve(path.dirname(document.uri.fsPath), instance.source.path)); designs.set(uri.toString(), uri);
        }
        const interfaceCatalog = await this.services.interfaces(document.uri);
        for (const uri of designs.values()) {
            try {
                const parsed = parseArchDesignText((await vscode.workspace.openTextDocument(uri)).getText());
                if (parsed.status === 'editable') modules.push(describeArchDesignSource(parsed.design,
                    path.relative(path.dirname(document.uri.fsPath), uri.fsPath).replace(/\\/g, '/'), interfaceCatalog));
            } catch { /* Missing or invalid dependencies remain visible in the projected graph diagnostics. */ }
        }
        return modules;
    }
    async addModules(uri: vscode.Uri, definitions: readonly HdlDefinitionSummary[]): Promise<void> {
        const document = await vscode.workspace.openTextDocument(uri), version = document.version;
        let task = parseSimulationTask(document.getText());
        const modules = await this.modules(document, task);
        if (document.version !== version) throw new Error('The task changed while adding modules.');
        for (const definition of definitions) {
            const source = path.relative(path.dirname(uri.fsPath), vscode.Uri.parse(definition.uri).fsPath).replace(/\\/g, '/');
            let name = `u_${definition.name}`, suffix = 2;
            while (task.instances.some(item => item.id === name) || task.logic.some(item => item.name === name)) name = `u_${definition.name}_${suffix++}`;
            task = applyTaskEdit(task, modules, { type: 'addInstance', instance: { name, module: definition.name, definitionKey: taskModuleKey(source, definition.name) } });
        }
        await replaceTaskDocument(document, task);
    }
    resolveCustomTextEditor(document: vscode.TextDocument, panel: vscode.WebviewPanel): void {
        const root = vscode.Uri.joinPath(this.context.extensionUri, 'media', 'schematic');
        panel.webview.options = { enableScripts: true, localResourceRoots: [root] };
        panel.webview.html = buildSchematicWebviewHtml(readFileSync(vscode.Uri.joinPath(root, 'index.html').fsPath, 'utf8'), {
            cspSource: panel.webview.cspSource, nonce: randomBytes(18).toString('base64'),
            styleUri: panel.webview.asWebviewUri(vscode.Uri.joinPath(root, 'index.css')).toString(),
            scriptUri: panel.webview.asWebviewUri(vscode.Uri.joinPath(root, 'index.js')).toString() });
        let disposed = false, generation = 0, initialized = false, tail = Promise.resolve();
        let modules: TaskModuleDefinition[] = [], projected: ReturnType<typeof projectSimulationTask> | undefined;
        const post = (data: unknown) => { if (!disposed) void panel.webview.postMessage(data); };
        const revision = () => String(document.version);
        const publish = async (): Promise<void> => {
            const current = ++generation, version = document.version;
            try {
                const task = parseSimulationTask(document.getText());
                const [nextModules, catalog] = await Promise.all([this.modules(document, task), this.services.interfaces(document.uri)]);
                if (disposed || current !== generation || version !== document.version) return;
                modules = nextModules; projected = projectSimulationTask(task, modules, document.uri.toString(), catalog);
                if (!initialized) {
                    post({ type: 'initialize', fileUri: document.uri.toString(), documentKind: 'simulation-task', editable: true,
                        capabilities: { addPort: false, exportRtl: false, run: true }, modules: [{ key: projected.graph.moduleKey, name: path.basename(document.uri.fsPath) }], selectedModuleKey: projected.graph.moduleKey }); initialized = true;
                }
                post({ type: 'graph', revision: revision(), graph: projected.graph, layout: projected.layout, fitOnFirstRender: true });
                post({ type: 'simulationTaskState', revision: revision(), projection: projected.projection,
                    task: { document: task, version, execution: this.services.execution(document.uri) } });
            } catch (error) { post({ type: 'hostError', message: error instanceof Error ? error.message : String(error) }); }
        };
        const reportError = async (error: unknown) => { await publish(); post({ type: 'hostError', message: error instanceof Error ? error.message : String(error) }); };
        const receive = panel.webview.onDidReceiveMessage(raw => {
            tail = tail.then(async () => {
                const message = parseWebviewCommand(raw); if (!message || disposed) return;
                if (message.type === 'ready') { await publish(); return; }
                if ('revision' in message && message.revision !== revision()) throw new Error('The task changed; retry this action.');
                let task = parseSimulationTask(document.getText());
                if (message.type === 'saveLayout' && projected) {
                    task.presentation = archDesignPresentationFromLayout(projected.projection.design, projected.graph, message.layout);
                    await replaceTaskDocument(document, task); post({ type: 'archDesignLayoutSaved', revision: revision() }); await publish(); return;
                }
                if (message.type === 'relayoutAll') { task.presentation = {}; await replaceTaskDocument(document, task); await publish(); return; }
                if (message.type === 'editSchematic') { await replaceTaskDocument(document, applyTaskEdit(task, modules, message.edit)); await publish(); return; }
                if (message.type === 'openDefinition') {
                    const definition = modules.find(item => taskModuleKey(item.source, item.module) === message.definitionKey);
                    if (definition) {
                        const uri = vscode.Uri.file(path.resolve(path.dirname(document.uri.fsPath), definition.source));
                        if (definition.source.endsWith('.ad')) await vscode.commands.executeCommand('vscode.openWith', uri, 'veriflow.archDesignEditor');
                        else await vscode.window.showTextDocument(uri, { preview: true });
                    }
                    return;
                }
                if (message.type !== 'simulationTaskCommand') return;
                const data = (message.payload ?? {}) as Record<string, any>;
                switch (message.command) {
                    case 'addPreset': task.instances.push({ id: data.id, preset: data.preset }); await replaceTaskDocument(document, task); break;
                    case 'updatePreset': {
                        const instance = task.instances.find(item => item.id === data.id);
                        if (!instance || !('preset' in instance) || instance.preset.kind !== data.preset.kind) throw new Error('This simulation utility no longer exists.');
                        instance.preset = data.preset; await replaceTaskDocument(document, task); break;
                    }
                    case 'updateTaskSettings': task.settings = { ...task.settings, ...data.settings }; await replaceTaskDocument(document, task); break;
                    case 'generateTestbench': await this.services.generate(document); break;
                    case 'run': void this.services.run(document).catch(reportError); break;
                    case 'cancel': this.services.cancel(document.uri); break;
                    case 'openWave': await this.services.openWave(document.uri); break;
                }
                await publish();
            }).catch(reportError);
        });
        const changes = vscode.workspace.onDidChangeTextDocument(event => {
            if (event.document.uri.toString() === document.uri.toString() || /\.(ad|v|sv)$/i.test(event.document.uri.path)) void publish();
        });
        const dependencies = vscode.workspace.createFileSystemWatcher('**/*.{ad,v,sv}');
        const dependencyChanges = [dependencies.onDidChange(() => void publish()), dependencies.onDidCreate(() => void publish()), dependencies.onDidDelete(() => void publish())];
        const runs = this.services.onDidChange(() => void publish());
        panel.onDidDispose(() => { disposed = true; receive.dispose(); changes.dispose(); runs.dispose(); dependencies.dispose(); dependencyChanges.forEach(item => item.dispose()); });
    }
}
const pendingEdits = new Map<string, Promise<void>>();
export async function replaceTaskDocument(document: vscode.TextDocument, task: SimulationTaskDocument, expectedVersion = document.version): Promise<void> {
    parseSimulationTask(JSON.stringify(task));
    const text = JSON.stringify(task, null, 2) + '\n', key = document.uri.toString();
    const previous = pendingEdits.get(key) ?? Promise.resolve();
    const operation = previous.catch(() => {}).then(async () => {
        if (document.version !== expectedVersion) throw new Error('The task changed; retry this action.');
        const edit = new vscode.WorkspaceEdit();
        edit.replace(document.uri, new vscode.Range(document.positionAt(0), document.positionAt(document.getText().length)), text);
        if (!await vscode.workspace.applyEdit(edit)) throw new Error('The task document could not be updated.');
    });
    pendingEdits.set(key, operation);
    try { await operation; } finally { if (pendingEdits.get(key) === operation) pendingEdits.delete(key); }
}
