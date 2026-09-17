import { mkdtemp, readFile, writeFile, rm, mkdir, copyFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { canonicalizeSourceUri } from '@veriflow/hdl-core/preprocessor';
import { exportArchDesignRtl, parseArchDesignText, type ArchDesign } from '@veriflow/schematic-core/arch-design';
import type { InterfaceProtocolCatalog } from '@veriflow/schematic-core/interfaces';
import { createArchDesignDefinitionCatalog, selectArchDesignDefinitionKey } from './archDesignDefinitionReference';
import { DependencyAnalyzer } from './dependencyAnalyzer';
import { NodeWorkspaceHost, type ParserRuntimePaths } from './nodeWorkspaceHost';
import type { HdlDefinitionSummary } from './workspaceIndexTypes';
import { parseSimulationTask, generateTestbench, deriveTaskModuleName, type SimulationTaskDocument, type TaskModuleDefinition, type GeneratedTestbench } from './simulationTask';

export interface TaskWorkspaceOptions {
    parserPaths?: ParserRuntimePaths;
    workspaceRoot?: string;
    interfaceCatalog?: InterfaceProtocolCatalog;
    includeDirs?: string[];
    defines?: Record<string, string | true>;
}
export interface PreparedSimulationTask {
    temporaryDirectory: string;
    dispose(): Promise<void>;
    task: SimulationTaskDocument;
    modules: TaskModuleDefinition[];
    additionalSources: string[];
    inputFiles: string[];
    runtimeFiles: string[];
    includeDirs: string[];
    defines: Record<string, string | true>;
    generatedTestbench: GeneratedTestbench;
}

function normalizedPath(filepath: string): string {
    const resolved = path.resolve(filepath);
    return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function uniquePaths(files: readonly string[]): string[] {
    return [...new Map(files.map(file => [normalizedPath(file), path.resolve(file)])).values()];
}

function literalIncludes(text: string): string[] {
    const uncommented = text.replace(/"(?:\\.|[^"\\])*"|\/\/[^\r\n]*|\/\*[\s\S]*?\*\//g,
        token => token.startsWith('/') ? token.replace(/[^\r\n]/g, ' ') : token);
    return [...uncommented.matchAll(/^\s*`include[ \t]+"([^"\r\n]+)"/gm)]
        .map(match => match[1]);
}

async function resolveIncludeClosure(
    sourceFiles: readonly string[],
    initialIncludes: readonly string[],
    root: string,
    includeDirs: readonly string[],
    signal?: AbortSignal,
): Promise<string[]> {
    const sources = uniquePaths(sourceFiles);
    const closure = new Map(uniquePaths(initialIncludes).map(file => [normalizedPath(file), file]));
    const pending = uniquePaths([...sources, ...closure.values()]);
    const searchDirs = uniquePaths([root, ...sources.map(file => path.dirname(file)), ...includeDirs]);
    const visited = new Set<string>();
    while (pending.length) {
        signal?.throwIfAborted();
        const file = pending.pop()!;
        const key = normalizedPath(file);
        if (visited.has(key)) continue;
        visited.add(key);
        if (visited.size > 10_000) throw new Error('Input include closure exceeds 10000 files.');
        for (const literal of literalIncludes(await readFile(file, 'utf8'))) {
            const candidates = uniquePaths([
                path.dirname(file),
                ...searchDirs,
            ].map(directory => path.resolve(directory, literal)));
            let child: string | undefined;
            for (const candidate of candidates) {
                try {
                    await readFile(candidate);
                    child = candidate;
                    break;
                } catch (error) {
                    if (!['ENOENT', 'ENOTDIR'].includes(
                        (error as NodeJS.ErrnoException).code ?? '',
                    )) throw error;
                }
            }
            if (child && !closure.has(normalizedPath(child))) {
                closure.set(normalizedPath(child), child);
                pending.push(child);
            }
        }
    }
    return [...closure.values()];
}

function sourcePath(uri: string): string {
    const parsed = new URL(uri);
    if (parsed.protocol !== 'file:') throw new Error(`Unsupported HDL source URI: ${uri}`);
    return fileURLToPath(parsed);
}

async function stageRuntimeInputs(files: readonly string[], root: string, container: string, signal?: AbortSignal): Promise<{ cwd: string; staged: string[]; originals: string[] }> {
    const originals = new Set<string>();
    for (const file of files) {
        signal?.throwIfAborted();
        const text = (await readFile(file, 'utf8')).replace(/"(?:\\.|[^"\\])*"|\/\/[^\r\n]*|\/\*[\s\S]*?\*\//g,
            token => token.startsWith('/') ? token.replace(/[^\r\n]/g, ' ') : token);
        const pattern = /\$(?:readmem[hb]\s*\(\s*"([^"\r\n]+)"|fopen\s*\(\s*"([^"\r\n]+)"\s*,\s*"r[b+]*")/g;
        for (const match of text.matchAll(pattern)) {
            const literal = match[1] ?? match[2];
            if (path.isAbsolute(literal)) throw new Error(`HDL runtime input must be relative to the task: ${literal}`);
            const actual = path.resolve(root, literal);
            await readFile(actual); // Missing data is an input error, never an empty simulated memory.
            originals.add(actual);
        }
    }
    if (!originals.size) return { cwd: container, staged: [], originals: [] };
    let common = root;
    for (const file of originals) {
        while (path.relative(common, file).startsWith(`..${path.sep}`)) {
            const parent = path.dirname(common);
            if (parent === common) throw new Error('Runtime inputs must be on the task filesystem volume');
            common = parent;
        }
    }
    const runtimeRoot = path.join(container, 'runtime');
    const cwd = path.join(runtimeRoot, path.relative(common, root));
    await mkdir(cwd, { recursive: true });
    const staged: string[] = [];
    for (const file of originals) {
        const target = path.join(runtimeRoot, path.relative(common, file));
        await mkdir(path.dirname(target), { recursive: true });
        await copyFile(file, target);
        staged.push(target);
    }
    return { cwd, staged, originals: [...originals] };
}

function resolvedDesign(design: ArchDesign, catalog: ReturnType<typeof createArchDesignDefinitionCatalog>): ArchDesign {
    let changed = false;
    const instances = design.instances.map(instance => {
        const definitionKey = selectArchDesignDefinitionKey(
            instance.definitionKey,
            instance.module,
            catalog,
        );
        if (definitionKey === undefined || definitionKey === instance.definitionKey) return instance;
        changed = true;
        return { ...instance, definitionKey };
    });
    return changed ? { ...design, instances } : design;
}

function moduleDefinition(root: string, definition: HdlDefinitionSummary): TaskModuleDefinition {
    return {
        source: path.relative(root, sourcePath(definition.uri)).replace(/\\/g, '/'),
        module: definition.name,
        ports: definition.ports.map(port => ({
            name: port.name,
            direction: port.direction,
            width: port.width.kind === 'known'
                ? port.width.bits
                : port.width.kind === 'symbolic'
                    ? port.width.expression
                    : undefined,
        })),
        parameters: definition.parameters.map(parameter => ({
            name: parameter.name,
            defaultValue: parameter.defaultExpression,
        })),
    };
}

/** Resolve exact source identities and use the same generator for export and execution. */
export async function prepareSimulationTaskWorkspace(
    inputTask: SimulationTaskDocument, inputTaskPath: string,
    signal?: AbortSignal, options: TaskWorkspaceOptions = {},
): Promise<PreparedSimulationTask> {
    signal?.throwIfAborted();
    const task = parseSimulationTask(JSON.stringify(inputTask));
    const taskPath = path.resolve(inputTaskPath), root = path.dirname(taskPath);
    const sources = task.instances.flatMap(i => 'source' in i ? [path.resolve(root, i.source.path)] : []);
    const roots = uniquePaths([root, options.workspaceRoot ?? root, ...sources.map(file => path.dirname(file)), ...(options.includeDirs ?? [])]);
    const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'veriflow-st-'));
    const dispose = () => rm(temporaryDirectory, { recursive: true, force: true });
    let host = new NodeWorkspaceHost(roots, options.defines, options.parserPaths);
    let succeeded = false;
    try {
        await host.scan(signal);
        const initialDefinitions = host.index.getAllDefinitions('module');
        const catalog = createArchDesignDefinitionCatalog(initialDefinitions, canonicalizeSourceUri(pathToFileURL(path.resolve(options.workspaceRoot ?? root)).toString()));
        const wrappers = new Map<string, { actual: string; module: string; text: string }>();
        const bindings: Record<string, string> = {};
        const bind = (name: string, key: string) => {
            if (bindings[name] && bindings[name] !== key) throw new Error(`Duplicate module ${name} is referenced from different sources`);
            bindings[name] = key;
        };
        for (const instance of task.instances) {
            signal?.throwIfAborted();
            if (!('source' in instance) || instance.source.kind !== 'ad' || wrappers.has(instance.source.path)) continue;
            const designPath = path.resolve(root, instance.source.path);
            const parsed = parseArchDesignText(await readFile(designPath, 'utf8'));
            if (parsed.status !== 'editable') throw new Error(`Fix the Architecture Design before simulation: ${instance.source.path}`);
            const design = resolvedDesign(parsed.design, catalog);
            for (const child of design.instances) {
                if (child.definitionKey) {
                    const runtimeKey = catalog.runtimeKey(child.definitionKey);
                    if (runtimeKey) bind(child.module, runtimeKey);
                }
            }
            const output = exportArchDesignRtl(design, catalog.definitions, { language: 'verilog', sourcePath: instance.source.path, interfaceCatalog: options.interfaceCatalog });
            if (output.status !== 'generated') throw new Error(output.diagnostics.map(d => d.message).join('\n'));
            const actual = path.join(temporaryDirectory, `architecture_${wrappers.size}.v`);
            await writeFile(actual, output.text);
            wrappers.set(instance.source.path, { actual, module: design.module, text: output.text });
        }
        if (wrappers.size) {
            await host.dispose();
            host = new NodeWorkspaceHost([...roots, temporaryDirectory], options.defines, options.parserPaths);
            await host.scan(signal);
        }
        const definitions = host.index.getAllDefinitions('module');
        const targets: HdlDefinitionSummary[] = [];
        const modules: TaskModuleDefinition[] = [];
        for (const instance of task.instances) {
            if (!('source' in instance)) continue;
            const wrapper = wrappers.get(instance.source.path);
            const actual = wrapper?.actual ?? path.resolve(root, instance.source.path);
            const name = instance.source.kind === 'hdl' ? instance.source.module : wrapper!.module;
            const matches = definitions.filter(d => d.name === name && normalizedPath(sourcePath(d.uri)) === normalizedPath(actual));
            if (matches.length !== 1) throw new Error(`Module ${name} must resolve to exactly one definition in ${instance.source.path}`);
            const target = matches[0];
            bind(name, target.key);
            if (!targets.some(d => d.key === target.key)) targets.push(target);
            if (modules.some(d => d.source === instance.source.path && d.module === name)) continue;
            modules.push({ ...moduleDefinition(root, target), source: instance.source.path,
                definitionKey: target.key, ...(wrapper ? { generatedText: wrapper.text } : {}) });
        }
        const dependencyFiles = new Set<string>();
        for (const target of targets) {
            const result = new DependencyAnalyzer(host.index).resolve(target.key, bindings);
            if (result.missingModules.length) throw new Error(`Module ${target.name} has missing dependencies: ${result.missingModules.join(', ')}`);
            if (Object.keys(result.ambiguousModules).length) throw new Error(`Module ${target.name} has ambiguous dependencies: ${Object.keys(result.ambiguousModules).join(', ')}`);
            result.files.forEach(file => dependencyFiles.add(path.resolve(file)));
        }
        const includes: string[] = [];
        for (const file of dependencyFiles) {
            const summary = host.index.getFile(canonicalizeSourceUri(pathToFileURL(file).toString()));
            if (summary?.unresolvedIncludes?.length) throw new Error(`Unresolved HDL includes: ${summary.unresolvedIncludes.map(i => i.rawPath).join(', ')}`);
            includes.push(...(summary?.includeUris ?? []).map(sourcePath));
        }
        const includedKeys = new Set(includes.map(normalizedPath));
        const generatedKeys = new Set([...wrappers.values()].map(w => normalizedPath(w.actual)));
        const additionalSources = uniquePaths([...dependencyFiles]).filter(file => !includedKeys.has(normalizedPath(file)) && !generatedKeys.has(normalizedPath(file)));
        const includeDirs = uniquePaths([...roots, ...additionalSources.map(file => path.dirname(file)), ...includes.map(file => path.dirname(file))]);
        const includeClosure = await resolveIncludeClosure(additionalSources, includes, root, includeDirs, signal);
        const runtime = await stageRuntimeInputs(uniquePaths([...additionalSources, ...includeClosure]), root, temporaryDirectory, signal);
        const inputFiles = uniquePaths([taskPath, ...sources, ...additionalSources, ...includeClosure, ...runtime.originals]);
        const generatedTestbench = generateTestbench(task, deriveTaskModuleName(taskPath), modules, options.interfaceCatalog);
        signal?.throwIfAborted();
        succeeded = true;
        return { task, modules, additionalSources, inputFiles, runtimeFiles: runtime.staged, includeDirs, defines: options.defines ?? {}, generatedTestbench, temporaryDirectory: runtime.cwd, dispose };
    } finally {
        await host.dispose();
        if (!succeeded) await dispose();
    }
}
