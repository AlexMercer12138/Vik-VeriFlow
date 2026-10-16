import { checkArtifactPlan, snapshotIndexedInputs, prepareArchDesignBuild, publishArtifactPlan } from '@veriflow/hdl-runtime/archDesign';
import { existsSync, realpathSync, statSync } from 'node:fs';
import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
    GlobalConfigStore,
    ProjectStore,
    type Project,
} from '@veriflow/flow-core';
import { canonicalizeSourceUri } from '@veriflow/hdl-core/preprocessor';
import {
    createArchDesignDefinitionCatalog,
    selectArchDesignDefinitionKey,
    type ArchDesignDefinitionCatalog,
} from '@veriflow/hdl-runtime/archDesignDefinitionReference';
import {
    createEmptyArchDesignText,
    exportArchDesignRtl,
    parseArchDesignText,
    validateArchDesign,
    type ArchDesign,
    type ArchDesignDiagnostic,
    type ArchDesignLanguage,
} from '@veriflow/schematic-core/arch-design';

import type { CommandEnvironment, CommandOptions } from './project';
import { publishGeneratedFileAtomic } from '../runtime/atomicGeneratedFile';
import {
    loadInterfaceProtocolCatalog,
    type InterfaceProtocolFileDiagnostic,
} from '../runtime/interfaceProtocolLoader';
import { NodeWorkspaceHost } from '@veriflow/hdl-runtime/nodeWorkspaceHost';

type LoadedArchDesign = {
    filepath: string;
    displayPath: string;
    design: ArchDesign;
    source: string;
};

function normalizePathSeparators(filepath: string): string {
    return filepath.replace(/\\/g, '/');
}

function canonicalFileUri(filepath: string): string {
    return canonicalizeSourceUri(pathToFileURL(filepath).toString());
}

async function canonicalPhysicalEntryUri(filepath: string): Promise<string | undefined> {
    let realParent: string;
    try {
        realParent = await realpath(path.dirname(filepath));
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
        throw error;
    }
    return canonicalFileUri(path.join(realParent, path.basename(filepath)));
}

function displayPath(filepath: string, cwd: string): string {
    const relative = path.relative(cwd, filepath);
    const isInsideCwd = relative === '' || (
        relative !== '..'
        && !relative.startsWith(`..${path.sep}`)
        && !path.isAbsolute(relative)
    );
    return normalizePathSeparators(isInsideCwd ? relative || '.' : filepath);
}

export async function adNew(
    options: CommandOptions,
    environment: CommandEnvironment
): Promise<number> {
    const text = createEmptyArchDesignText(options.module!);
    const requested = options.output ?? `${options.module}.ad`;
    const output = requested.toLowerCase().endsWith('.ad')
        ? requested
        : `${requested}.ad`;
    const filepath = path.resolve(environment.cwd, output);
    await mkdir(path.dirname(filepath), { recursive: true });
    try {
        await writeFile(filepath, text, { encoding: 'utf8', flag: 'wx' });
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
            throw new Error(
                `Arch Design already exists: ${displayPath(filepath, environment.cwd)}`
            );
        }
        throw error;
    }
    environment.stdout(
        `Arch Design created: ${displayPath(filepath, environment.cwd)}\n`
    );
    return 0;
}

function printDiagnostics(
    environment: CommandEnvironment,
    designPath: string,
    diagnostics: readonly ArchDesignDiagnostic[]
): void {
    for (const diagnostic of diagnostics) {
        environment.stderr(
            `${designPath}:${diagnostic.path} [${diagnostic.code}] ${diagnostic.message}\n`
        );
    }
}

function printInterfaceProtocolDiagnostics(
    environment: CommandEnvironment,
    diagnostics: readonly InterfaceProtocolFileDiagnostic[]
): void {
    for (const diagnostic of diagnostics) {
        environment.stderr(
            `${displayPath(diagnostic.source, environment.cwd)}:${diagnostic.path} `
            + `[${diagnostic.code}] ${diagnostic.message}\n`
        );
    }
}

export function openProject(
    options: CommandOptions,
    environment: CommandEnvironment
): Project | undefined {
    if (options.project === undefined) return undefined;
    const projectPath = path.resolve(environment.cwd, options.project);
    if (!existsSync(projectPath)) {
        throw new Error(`Project file not found: ${options.project}`);
    }
    return new ProjectStore().open(projectPath);
}

export async function loadArchDesign(
    options: CommandOptions,
    environment: CommandEnvironment
): Promise<LoadedArchDesign | undefined> {
    const filepath = path.resolve(environment.cwd, options.design!);
    const shownPath = displayPath(filepath, environment.cwd);
    let source: string;
    try {
        source = await readFile(filepath, 'utf8');
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
            throw new Error(`Arch Design file not found: ${shownPath}`);
        }
        throw error;
    }

    const parsed = parseArchDesignText(source);
    if (parsed.status === 'invalid') {
        printDiagnostics(environment, shownPath, parsed.diagnostics);
        return undefined;
    }
    if (parsed.status === 'unsupported') {
        printDiagnostics(environment, shownPath, [{
            path: '$.schemaVersion',
            code: 'AD_SCHEMA_UNSUPPORTED',
            message: `Arch Design schema version ${parsed.schemaVersion} is not supported`,
        }]);
        return undefined;
    }
    return { filepath, displayPath: shownPath, design: parsed.design, source };
}

function isDirectory(filepath: string): boolean {
    try {
        return statSync(filepath).isDirectory();
    } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code === 'ENOENT' || code === 'ENOTDIR') return false;
        throw error;
    }
}

function existingDirectories(candidates: readonly string[]): string[] {
    const seen = new Set<string>();
    const roots: string[] = [];
    for (const candidate of candidates) {
        const resolved = path.resolve(candidate);
        if (!isDirectory(resolved)) continue;
        let physical: string;
        try {
            physical = realpathSync(resolved);
        } catch (error) {
            const code = (error as NodeJS.ErrnoException).code;
            if (code === 'ENOENT' || code === 'ENOTDIR') continue;
            throw error;
        }
        if (seen.has(physical)) continue;
        seen.add(physical);
        roots.push(physical);
    }
    return roots;
}

function moduleCatalogRoots(
    loaded: LoadedArchDesign,
    options: CommandOptions,
    environment: CommandEnvironment,
    project: Project | undefined
): string[] {
    const globalLibraries = new GlobalConfigStore({
        homeDir: environment.homeDir,
    }).getLibDirs().map(directory => path.resolve(environment.cwd, directory));
    const commandLibraries = (options.lib ?? '').split(',').filter(Boolean).map(directory => (
        path.resolve(environment.cwd, directory)
    ));

    if (project !== undefined) {
        return existingDirectories([
            project.rootDir,
            ...project.libDirs,
            ...globalLibraries,
            ...commandLibraries,
        ]);
    }

    return existingDirectories([
        path.dirname(loaded.filepath),
        ...globalLibraries,
        ...commandLibraries,
    ]);
}

async function scanModuleDefinitions(roots: string[]) {
    const host = new NodeWorkspaceHost(roots);
    try {
        const controller = new AbortController();
        const interrupt = (): void => controller.abort();
        process.once('SIGINT', interrupt);
        try {
            await host.scan(controller.signal);
        } finally {
            process.off('SIGINT', interrupt);
        }
        const definitions = host.index.getAllDefinitions('module');
        return { definitions, inputs: await snapshotIndexedInputs(host.index, definitions.map(item => item.uri)) };
    } finally {
        await host.dispose();
    }
}

function archDesignCatalogRoot(
    loaded: LoadedArchDesign,
    options: CommandOptions,
    environment: CommandEnvironment,
    project: Project | undefined
): string {
    const root = project === undefined
        ? path.dirname(loaded.filepath)
        : path.dirname(path.resolve(environment.cwd, options.project!));
    try {
        return realpathSync(root);
    } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code === 'ENOENT' || code === 'ENOTDIR') return path.resolve(root);
        throw error;
    }
}

export async function scanArchDesignModuleDefinitions(
    loaded: LoadedArchDesign,
    options: CommandOptions,
    environment: CommandEnvironment,
    project: Project | undefined
): Promise<ArchDesignDefinitionCatalog & { inputs: { path: string; text: string }[] }> {
    const scanned = await scanModuleDefinitions(
        moduleCatalogRoots(loaded, options, environment, project)
    );
    return { ...createArchDesignDefinitionCatalog(
        scanned.definitions,
        pathToFileURL(archDesignCatalogRoot(
            loaded,
            options,
            environment,
            project
        )).toString()
    ), inputs: scanned.inputs };
}

function resolveArchDesignDefinitionKeys(
    design: ArchDesign,
    catalog: ArchDesignDefinitionCatalog
): ArchDesign {
    let changed = false;
    const instances = design.instances.map(instance => {
        const definitionKey = selectArchDesignDefinitionKey(
            instance.definitionKey,
            instance.module,
            catalog
        );
        if (definitionKey === undefined || definitionKey === instance.definitionKey) {
            return instance;
        }
        changed = true;
        return { ...instance, definitionKey };
    });
    return changed ? { ...design, instances } : design;
}

function outputPathFor(
    loaded: LoadedArchDesign,
    options: CommandOptions,
    environment: CommandEnvironment,
    language: ArchDesignLanguage
): string {
    const expectedExtension = language === 'verilog' ? '.v' : '.sv';
    let outputPath: string;
    if (options.output !== undefined) {
        outputPath = path.resolve(environment.cwd, options.output);
    } else if (loaded.design.export.output !== undefined) {
        outputPath = path.resolve(
            path.dirname(loaded.filepath),
            loaded.design.export.output
        );
    } else {
        const basename = path.basename(loaded.filepath, path.extname(loaded.filepath));
        outputPath = path.join(path.dirname(loaded.filepath), `${basename}${expectedExtension}`);
    }

    if (path.extname(outputPath).toLowerCase() !== expectedExtension) {
        throw new Error(
            `Output file extension must be ${expectedExtension} for ${language}: `
            + displayPath(outputPath, environment.cwd)
        );
    }
    return outputPath;
}

function portableSourcePath(designPath: string, outputPath: string): string {
    const relative = path.relative(path.dirname(outputPath), designPath);
    return normalizePathSeparators(path.isAbsolute(relative) ? designPath : relative);
}

export async function adValidate(
    options: CommandOptions,
    environment: CommandEnvironment
): Promise<number> {
    const loaded = await loadArchDesign(options, environment);
    if (!loaded) return 1;

    const project = openProject(options, environment);
    const protocols = await loadInterfaceProtocolCatalog(
        project?.interfaceProtocolFiles ?? []
    );
    if (protocols.diagnostics.length > 0) {
        printInterfaceProtocolDiagnostics(environment, protocols.diagnostics);
        return 1;
    }

    const definitionCatalog = await scanArchDesignModuleDefinitions(
        loaded,
        options,
        environment,
        project
    );
    const validation = validateArchDesign(
        resolveArchDesignDefinitionKeys(loaded.design, definitionCatalog),
        definitionCatalog.definitions,
        protocols.catalog
    );
    if (!validation.valid) {
        printDiagnostics(environment, loaded.displayPath, validation.diagnostics);
        return 1;
    }
    environment.stdout('Arch Design: OK\n');
    return 0;
}

export async function adExport(
    options: CommandOptions,
    environment: CommandEnvironment
): Promise<number> {
    const loaded = await loadArchDesign(options, environment);
    if (!loaded) return 1;

    const project = openProject(options, environment);
    const protocols = await loadInterfaceProtocolCatalog(
        project?.interfaceProtocolFiles ?? []
    );
    if (protocols.diagnostics.length > 0) {
        printInterfaceProtocolDiagnostics(environment, protocols.diagnostics);
        return 1;
    }

    const language = options.language as ArchDesignLanguage | undefined
        ?? loaded.design.export.language
        ?? 'verilog';
    const outputPath = outputPathFor(loaded, options, environment, language);
    const definitionCatalog = await scanArchDesignModuleDefinitions(
        loaded,
        options,
        environment,
        project
    );
    const definitions = definitionCatalog.definitions;
    const outputUri = canonicalFileUri(outputPath);
    let exportDefinitions = definitions.filter(definition => definition.uri !== outputUri);
    const physicalOutputUri = await canonicalPhysicalEntryUri(outputPath);
    if (physicalOutputUri !== undefined) {
        const physicalDefinitionUris = await Promise.all(exportDefinitions.map(definition => (
            canonicalPhysicalEntryUri(fileURLToPath(definition.uri))
        )));
        exportDefinitions = exportDefinitions.filter(
            (_definition, index) => physicalDefinitionUris[index] !== physicalOutputUri
        );
    }
    if (options.build) {
        const plan = await prepareArchDesignBuild(loaded.filepath, resolveArchDesignDefinitionKeys(loaded.design, definitionCatalog), exportDefinitions, { language, output: outputPath,
            xdcOutput: options.xdcOutput ? path.resolve(environment.cwd, options.xdcOutput) : undefined, rtlOnly: !!options.rtlOnly, interfaceCatalog: protocols.catalog, configPath: path.join(environment.homeDir, '.veriflow_config.json'), sourceText: loaded.source });
        const includedUris = new Set(exportDefinitions.map(item => item.uri));
        const excluded = new Set(definitions.filter(item => !includedUris.has(item.uri)).map(item => canonicalFileUri(fileURLToPath(item.uri))));
        plan.inputs.push(...definitionCatalog.inputs.filter(item => !excluded.has(canonicalFileUri(item.path))), ...protocols.inputs);
        if (plan.diagnostics.length) {
            if (options.json) environment.stdout(JSON.stringify({ format: 'veriflow-result', schemaVersion: 1, diagnostics: plan.diagnostics, artifacts: [] }) + '\n');
            else printDiagnostics(environment, loaded.displayPath, plan.diagnostics);
            return 1;
        }
        if (options.dryRun) await checkArtifactPlan(plan);
        else await publishArtifactPlan(plan);
        if (options.json) environment.stdout(JSON.stringify({ format: 'veriflow-result', schemaVersion: 1, diagnostics: [], artifacts: plan.artifacts.map(({ owns, ...artifact }) => artifact) }) + '\n');
        if (!options.json) environment.stdout(plan.artifacts.map(a => `${a.kind}: ${displayPath(a.path, environment.cwd)}`).join('\n') + '\n');
        return 0;
    }
    const generated = exportArchDesignRtl(
        resolveArchDesignDefinitionKeys(loaded.design, definitionCatalog), exportDefinitions, { language, sourcePath: portableSourcePath(loaded.filepath, outputPath), interfaceCatalog: protocols.catalog });
    if (generated.status === 'invalid') { printDiagnostics(environment, loaded.displayPath, generated.diagnostics); return 1; }
    await publishGeneratedFileAtomic(outputPath, generated.text);
    environment.stdout(`RTL exported: ${displayPath(outputPath, environment.cwd)}\n`);
    return 0;
}

export const archBuild = (options: CommandOptions, environment: CommandEnvironment) => adExport({ ...options, build: 'true' }, environment);
