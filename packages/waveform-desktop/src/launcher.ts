import { spawn } from 'node:child_process';
import path from 'node:path';

export interface WaveformElectronInvocation {
    executable: string;
    appEntry: string;
    args: string[];
}

export interface WorkbenchEditorLauncher {
    openArch(filepath: string, options?: { project?: string; lib?: string[] }): Promise<void>;
    openTask(filepath: string, options?: { project?: string }): Promise<void>;
}

function launch(invocation: WaveformElectronInvocation): Promise<void> {
    return new Promise((resolve, reject) => {
        const child = spawn(invocation.executable, invocation.args, {
            detached: true,
            stdio: 'ignore',
            windowsHide: true,
        });
        child.once('error', reject);
        child.once('spawn', () => {
            child.unref();
            resolve();
        });
    });
}

export function schematicEditorElectronInvocation(
    source: string,
    kind: 'arch-design' | 'simulation-task',
    options: { project?: string; lib?: string[] } = {},
): WaveformElectronInvocation {
    const electronPath = require('electron') as unknown as string;
    const appEntry = path.join(__dirname, 'main.js');
    return {
        executable: electronPath,
        appEntry,
        args: [appEntry, '--schematic-editor', path.resolve(source), `--kind=${kind}`,
            ...Object.entries(options).filter(([, value]) => value !== undefined)
                .flatMap(([key, value]) => ['--' + key, Array.isArray(value) ? value.join(',') : value as string])],
    };
}

export function launchSchematicEditor(
    source: string,
    kind: 'arch-design' | 'simulation-task',
    options: { project?: string; lib?: string[] } = {},
): Promise<void> {
    return launch(schematicEditorElectronInvocation(source, kind, options));
}

export function launchArchDesignEditor(source: string, options: { project?: string; lib?: string[] } = {}): Promise<void> {
    return launchSchematicEditor(source, 'arch-design', options);
}

export function launchSimulationTaskEditor(source: string, options: { project?: string } = {}): Promise<void> {
    return launchSchematicEditor(source, 'simulation-task', options);
}

export function boardLibraryElectronInvocation(configPath: string, options: {source?:string;module?:string;project?:string;lib?:string;config?:string} = {}): WaveformElectronInvocation {
    const electronPath = require('electron') as unknown as string;
    const appEntry = path.join(__dirname, 'main.js');
    return { executable: electronPath, appEntry, args: [appEntry, '--board-library', path.resolve(configPath), ...Object.entries(options).filter(([,v])=>!!v).flatMap(([k,v])=>['--'+k,v!])] };
}

export function waveformElectronInvocation(source: string): WaveformElectronInvocation {
    const electronPath = require('electron') as unknown as string;
    const appEntry = path.join(__dirname, 'main.js');
    return {
        executable: electronPath as unknown as string,
        appEntry,
        args: [appEntry, '--waveform', path.resolve(source)],
    };
}

export function launchWaveformWindow(source: string): Promise<void> {
    return launch(waveformElectronInvocation(source));
}

export function launchBoardLibraryWindow(configPath: string, options: {source?:string;module?:string;project?:string;lib?:string;config?:string} = {}): Promise<void> {
    return launch(boardLibraryElectronInvocation(configPath, options));
}
