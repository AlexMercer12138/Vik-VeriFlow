import { existsSync, statSync } from 'node:fs';
import path from 'node:path';
import type { CliEnvironment } from '../main';
import type { CommandOptions } from './project';

function editorTarget(options: CommandOptions, environment: CliEnvironment, extension: '.ad' | '.st'): string {
    const filepath = path.resolve(environment.cwd, options.design ?? options.task!);
    if (path.extname(filepath).toLowerCase() !== extension) {
        throw new Error(`Expected a ${extension} file: ${filepath}`);
    }
    if (!existsSync(filepath) || !statSync(filepath).isFile()) {
        throw new Error(`${extension === '.ad' ? 'Arch Design' : 'Simulation Task'} file not found: ${filepath}`);
    }
    if (options.project) {
        const project = path.resolve(environment.cwd, options.project);
        if (!existsSync(project) || !statSync(project).isFile()) throw new Error(`Project file not found: ${project}`);
        options.project = project;
    }
    return filepath;
}

export async function archUi(options: CommandOptions, environment: CliEnvironment): Promise<number> {
    const filepath = editorTarget(options, environment, '.ad');
    if (!environment.workbenchEditorLauncher) throw new Error('Arch Design editor launcher is unavailable.');
    await environment.workbenchEditorLauncher.openArch(filepath, {
        project: options.project,
        lib: options.lib?.split(',').filter(Boolean).map(item => path.resolve(environment.cwd, item)),
    });
    return 0;
}

export async function taskUi(options: CommandOptions, environment: CliEnvironment): Promise<number> {
    const filepath = editorTarget(options, environment, '.st');
    if (!environment.workbenchEditorLauncher) throw new Error('Simulation Task editor launcher is unavailable.');
    await environment.workbenchEditorLauncher.openTask(filepath, { project: options.project });
    return 0;
}
