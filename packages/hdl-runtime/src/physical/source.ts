import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ProjectStore } from '@veriflow/flow-core';
import { adPhysicalPorts, parseArchDesignText, parsePhysicalConfiguration, type PhysicalConfiguration } from '@veriflow/schematic-core/arch-design';
import { NodeWorkspaceHost, type ParserRuntimePaths } from '../nodeWorkspaceHost';
import { createArchDesignDefinitionCatalog } from '../archDesignDefinitionReference';
import { normalizeArchDesignDefinitionKeys, snapshotIndexedInputs, toArchDesignModuleDefinitions } from '../archDesign';
import { loadInterfaceProtocolCatalog } from '../interfaces';
import { rtlPhysicalPorts } from './ports';
import type { ConstraintSource } from './workbench';
export type ConstraintSourceOptions = {
    module?: string;
    project?: string;
    lib?: string[];
    config?: string;
    parserPaths?: ParserRuntimePaths;
    chooseModule?(modules: string[]): Promise<string | undefined>;
};
export async function loadConstraintSource(file: string, options: ConstraintSourceOptions = {}): Promise<ConstraintSource> {
    file = path.resolve(file);
    if (!/\.(ad|v|sv)$/i.test(file))
        throw new Error('Choose a .ad, .v or .sv file');
    const text = await readFile(file, 'utf8'), isAd = /\.ad$/i.test(file), project = options.project ? new ProjectStore().open(options.project) : undefined;
    const roots = [path.dirname(file), ...(project ? [project.rootDir, ...project.libDirs] : []), ...options.lib ?? []];
    const defines: Record<string, string | true> = Object.fromEntries(Object.entries(project?.defines ?? {}).filter(([, v]) => v !== false).map(([k, v]) => [k, v === true ? true as const : String(v)]));
    const host = new NodeWorkspaceHost(roots, defines, options.parserPaths);
    try {
        await host.scan();
        const definitions = host.index.getAllDefinitions('module');
        const inputs = await snapshotIndexedInputs(host.index, definitions.map(d => d.uri));
        let outputStem: string | undefined;
        let configuration: PhysicalConfiguration | undefined, configurationPath = options.config ?? file.replace(/\.(v|sv)$/i, '.pins.json'), configurationText: string | undefined, output: string | undefined, module: string, ports;
        if (isAd) {
            const parsed = parseArchDesignText(text);
            if (parsed.status !== 'editable')
                throw new Error('AD is not editable');
            const catalog = createArchDesignDefinitionCatalog(definitions, pathToFileURL(path.dirname(options.project ?? file)).toString());
            const protocols = await loadInterfaceProtocolCatalog(project?.interfaceProtocolFiles ?? []);
            if (protocols.diagnostics.length)
                throw new Error(protocols.diagnostics.map(d => d.message).join('\n'));
            ports = adPhysicalPorts(normalizeArchDesignDefinitionKeys(parsed.design, catalog), toArchDesignModuleDefinitions(catalog.definitions), protocols.catalog);
            module = parsed.design.module;
            if (parsed.design.export.output) {
                const rtl = path.resolve(path.dirname(file), parsed.design.export.output);
                outputStem = rtl.slice(0, -path.extname(rtl).length);
            }
            configuration = parsed.design.physical;
            configurationPath = file;
            if (parsed.design.export.constraintsOutput)
                output = path.resolve(path.dirname(file), parsed.design.export.constraintsOutput);
            inputs.push(...protocols.inputs);
        }
        else {
            const identity = (p: string) => process.platform === 'win32' ? path.resolve(p).toLowerCase() : path.resolve(p);
            const modules = definitions.filter(d => identity(fileURLToPath(d.uri)) === identity(file));
            let selected = options.module ? modules.find(d => d.name === options.module || d.key === options.module) : modules.length === 1 ? modules[0] : undefined;
            if (!selected && modules.length > 1 && options.chooseModule) {
                const chosen = await options.chooseModule(modules.map(d => d.name));
                selected = modules.find(d => d.name === chosen);
            }
            if (!selected)
                throw new Error(modules.length ? 'Select a module from this file' : 'No HDL module found');
            module = selected.name;
            ports = rtlPhysicalPorts(selected.ports, selected.parameters);
            try {
                configurationText = await readFile(configurationPath, 'utf8');
                configuration = parsePhysicalConfiguration(JSON.parse(configurationText));
            }
            catch (e) {
                if ((e as NodeJS.ErrnoException).code !== 'ENOENT')
                    throw e;
            }
        }
        return { path: file, text, module, ports, isAd, configuration, configurationPath, configurationText, output, outputStem, inputs: [...inputs.filter(i => i.path !== file), { path: file, text }] };
    }
    finally {
        await host.dispose();
    }
}
