import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createSimulationRequest, type SimulatorBackend } from '@veriflow/flow-core';
import type { SimulationExecution } from '@veriflow/flow-core/simulation';
import type { PreparedSimulationTask } from '../simulationTaskWorkspace';

export interface SimulationTaskRunOptions {
    signal?: AbortSignal;
    artifactDirectory?: string;
    requireWaveform?: boolean;
}

export async function runSimulationTask(
    prepared: PreparedSimulationTask,
    backend: SimulatorBackend,
    options: SimulationTaskRunOptions = {},
): Promise<SimulationExecution> {
    options.signal?.throwIfAborted();
    const generatedPath = path.join(prepared.temporaryDirectory, `${prepared.generatedTestbench.moduleName}.v`);
    await writeFile(generatedPath, prepared.generatedTestbench.text, { flag: 'wx' });
    const sources = [generatedPath, ...prepared.additionalSources];
    const stagedFiles = new Set([...sources, ...prepared.runtimeFiles].map(normalizePath));
    const includeFiles = prepared.inputFiles.filter(file => /\.(?:v|sv|vh|svh)$/i.test(file)
        && !stagedFiles.has(normalizePath(file)));
    const artifacts = [];
    if (prepared.task.settings.waveform.enabled) {
        const artifactDirectory = options.artifactDirectory ?? prepared.temporaryDirectory;
        await mkdir(artifactDirectory, { recursive: true });
        artifacts.push({
            kind: 'vcd' as const,
            path: prepared.task.settings.waveform.filename,
            destination: path.join(artifactDirectory, path.basename(prepared.task.settings.waveform.filename)),
            required: options.requireWaveform ?? false,
        });
    }
    return backend.compileAndRun(createSimulationRequest({
        files: sources,
        includeFiles,
        runtimeFiles: prepared.runtimeFiles,
        includeDirs: prepared.includeDirs,
        defines: prepared.defines,
        topModule: prepared.generatedTestbench.moduleName,
        output: path.join(prepared.temporaryDirectory, 'simulation.out'),
        cwd: prepared.temporaryDirectory,
        signal: options.signal,
        artifacts,
    }));
}

function normalizePath(filepath: string): string {
    const absolute = path.resolve(filepath);
    return process.platform === 'win32' ? absolute.toLowerCase() : absolute;
}
