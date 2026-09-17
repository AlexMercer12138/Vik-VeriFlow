import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createSimulationRequest, ProjectStore } from '@veriflow/flow-core';
import { parseSimulationTask, type SimulationTaskDocument } from '@veriflow/hdl-runtime/simulationTask';
import type { CliEnvironment } from '../main';
import { loadInterfaceProtocolCatalog } from '../runtime/interfaceProtocolLoader';
import { prepareSimulationTaskWorkspace } from '@veriflow/hdl-runtime/simulationTaskWorkspace';
import { createCliSimulationBackends } from '../runtime/simulationBackends';
import type { CommandOptions } from './project';

async function readTask(filepath: string): Promise<SimulationTaskDocument> {
    if (path.extname(filepath).toLowerCase() !== '.st') throw new Error(`Simulation task files must use the .st extension: ${filepath}`);
    try { return parseSimulationTask(await readFile(filepath, 'utf8')); }
    catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new Error(`Simulation task not found: ${filepath}`);
        throw error;
    }
}

async function prepare(taskPath: string, options: CommandOptions, environment: CliEnvironment, signal?: AbortSignal) {
    const task = await readTask(taskPath), store = new ProjectStore();
    const project = options.project ? store.open(path.resolve(environment.cwd, options.project))
        : store.create(path.basename(taskPath, '.st'), path.dirname(taskPath));
    if (!options.project) project.simulator = 'builtin';
    if (!['builtin', 'custom'].includes(project.simulator)) throw new Error('Simulation Task simulator must be builtin or custom');
    if (project.simulator === 'custom' && (!project.simulators.custom?.compileCmd?.trim() || !project.simulators.custom?.runCmd?.trim())) {
        throw new Error('Custom simulation requires compile and run commands in the project');
    }
    const protocols = await loadInterfaceProtocolCatalog(project.interfaceProtocolFiles);
    if (protocols.diagnostics.length) throw new Error(protocols.diagnostics.map(item => `${item.source}:${item.path} [${item.code}] ${item.message}`).join('\n'));
    const prepared = await prepareSimulationTaskWorkspace(task, taskPath, signal, {
        workspaceRoot: project.rootDir,
        interfaceCatalog: protocols.catalog,
        includeDirs: project.libDirs.map(directory => path.resolve(project.rootDir, directory)),
        defines: Object.fromEntries(Object.entries(project.defines).filter(([, value]) => value !== false).map(([key, value]) => [key, value === true ? true : String(value)])),
    });
    return { prepared, project };
}

export async function validateTask(options: CommandOptions, environment: CliEnvironment): Promise<number> {
    const taskPath = path.resolve(environment.cwd, options.task!);
    const { prepared } = await prepare(taskPath, options, environment);
    try {
        environment.stdout(`${path.basename(taskPath, '.st')}: testbench validated.\n`);
        return 0;
    } finally { await prepared.dispose(); }
}

/** One task creates one TB and one backend execution; completion is not verification. */
export async function runTask(options: CommandOptions, environment: CliEnvironment): Promise<number> {
    const taskPath = path.resolve(environment.cwd, options.task!);
    const controller = new AbortController(), interrupt = () => controller.abort();
    process.on('SIGINT', interrupt);
    try {
        const { prepared, project } = await prepare(taskPath, options, environment, controller.signal);
        let artifactDirectory: string | undefined, preserveWave = false;
        try {
            const generatedPath = path.join(prepared.temporaryDirectory, `${prepared.generatedTestbench.moduleName}.v`);
            await writeFile(generatedPath, prepared.generatedTestbench.text, { flag: 'wx' });
            const waveform = prepared.task.settings.waveform;
            if (waveform.enabled) artifactDirectory = await mkdtemp(path.join(os.tmpdir(), 'veriflow-st-wave-'));
            const registry = createCliSimulationBackends(project, { ...environment.simulationBackendOptions, commandExecutor: environment.commandExecutor });
            const backend = await registry.resolve(project.simulator);
            const sourceFiles = new Set(prepared.additionalSources.map(file => path.resolve(file)));
            const execution = await backend.compileAndRun(createSimulationRequest({
                cwd: prepared.temporaryDirectory,
                files: [generatedPath, ...prepared.additionalSources],
                includeFiles: prepared.inputFiles.filter(file => /\.(?:v|sv|vh|svh)$/i.test(file) && !sourceFiles.has(path.resolve(file))),
                runtimeFiles: prepared.runtimeFiles,
                includeDirs: prepared.includeDirs,
                defines: prepared.defines,
                topModule: prepared.generatedTestbench.moduleName,
                output: path.join(prepared.temporaryDirectory, 'simulation.out'),
                signal: controller.signal,
                artifacts: artifactDirectory ? [{ kind: 'vcd', path: waveform.filename,
                    destination: path.join(artifactDirectory, waveform.filename), required: false }] : [],
            }));
            if (execution.stdout) environment.stdout(execution.stdout.endsWith('\n') ? execution.stdout : `${execution.stdout}\n`);
            if (execution.stderr) environment.stderr(execution.stderr.endsWith('\n') ? execution.stderr : `${execution.stderr}\n`);
            const wave = execution.artifacts.find(artifact => artifact.kind === 'vcd' && artifact.written);
            if (wave) { preserveWave = true; environment.stdout(`Waveform: ${wave.destination}\n`); }
            if (controller.signal.aborted || execution.cause?.code === 'ABORTED') {
                environment.stderr(`${path.basename(taskPath, '.st')}: simulation cancelled.\n`); return 1;
            }
            if (!execution.success || execution.exitCode !== 0) {
                environment.stderr(`${path.basename(taskPath, '.st')}: simulation failed (exit=${execution.exitCode}).\n`); return 1;
            }
            environment.stdout(`${path.basename(taskPath, '.st')}: simulation completed.\n`);
            return 0;
        } finally {
            await prepared.dispose();
            if (artifactDirectory && !preserveWave) await rm(artifactDirectory, { recursive: true, force: true });
        }
    } finally { process.off('SIGINT', interrupt); }
}
