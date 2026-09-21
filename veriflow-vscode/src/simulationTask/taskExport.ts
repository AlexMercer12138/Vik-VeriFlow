import * as path from 'path';
import { readFile } from 'fs/promises';
import { fileURLToPath, pathToFileURL } from 'url';
import { createArchDesignDefinitionCatalog } from '@veriflow/hdl-runtime/archDesignDefinitionReference';
import {
    describeArchDesignSource, deriveTaskModuleName, generateTestbench,
    type SimulationTaskDocument, type TaskModuleDefinition,
} from '@veriflow/hdl-runtime/simulationTask';
import { exportArchDesignRtl, parseArchDesignText } from '@veriflow/schematic-core/arch-design';
import type { InterfaceProtocolCatalog } from '@veriflow/schematic-core/interfaces';
import type { HdlDefinitionSummary } from '../core';
import { normalizeArchDesignDefinitionKeys, toArchDesignModuleDefinitions } from '../archDesign/editorSupport';

function sourceKey(file: string): string {
    const resolved = path.resolve(file);
    return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

/** Export from the live HDL catalog, without parsing or staging a simulation workspace. */
export async function prepareTaskExport(
    task: SimulationTaskDocument, taskPath: string, definitions: readonly HdlDefinitionSummary[],
    interfaceCatalog: InterfaceProtocolCatalog, workspaceRoot = path.dirname(taskPath),
) {
    const root = path.dirname(taskPath);
    const catalog = createArchDesignDefinitionCatalog(definitions, pathToFileURL(workspaceRoot).toString());
    const modules: TaskModuleDefinition[] = [];
    const sources = new Set<string>();
    const bindings = new Map<string, string>();
    const bind = (name: string, key: string) => {
        if (bindings.has(name) && bindings.get(name) !== key) {
            throw new Error(`Duplicate module ${name} is referenced from different sources`);
        }
        bindings.set(name, key);
    };
    for (const instance of task.instances) {
        if (!('source' in instance)) continue;
        const source = instance.source, file = path.resolve(root, source.path);
        sources.add(file);
        if (modules.some(item => item.source === source.path && (source.kind === 'ad' || item.module === source.module))) continue;
        if (source.kind === 'hdl') {
            const matches = definitions.filter(item => item.name === source.module && sourceKey(fileURLToPath(item.uri)) === sourceKey(file));
            if (matches.length !== 1) throw new Error(`Module ${source.module} must resolve to exactly one definition in ${source.path}`);
            const definition = matches[0];
            bind(definition.name, definition.key);
            modules.push({ source: source.path, module: definition.name, definitionKey: definition.key,
                parameters: definition.parameters.map(item => ({ name: item.name, defaultValue: item.defaultExpression })),
                ports: definition.ports.map(port => ({ name: port.name, direction: port.direction,
                    width: port.width.kind === 'known' ? port.width.bits : port.width.kind === 'symbolic' ? port.width.expression : undefined })) });
        } else {
            const parsed = parseArchDesignText(await readFile(file, 'utf8'));
            if (parsed.status !== 'editable') throw new Error(`Fix the Architecture Design before export: ${source.path}`);
            const design = normalizeArchDesignDefinitionKeys(parsed.design, catalog);
            for (const child of design.instances) {
                const key = child.definitionKey && catalog.runtimeKey(child.definitionKey);
                if (key) bind(child.module, key);
            }
            const output = exportArchDesignRtl(design, toArchDesignModuleDefinitions(catalog.definitions), {
                language: 'verilog', sourcePath: source.path, interfaceCatalog,
            });
            if (output.status !== 'generated') throw new Error(output.diagnostics.map(item => item.message).join('\n'));
            modules.push({ ...describeArchDesignSource(design, source.path, interfaceCatalog),
                definitionKey: sourceKey(file), generatedText: output.text });
        }
    }
    return {
        generatedTestbench: generateTestbench(task, deriveTaskModuleName(taskPath), modules, interfaceCatalog),
        inputFiles: [taskPath, ...sources, ...definitions.map(item => fileURLToPath(item.uri))],
    };
}
