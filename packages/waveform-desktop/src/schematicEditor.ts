import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import {
    app,
    BrowserWindow,
    ipcMain,
    type IpcMainEvent,
} from 'electron';
import {
    ConfiguredNativeSimulatorBackend,
    DEFAULT_SIMULATORS,
    GlobalConfigStore,
    ProjectStore,
    type Project,
    type SimulatorBackend,
} from '@veriflow/flow-core';
import { IverilogWasmBackend } from '@veriflow/simulator-iverilog-wasm';
import {
    prepareArchDesignBuild,
    publishArtifactPlan,
    snapshotIndexedInputs,
} from '@veriflow/hdl-runtime/archDesign';
import { createArchDesignDefinitionCatalog } from '@veriflow/hdl-runtime/archDesignDefinitionReference';
import { loadInterfaceProtocolCatalog } from '@veriflow/hdl-runtime/interfaces';
import { NodeWorkspaceHost } from '@veriflow/hdl-runtime/nodeWorkspaceHost';
import { prepareSimulationTaskSources, prepareSimulationTaskWorkspace, type TaskWorkspaceOptions } from '@veriflow/hdl-runtime/simulationTaskWorkspace';
import { deriveTaskModuleName } from '@veriflow/hdl-runtime/simulationTask';
import { parseArchDesignText } from '@veriflow/schematic-core/arch-design';
import { ArchDesignSession } from '@veriflow/hdl-runtime/workbench/archDesignSession';
import { NodeFileDocumentHost } from '@veriflow/hdl-runtime/workbench/documentHost';
import { normalizeArchDesignDefinitionKeys, toArchDesignModuleDefinitions } from '@veriflow/hdl-runtime/workbench/editorSupport';
import { SimulationTaskSession } from '@veriflow/hdl-runtime/workbench/simulationTaskSession';
import { parseWebviewCommand } from '@veriflow/hdl-runtime/workbench/protocol';
import { createBoardEditorWindow } from './boardEditor';
import {
    SCHEMATIC_EDITOR_HOST_MESSAGE_CHANNEL,
    SCHEMATIC_EDITOR_RENDERER_MESSAGE_CHANNEL,
} from './ipc';
import { launchWaveformWindow } from './launcher';

export type SchematicEditorKind = 'arch-design' | 'simulation-task';
export type SchematicEditorOptions = Readonly<{
    project?: string;
    lib?: string[];
}>;

function openProject(filepath: string, projectPath?: string): Project {
    if (projectPath) return new ProjectStore().open(path.resolve(projectPath));
    const project = new ProjectStore().create(path.basename(filepath, path.extname(filepath)), path.dirname(filepath));
    project.simulator = 'builtin';
    return project;
}

function workspaceOptions(project: Project, interfaces: Awaited<ReturnType<typeof loadInterfaceProtocolCatalog>>): TaskWorkspaceOptions {
    return {
        workspaceRoot: project.rootDir,
        interfaceCatalog: interfaces.catalog,
        includeDirs: project.libDirs.map(directory => path.resolve(project.rootDir, directory)),
        defines: Object.fromEntries(Object.entries(project.defines)
            .filter(([, value]) => value !== false)
            .map(([key, value]) => [key, value === true ? true : String(value)])),
    };
}

function definitionRoots(filepath: string, project: Project, options: SchematicEditorOptions): string[] {
    const global = new GlobalConfigStore({ homeDir: os.homedir() }).getLibDirs();
    return [...new Set([
        path.dirname(filepath), project.rootDir,
        ...project.libDirs.map(directory => path.resolve(project.rootDir, directory)),
        ...global.map(directory => path.resolve(directory)),
        ...(options.lib ?? []).map(directory => path.resolve(directory)),
    ])];
}

async function createArchSession(filepath: string, project: Project, options: SchematicEditorOptions) {
    const host = new NodeWorkspaceHost(definitionRoots(filepath, project, options), projectDefines(project));
    const protocols = await loadInterfaceProtocolCatalog(project.interfaceProtocolFiles);
    if (protocols.diagnostics.length) {
        await host.dispose();
        throw new Error(protocols.diagnostics.map(item => `${item.source}:${item.path} [${item.code}] ${item.message}`).join('\n'));
    }
    const workspaceRoot = project.rootDir || path.dirname(filepath);
    const catalog = () => createArchDesignDefinitionCatalog(
        host.index.getAllDefinitions('module'), pathToFileURL(workspaceRoot).toString(),
    );
    const session = new ArchDesignSession({
        documents: new NodeFileDocumentHost(),
        interfaces: async () => protocols.catalog,
        definitions: async () => {
            await host.scan();
            return toArchDesignModuleDefinitions(catalog().definitions);
        },
        normalizeDesign: async (_source, design) => normalizeArchDesignDefinitionKeys(design, catalog()),
        moduleChoices: async () => catalog().definitions.map(item => ({
            label: item.name, description: item.uri, moduleName: item.name, definitionKey: item.key,
        })),
        command: async (_source, command) => {
            if (command.type === 'openPhysicalPins') {
                const document = session.currentDesign;
                if (!document) return;
                const configPath = path.join(app.getPath('userData'), 'physical-boards.json');
                await createBoardEditorWindow(configPath, filepath, {
                    module: document.module, project: options.project, lib: [...options.lib ?? []],
                });
                return;
            }
            const snapshot = await new NodeFileDocumentHost().readText(filepath);
            const parsed = JSON.parse(snapshot.text);
            const design = parseArchDesignText(snapshot.text);
            if (design.status !== 'editable') throw new Error('Fix the Arch Design before exporting.');
            await host.scan();
            const definitions = toArchDesignModuleDefinitions(catalog().definitions);
            const inputs = await snapshotIndexedInputs(host.index, catalog().definitions.map(item => item.uri));
            const plan = await prepareArchDesignBuild(filepath, design.design, definitions, {
                sourceText: snapshot.text,
                inputs,
                interfaceCatalog: protocols.catalog,
                configPath: path.join(app.getPath('userData'), 'physical-boards.json'),
                rtlOnly: command.type === 'exportArchDesign',
            });
            await publishArtifactPlan(plan);
            console.info(`Arch Design ${command.type === 'buildArchDesign' ? 'built' : 'exported'}: ${filepath}`);
        },
    });
    return { session, dispose: () => host.dispose(), shouldKeepArtifacts: () => false, cleanupArtifacts: async () => undefined };
}

function projectDefines(project: Project): Record<string, string | true> {
    return Object.fromEntries(Object.entries(project.defines)
        .filter(([, value]) => value !== false)
        .map(([key, value]) => [key, value === true ? true : String(value)]));
}

async function createTaskSession(filepath: string, project: Project) {
    const protocols = await loadInterfaceProtocolCatalog(project.interfaceProtocolFiles);
    if (protocols.diagnostics.length) {
        throw new Error(protocols.diagnostics.map(item => `${item.source}:${item.path} [${item.code}] ${item.message}`).join('\n'));
    }
    const options = workspaceOptions(project, protocols);
    const artifactDirectories = new Set<string>();
    const session = new SimulationTaskSession({
        documents: new NodeFileDocumentHost(),
        interfaces: async () => protocols.catalog,
        modules: async (source, task) => {
            const prepared = await prepareSimulationTaskSources(task, source, undefined, options);
            try { return prepared.modules; }
            finally { await prepared.dispose(); }
        },
        prepare: (task, source, signal) => prepareSimulationTaskWorkspace(task, source, signal, options),
        backend: async () => createSimulationBackend(project),
        artifactDirectory: async () => {
            const directory = await mkdtemp(path.join(os.tmpdir(), 'veriflow-st-wave-'));
            artifactDirectories.add(directory);
            return directory;
        },
        generate: async (source, task) => {
            const prepared = await prepareSimulationTaskWorkspace(task, source, undefined, options);
            try {
                const target = task.settings.exportPath
                    ? path.resolve(path.dirname(source), task.settings.exportPath)
                    : path.join(path.dirname(source), `${deriveTaskModuleName(source)}.v`);
                const marker = `// Generated Simulation Task: ${prepared.generatedTestbench.moduleName}`;
                const existing = await readFile(target, 'utf8').catch(error => {
                    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
                    throw error;
                });
                if (existing !== undefined && existing.split(/\r?\n/, 1)[0] !== marker) {
                    throw new Error(`Refusing to overwrite a file not generated for this task: ${target}`);
                }
                await publishArtifactPlan({ diagnostics: [], inputs: [
                    { path: source, text: await readFile(source, 'utf8') },
                    ...prepared.inputs ?? [],
                ], artifacts: [{ kind: 'testbench', path: target,
                    text: `${marker}\n${prepared.generatedTestbench.text}`,
                    owns: text => text.split(/\r?\n/, 1)[0] === marker }] });
                console.info(`Simulation Task testbench generated: ${target}`);
            } finally { await prepared.dispose(); }
        },
        openWave: async (_source, wave) => launchWaveformWindow(wave),
    });
    return {
        session,
        dispose: async () => session.dispose(),
        shouldKeepArtifacts: () => session.execution.canOpenWave,
        cleanupArtifacts: async () => {
            if (!session.execution.canOpenWave) {
                await Promise.all([...artifactDirectories].map(directory => rm(directory, { recursive: true, force: true })));
            }
        },
    };
}

async function createSimulationBackend(project: Project): Promise<SimulatorBackend> {
    if (project.simulator === 'builtin') return new IverilogWasmBackend();
    if (project.simulator === 'experimental-ts') throw new Error('experimental-ts is not available in this build; no fallback was attempted');
    const simulator = project.simulators[project.simulator] ?? DEFAULT_SIMULATORS[project.simulator];
    if (!simulator) throw new Error(`Unknown simulator backend: ${project.simulator}`);
    return new ConfiguredNativeSimulatorBackend(project.simulator, simulator);
}

export async function createSchematicEditorWindow(
    source: string,
    kind: SchematicEditorKind,
    options: SchematicEditorOptions = {},
): Promise<BrowserWindow> {
    const filepath = path.resolve(source);
    if (path.extname(filepath).toLowerCase() !== (kind === 'arch-design' ? '.ad' : '.st')) {
        throw new Error(`The ${kind === 'arch-design' ? 'Arch Design' : 'Simulation Task'} editor requires a .${kind === 'arch-design' ? 'ad' : 'st'} file.`);
    }
    const project = openProject(filepath, options.project);
    const window = new BrowserWindow({
        width: 1440,
        height: 900,
        minWidth: 900,
        minHeight: 620,
        title: `VeriFlow ${kind === 'arch-design' ? 'Arch Design' : 'Simulation Task'} - ${path.basename(filepath)}`,
        backgroundColor: '#15191e',
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            additionalArguments: ['--veriflow-schematic-editor', `--veriflow-schematic-kind=${kind}`],
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
        },
    });
    window.webContents.on('will-navigate', event => event.preventDefault());
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

    const host = kind === 'arch-design'
        ? await createArchSession(filepath, project, options)
        : await createTaskSession(filepath, project);
    const session = host.session;
    const pending: Promise<void>[] = [];
    let initialized = false;
    const queued: unknown[] = [];
    const stopListening = (event: IpcMainEvent, message: unknown): void => {
        if (event.sender !== window.webContents) return;
        if (!initialized) { queued.push(message); return; }
        const command = parseWebviewCommand(message);
        if (!command) return;
        const operation = session.handle(command).catch(error => {
            if (!window.webContents.isDestroyed()) window.webContents.send(SCHEMATIC_EDITOR_HOST_MESSAGE_CHANNEL, {
                type: 'hostError', message: error instanceof Error ? error.message : String(error),
            });
        });
        pending.push(operation);
        void operation.finally(() => { const index = pending.indexOf(operation); if (index >= 0) pending.splice(index, 1); });
    };
    ipcMain.on(SCHEMATIC_EDITOR_RENDERER_MESSAGE_CHANNEL, stopListening);
    const unsubscribe = session.onEvent(event => {
        if (!window.webContents.isDestroyed()) window.webContents.send(SCHEMATIC_EDITOR_HOST_MESSAGE_CHANNEL, event);
    });
    const removeIpc = (): void => { ipcMain.removeListener(SCHEMATIC_EDITOR_RENDERER_MESSAGE_CHANNEL, stopListening); };
    window.once('closed', () => { removeIpc(); unsubscribe(); });

    await window.loadFile(path.join(__dirname, '..', 'assets', 'schematic', 'index.html'));
    try {
        await session.open(filepath);
        initialized = true;
        for (const message of queued.splice(0)) {
            const command = parseWebviewCommand(message);
            if (command && command.type !== 'ready') await session.handle(command);
        }
    } catch (error) {
        removeIpc();
        session.dispose();
        await host.dispose();
        if (!window.isDestroyed()) window.destroy();
        throw error;
    }

    let allowClose = false;
    let closing: Promise<void> | undefined;
    window.on('close', event => {
        if (allowClose) return;
        event.preventDefault();
        if (closing) return;
        session.dispose();
        closing = Promise.allSettled([...pending]).then(async () => {
            await host.dispose();
            if (!host.shouldKeepArtifacts()) await host.cleanupArtifacts();
        }).finally(() => {
            allowClose = true;
            if (!window.isDestroyed()) window.close();
        });
    });
    return window;
}
