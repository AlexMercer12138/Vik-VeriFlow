import * as vscode from 'vscode';
import * as path from 'path';
import { readFileSync } from 'fs';
import { randomBytes } from 'crypto';
import { describeArchDesignSource, parseSimulationTask, SimulationTaskValidationError, type SimulationTaskDocument, type TaskModuleDefinition } from '@veriflow/hdl-runtime/simulationTask';
import { parseArchDesignText } from '@veriflow/schematic-core/arch-design';
import type { InterfaceProtocolCatalog } from '@veriflow/schematic-core/interfaces';
import type { HdlDefinitionSummary } from '../core';
import { buildSchematicWebviewHtml } from '../schematic/webviewSupport';
import { parseWebviewCommand } from '../schematic/protocol';
import { archDesignGraphsEqual, archDesignPresentationFromLayout } from '../archDesign/editorSupport';
import { projectSimulationTask, taskModuleKey } from './taskProjection';
import { applyTaskEdit } from './taskAuthoring';
export interface TaskExecutionState { status: 'idle' | 'running' | 'completed' | 'failed' | 'stopped'; canOpenWave: boolean; error?: string }
export interface TaskEditorServices {
    definitions(uri: vscode.Uri, owner?: object): Promise<readonly HdlDefinitionSummary[]>;
    releaseDefinitions?(owner: object): void;
    interfaces(uri: vscode.Uri): Promise<InterfaceProtocolCatalog>;
    run(document: vscode.TextDocument): Promise<void>;
    generate(document: vscode.TextDocument): Promise<void>;
    cancel(uri: vscode.Uri): void;
    execution(uri: vscode.Uri): TaskExecutionState;
    openWave(uri: vscode.Uri): Promise<void>;
    onDidChange: vscode.Event<void>;
    onDidInvalidate?: vscode.Event<void>;
}
export class SimulationTaskEditorProvider implements vscode.CustomTextEditorProvider, vscode.Disposable {
    static readonly viewType = 'veriflow.simulationTask';
    constructor(private readonly context: vscode.ExtensionContext, private readonly services: TaskEditorServices) {}
    dispose(): void {}
    async modules(document: vscode.TextDocument, task: SimulationTaskDocument,
        interfaceCatalog = this.services.interfaces(document.uri), owner?: object): Promise<TaskModuleDefinition[]> {
        const definitions = await this.services.definitions(document.uri, owner);
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
        const catalog = await interfaceCatalog;
        for (const uri of designs.values()) {
            try {
                const parsed = parseArchDesignText((await vscode.workspace.openTextDocument(uri)).getText());
                if (parsed.status === 'editable') modules.push(describeArchDesignSource(parsed.design,
                    path.relative(path.dirname(document.uri.fsPath), uri.fsPath).replace(/\\/g, '/'), catalog));
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
        let disposed = false, ready = false, initialized = false, tail = Promise.resolve();
        const indexOwner = {};
        const diagnostics = vscode.languages.createDiagnosticCollection('veriflow-simulation-task');
        let modules: TaskModuleDefinition[] = [], projected: ReturnType<typeof projectSimulationTask> | undefined;
        let catalog: InterfaceProtocolCatalog | undefined;
        let dependencyRevision = 0, loadedDependencyRevision = -1;
        let loadedArchSources = '';
        let publishedText: string | undefined, publishedVersion = 0, expectedText: string | undefined;
        let refreshQueued = false;
        const post = (data: unknown) => { if (!disposed) void panel.webview.postMessage(data); };
        const revision = () => String(document.version);
        const publishDiagnostics = (details: Array<{ code: string; message: string; severity: 'error' | 'warning' }>) => {
            if (disposed) return;
            diagnostics.set(document.uri, details.map(item => {
                const diagnostic = new vscode.Diagnostic(new vscode.Range(document.positionAt(0), document.positionAt(0)),
                    item.message, item.severity === 'error' ? vscode.DiagnosticSeverity.Error : vscode.DiagnosticSeverity.Warning);
                diagnostic.code = item.code; diagnostic.source = 'VeriFlow Simulation Task';
                return diagnostic;
            }));
            post({ type: 'diagnostics', errors: details.filter(item => item.severity === 'error').length,
                warnings: details.filter(item => item.severity === 'warning').length, details });
        };
        const reportError = (error: unknown) => {
            if (disposed) return;
            const message = error instanceof Error ? error.message : String(error);
            if (error instanceof SimulationTaskValidationError) publishDiagnostics(error.diagnostics.map(item => ({
                code: item.code, severity: item.severity, message: `${item.path}: ${item.message}`,
            })));
            post({ type: 'hostError', message });
            void vscode.window.showErrorMessage(message);
        };
        const publishState = (task: SimulationTaskDocument) => {
            if (!projected) return;
            post({ type: 'simulationTaskState', revision: revision(), projection: projected.projection,
                task: { document: task, version: document.version, execution: this.services.execution(document.uri) } });
        };
        const publish = async (): Promise<void> => {
            if (!ready || disposed) return;
            const version = document.version, text = document.getText(), dependencies = dependencyRevision;
            let parsed = false;
            try {
                const task = parseSimulationTask(text);
                parsed = true;
                const archSources = JSON.stringify(task.instances.flatMap(item => 'source' in item && item.source.kind === 'ad' ? [item.source.path] : []).sort());
                const catalogChanged = !catalog || loadedDependencyRevision !== dependencies || loadedArchSources !== archSources;
                if (catalogChanged) {
                    const loadingCatalog = this.services.interfaces(document.uri);
                    const [nextModules, nextCatalog] = await Promise.all([this.modules(document, task, loadingCatalog, indexOwner), loadingCatalog]);
                    if (disposed) { this.services.releaseDefinitions?.(indexOwner); return; }
                    if (version !== document.version || dependencies !== dependencyRevision) { scheduleRefresh(); return; }
                    modules = nextModules; catalog = nextCatalog; loadedDependencyRevision = dependencies;
                    loadedArchSources = archSources;
                }
                if (!catalogChanged && publishedText === text && publishedVersion === version && projected) return;
                const next = projectSimulationTask(task, modules, document.uri.toString(), catalog);
                if (next.task !== task) {
                    await write(next.task);
                    await publish();
                    return;
                }
                const previous = projected;
                projected = next;
                if (!initialized) {
                    post({ type: 'initialize', fileUri: document.uri.toString(), documentKind: 'simulation-task', editable: true,
                        capabilities: { addPort: false, exportRtl: false, run: true }, modules: [{ key: projected.graph.moduleKey, name: path.basename(document.uri.fsPath) }], selectedModuleKey: projected.graph.moduleKey }); initialized = true;
                }
                if (previous && archDesignGraphsEqual(previous.graph, projected.graph)
                    && JSON.stringify(previous.projection.design.presentation) === JSON.stringify(task.presentation)) {
                    post({ type: 'archDesignRevisionChanged', revision: revision() });
                } else {
                    post({ type: 'graph', revision: revision(), graph: projected.graph, layout: projected.layout, fitOnFirstRender: true });
                }
                const { diagnostics: errors, warnings } = projected.projection.validation;
                publishDiagnostics([...errors, ...warnings].map((item, index) => ({
                    severity: index < errors.length ? 'error' : 'warning', code: item.code, message: `${item.path}: ${item.message}` })));
                publishedText = text; publishedVersion = version;
                publishState(task);
            } catch (error) {
                if (disposed) this.services.releaseDefinitions?.(indexOwner);
                const diagnostic = { path: '$', code: 'ST_DOCUMENT_ERROR', message: error instanceof Error ? error.message : String(error) };
                if (!parsed) {
                    publishedText = undefined;
                    projected = undefined;
                    if (!initialized) post({ type: 'initialize', fileUri: document.uri.toString(), modules: [], selectedModuleKey: '',
                        documentKind: 'simulation-task', editable: false, capabilities: { addPort: false, exportRtl: false, run: true } });
                    publishDiagnostics([{ ...diagnostic, severity: 'error' }]);
                    post({ type: 'archDesignState', status: 'invalid', revision: revision(), diagnostics: [diagnostic] });
                } else reportError(error);
            }
        };
        const scheduleRefresh = () => {
            if (refreshQueued || disposed || !ready) return;
            refreshQueued = true;
            tail = tail.then(async () => { refreshQueued = false; await publish(); }).catch(reportError);
        };
        const invalidateDependencies = () => {
            dependencyRevision++; publishedText = undefined; scheduleRefresh();
        };
        const write = async (task: SimulationTaskDocument) => {
            expectedText = JSON.stringify(task, null, 2) + '\n';
            try { await replaceTaskDocument(document, task); }
            finally { expectedText = undefined; }
        };
        const receive = panel.webview.onDidReceiveMessage(raw => {
            // Cancellation must not wait behind an export or a dependency refresh.
            const immediate = parseWebviewCommand(raw);
            if (immediate?.type === 'simulationTaskCommand' && immediate.command === 'cancel') {
                if (!disposed) this.services.cancel(document.uri);
                return;
            }
            tail = tail.then(async () => {
                const message = parseWebviewCommand(raw);
                if (!message || (disposed && message.type !== 'saveLayout')) return;
                if (message.type === 'ready') { ready = true; await publish(); return; }
                if ('revision' in message && message.revision !== revision()) throw new Error('The task changed; retry this action.');
                let task = parseSimulationTask(document.getText());
                if (message.type === 'saveLayout' && projected) {
                    if (message.moduleKey !== projected.graph.moduleKey) return;
                    task.presentation = archDesignPresentationFromLayout(projected.projection.design, projected.graph, message.layout);
                    await write(task);
                    if (document.getText() !== JSON.stringify(task, null, 2) + '\n') {
                        await publish();
                        post({ type: 'archDesignLayoutSaved', revision: revision() });
                        return;
                    }
                    projected.projection.design = { ...projected.projection.design, presentation: task.presentation };
                    projected.layout = message.layout;
                    publishedText = document.getText(); publishedVersion = document.version;
                    post({ type: 'archDesignLayoutSaved', revision: revision() }); return;
                }
                if (message.type === 'relayoutAll') { task.presentation = {}; await write(task); await publish(); return; }
                if (message.type === 'editSchematic') { await write(applyTaskEdit(task, modules, message.edit)); await publish(); return; }
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
                    case 'addPreset': task.instances.push({ id: data.id, preset: data.preset }); await write(task); break;
                    case 'updatePreset': {
                        const instance = task.instances.find(item => item.id === data.id);
                        if (!instance || !('preset' in instance) || instance.preset.kind !== data.preset.kind) throw new Error('This simulation utility no longer exists.');
                        instance.preset = data.preset; await write(task); break;
                    }
                    case 'updateTaskSettings': task.settings = { ...task.settings, ...data.settings }; await write(task); break;
                    case 'generateTestbench': await this.services.generate(document); break;
                    case 'run': void this.services.run(document).catch(reportError); break;
                    case 'cancel': this.services.cancel(document.uri); break;
                    case 'openWave': await this.services.openWave(document.uri); break;
                }
                if (publishedText !== document.getText() || publishedVersion !== document.version) await publish();
                else publishState(task);
            }).catch(reportError);
        });
        const changes = vscode.workspace.onDidChangeTextDocument(event => {
            if (event.contentChanges?.length === 0) return;
            if (event.document.uri.toString() === document.uri.toString()) {
                if (document.getText() !== expectedText) scheduleRefresh();
            } else if ((this.services.onDidInvalidate ? /\.ad$/i : /\.(ad|v|sv|vh|svh)$/i).test(event.document.uri.path)) invalidateDependencies();
        });
        // The shared HDL index notifies after its incremental refresh completes.
        const dependencies = vscode.workspace.createFileSystemWatcher(this.services.onDidInvalidate ? '**/*.ad' : '**/*.{ad,v,sv,vh,svh}');
        const dependencyChanges = [dependencies.onDidChange(invalidateDependencies), dependencies.onDidCreate(invalidateDependencies), dependencies.onDidDelete(invalidateDependencies)];
        const invalidation = this.services.onDidInvalidate?.(invalidateDependencies);
        const runs = this.services.onDidChange(() => {
            if (initialized) post({ type: 'simulationTaskExecution', execution: this.services.execution(document.uri) });
        });
        panel.onDidDispose(() => { disposed = true; diagnostics.dispose(); this.services.releaseDefinitions?.(indexOwner); receive.dispose(); changes.dispose(); runs.dispose(); invalidation?.dispose(); dependencies.dispose(); dependencyChanges.forEach(item => item.dispose()); });
    }
}
const pendingEdits = new Map<string, Promise<void>>();
export async function replaceTaskDocument(document: vscode.TextDocument, task: SimulationTaskDocument, expectedVersion = document.version): Promise<void> {
    parseSimulationTask(JSON.stringify(task));
    const text = JSON.stringify(task, null, 2) + '\n', key = document.uri.toString();
    const previous = pendingEdits.get(key) ?? Promise.resolve();
    const operation = previous.catch(() => {}).then(async () => {
        if (document.version !== expectedVersion) throw new Error('The task changed; retry this action.');
        if (document.getText() === text) return;
        const edit = new vscode.WorkspaceEdit();
        edit.replace(document.uri, new vscode.Range(document.positionAt(0), document.positionAt(document.getText().length)), text);
        if (!await vscode.workspace.applyEdit(edit)) throw new Error('The task document could not be updated.');
    });
    pendingEdits.set(key, operation);
    try { await operation; } finally { if (pendingEdits.get(key) === operation) pendingEdits.delete(key); }
}
