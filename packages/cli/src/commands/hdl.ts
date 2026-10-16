import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createSimulationRequest, hdlTemplates, ProjectStore, renderHdlTemplate } from '@veriflow/flow-core';
import { DEFAULT_HDL_ALIGNMENT_COLUMNS, formatHdl } from '@veriflow/hdl-runtime';
import { NodeWorkspaceHost } from '@veriflow/hdl-runtime/nodeWorkspaceHost';
import { DependencyAnalyzer } from '@veriflow/hdl-runtime/dependencyAnalyzer';
import { snapshotIndexedInputs } from '@veriflow/hdl-runtime/archDesign';
import { effectiveModuleInstanceIdentifier, formatModuleInstantiation, defaultTestbenchConfig, TestbenchGenerator, type TbConfig } from '@veriflow/hdl-runtime/hdl';
import type { HdlDefinitionSummary } from '@veriflow/hdl-runtime/workspaceIndexTypes';
import { createCliSimulationBackends } from '../runtime/simulationBackends';
import { emitText, result } from './artifacts';
import type { CommandOptions } from './project';
import type { CliEnvironment } from '../main';

function moduleInFile(host: NodeWorkspaceHost, source: string, name?: string): HdlDefinitionSummary {
    const identity = (file: string) => process.platform === 'win32' ? path.resolve(file).toLowerCase() : path.resolve(file);
    const modules = host.index.getAllDefinitions('module').filter(item => identity(fileURLToPath(item.uri)) === identity(source) && (!name || item.name === name));
    if (modules.length !== 1) throw new Error(modules.length ? 'Multiple modules in this file; use --module' : `Module not found in ${source}${name ? ': ' + name : ''}`);
    return modules[0];
}

export async function selectFileModule(source: string, name?: string) {
    const host = new NodeWorkspaceHost([path.dirname(source)]);
    try {
        await host.scan();
        const module = moduleInFile(host, source, name);
        return { module, inputs: await snapshotIndexedInputs(host.index, [module.uri]) };
    }
    finally { await host.dispose(); }
}

export async function hdlCommand(action: string, options: CommandOptions, env: CliEnvironment): Promise<number> {
    if (action === 'template') {
        if (options.list) {
            if (options.json) result(options, env, { templates: hdlTemplates });
            else for (const template of hdlTemplates) env.stdout(`${template.id}\t${template.description}\n`);
            return 0;
        }
        if (!options.template) throw new Error('Choose --template <id> or --list');
        return emitText(renderHdlTemplate(options.template), 'template', options, env);
    }
    const source = path.resolve(env.cwd, options.file!);
    if (!/\.(v|sv)$/i.test(source)) throw new Error('Choose a .v or .sv file');
    const original = await readFile(source, 'utf8'), inputs = [{ path: source, text: original }];
    if (action === 'format') {
        if (options.inPlace && options.output) throw new Error('Choose --in-place or --output');
        if (options.check && (options.inPlace || options.output)) throw new Error('--check cannot write output');
        const text = await formatHdl(original, options.alignment === 'adaptive' ? { indentSize: DEFAULT_HDL_ALIGNMENT_COLUMNS[0] } : { alignmentColumns: DEFAULT_HDL_ALIGNMENT_COLUMNS });
        if (options.check) {
            if (options.json) result(options, env, { formatted: text === original, diagnostics: [] });
            else if (text !== original) env.stderr(`Formatting differs: ${source}\n`);
            return text === original ? 0 : 1;
        }
        return emitText(text, 'hdl', { ...options, output: options.inPlace ? source : options.output }, env, inputs, previous => !!options.inPlace && previous === original);
    }
    if (action === 'run') return runFile(source, options, env);
    const selected = await selectFileModule(source, options.module);
    const module = selected.module;
    inputs.push(...selected.inputs);
    if (action === 'instantiate') return emitText(formatModuleInstantiation({
        moduleName: module.name, instanceName: effectiveModuleInstanceIdentifier(module.name, options.instance),
        parameters: module.parameters.map(p => ({ name: p.name, value: p.defaultExpression ?? p.name })),
        ports: module.ports.map(p => ({ name: p.name, value: p.name })),
    }) + '\n', 'instantiation', options, env, inputs);
    let config: TbConfig;
    if (options.config) {
        const file = path.resolve(env.cwd, options.config), text = await readFile(file, 'utf8');
        inputs.push({ path: file, text }); config = JSON.parse(text);
    } else config = defaultTestbenchConfig(module, options.name);
    const header = `// veriflow:hdl-source ${JSON.stringify(source.replace(/\\/g, '/'))}\n`;
    return emitText(header + new TestbenchGenerator().render(config), 'testbench', options, env, inputs, previous => previous.startsWith(header));
}

async function runFile(source: string, options: CommandOptions, env: CliEnvironment): Promise<number> {
    const project = options.project ? new ProjectStore().open(path.resolve(env.cwd, options.project)) : new ProjectStore().create(path.basename(source), path.dirname(source));
    if (options.sim) project.simulator = options.sim;
    const roots = [...new Set([path.dirname(source), project.rootDir, ...project.libDirs, ...(options.lib ? options.lib.split(',').map(p => path.resolve(env.cwd, p)) : [])])];
    const host = new NodeWorkspaceHost(roots, Object.fromEntries(Object.entries(project.defines).filter(([, value]) => value !== false).map(([key, value]) => [key, value === true ? true : String(value)])));
    const controller = new AbortController(), interrupt = () => controller.abort();
    let temporary: string | undefined;
    process.on('SIGINT', interrupt);
    try {
        await host.scan(controller.signal);
        const module = moduleInFile(host, source, options.module);
        const dependencies = new DependencyAnalyzer(host.index).resolve(module.key);
        if (dependencies.missingModules.length || Object.keys(dependencies.ambiguousModules).length) throw new Error(`Unresolved HDL dependencies: ${JSON.stringify({ missing: dependencies.missingModules, ambiguous: dependencies.ambiguousModules })}`);
        const sourceText = await readFile(source, 'utf8');
        const uncommented = sourceText.replace(/"(?:\\.|[^"\\])*"|\/\/[^\r\n]*|\/\*[\s\S]*?\*\//g, token => token.startsWith('/') ? ' ' : token);
        const dumpfile = /\$dumpfile\s*\(\s*"([^"\r\n]+)"/.exec(uncommented)?.[1];
        const waveFile = path.resolve(path.dirname(source), options.waveOutput ?? dumpfile ?? `${module.name.replace(/[^A-Za-z0-9_$]/g, '_')}.vcd`);
        if (options.dryRun) { result(options, env, { diagnostics: [], topModule: module.name, files: dependencies.files, waveform: waveFile }); return 0; }
        temporary = await mkdtemp(path.join(os.tmpdir(), 'veriflow-hdl-'));
        const registry = createCliSimulationBackends(project, { ...env.simulationBackendOptions, commandExecutor: env.commandExecutor });
        const execution = await registry.run(project.simulator, createSimulationRequest({
            files: dependencies.files, runtimeFiles: project.simulationFiles, includeDirs: roots, defines: project.defines,
            cwd: path.dirname(source), topModule: module.name, output: path.join(temporary, 'simulation.out'), signal: controller.signal, timeoutMs: 300_000,
            artifacts: [{ kind: 'vcd', path: dumpfile ?? path.basename(waveFile), destination: waveFile, required: false }],
        }));
        if (options.json) result(options, env, { execution });
        else {
            if (execution.stdout) env.stdout(execution.stdout);
            if (execution.stderr) env.stderr(execution.stderr);
            env.stdout(`Simulation ${execution.success ? 'completed' : 'failed'} (exit=${execution.exitCode}).\n`);
            for (const artifact of execution.artifacts) if (artifact.written) env.stdout(`Waveform: ${artifact.destination}\n`);
        }
        return execution.success && !controller.signal.aborted ? 0 : 1;
    } finally {
        process.off('SIGINT', interrupt);
        await host.dispose();
        if (temporary) await rm(temporary, { recursive: true, force: true });
    }
}
