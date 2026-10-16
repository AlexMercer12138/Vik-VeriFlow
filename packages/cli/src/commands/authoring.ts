import * as path from 'node:path';
import { readFile } from 'node:fs/promises';
import { applyArchDesignOperations, applyEditBatchAsync, editOperations, normalizeArchDesignDefinitionKeys } from '@veriflow/hdl-runtime/archDesign';
import { applyTaskEdit, createSimulationTask, parseSimulationTask } from '@veriflow/hdl-runtime/simulationTask';
import { serializeArchDesign, validateArchDesign } from '@veriflow/schematic-core/arch-design';
import { loadArchDesign, openProject, scanArchDesignModuleDefinitions } from './ad';
import { loadInterfaceProtocolCatalog } from '../runtime/interfaceProtocolLoader';
import { prepare, prepareSources } from './task';
import { emitDocument, emitText } from './artifacts';
import type { CommandOptions } from './project';
import type { CliEnvironment } from '../main';

export async function archApply(options: CommandOptions, env: CliEnvironment): Promise<number> {
    const loaded = await loadArchDesign(options, env);
    if (!loaded) return 1;
    const original = loaded.source;
    const catalog = await scanArchDesignModuleDefinitions(loaded, options, env, openProject(options, env));
    const protocols = await loadInterfaceProtocolCatalog(openProject(options, env)?.interfaceProtocolFiles ?? []);
    if (protocols.diagnostics.length) throw new Error(protocols.diagnostics.map(d => `${d.source}:${d.path} ${d.message}`).join('\n'));
    const operations = editOperations(JSON.parse(await readFile(path.resolve(env.cwd, options.ops!), 'utf8')), 'arch');
    const design = applyArchDesignOperations(normalizeArchDesignDefinitionKeys(loaded.design, catalog), operations, loaded.filepath, catalog.definitions);
    const validation = validateArchDesign(design, catalog.definitions, protocols.catalog);
    if (!validation.valid) throw new Error(validation.diagnostics.map(d => `${d.path} [${d.code}] ${d.message}`).join('\n'));
    return emitDocument(loaded.filepath, original, serializeArchDesign(design), options, env, [...catalog.inputs, ...protocols.inputs]);
}
export async function taskNew(options: CommandOptions, env: CliEnvironment): Promise<number> {
    const output = options.output ?? 'simulation.st';
    if (!output.toLowerCase().endsWith('.st')) throw new Error('Simulation task files must use .st');
    return emitDocument(undefined, undefined, JSON.stringify(createSimulationTask(output), null, 2) + '\n', { ...options, output }, env);
}
export async function taskApply(options: CommandOptions, env: CliEnvironment): Promise<number> {
    const source = path.resolve(env.cwd, options.task!), original = await readFile(source, 'utf8');
    const operations = editOperations(JSON.parse(await readFile(path.resolve(env.cwd, options.ops!), 'utf8')), 'task');
    const edited = await applyEditBatchAsync(parseSimulationTask(original), operations, async (task, edit) => {
        if (['addSourceInstance', 'addPreset', 'updatePreset', 'updateTaskSettings'].includes(edit.type)) return applyTaskEdit(task, [], edit);
        const prepared = await prepareSources(task, source, options, env);
        try { return applyTaskEdit(task, prepared.modules, edit); }
        finally { await prepared.dispose(); }
    });
    const { prepared } = await prepare(source, options, env, undefined, edited);
    try { return await emitDocument(source, original, JSON.stringify(edited, null, 2) + '\n', options, env, prepared.inputs); }
    finally { await prepared.dispose(); }
}
export async function taskTb(options: CommandOptions, env: CliEnvironment): Promise<number> {
    const source = path.resolve(env.cwd, options.task!), original = await readFile(source, 'utf8');
    const { prepared } = await prepare(source, options, env);
    try {
        const header = `// veriflow:task-source ${JSON.stringify(path.relative(options.output ? path.dirname(path.resolve(env.cwd, options.output)) : env.cwd, source).replace(/\\/g, '/'))}\n`;
        return await emitText(header + prepared.generatedTestbench.text, 'testbench', options, env, [{ path: source, text: original }, ...prepared.inputs ?? []], previous => previous.startsWith(header));
    } finally { await prepared.dispose(); }
}
