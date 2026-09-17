import { createEmptyArchDesign, projectArchDesignGraph, type ArchDesign, type ArchDesignModuleDefinition } from '@veriflow/schematic-core/arch-design';
import { createInterfaceProtocolCatalog, type InterfaceProtocolCatalog } from '@veriflow/schematic-core/interfaces';
import { describePreset, deriveTaskModuleName, resolveProtocolPresetPorts, type SimulationTaskDocument, type TaskModuleDefinition } from '@veriflow/hdl-runtime/simulationTask';
import { archDesignLayout, projectArchDesignInspectorData } from '../archDesign/editorSupport';
import type { SchematicEditorProjection } from '../schematic/protocol';
export const taskModuleKey = (source: string, module: string): string => JSON.stringify([source, module]);
export function taskDesign(task: SimulationTaskDocument, modules: readonly TaskModuleDefinition[], filename: string): ArchDesign {
    task = resolveProtocolPresetPorts(task);
    return { ...createEmptyArchDesign(deriveTaskModuleName(filename)),
        instances: task.instances.map(instance => {
            if ('preset' in instance) return { name: instance.id, module: describePreset(instance.preset).module, definitionKey: `preset:${instance.id}` };
            const source = instance.source;
            const module = source.kind === 'hdl' ? source.module : modules.find(item => item.source === source.path)?.module ?? instance.id;
            return { name: instance.id, module, definitionKey: taskModuleKey(source.path, module), parameters: instance.parameters };
        }), connections: task.connections, logic: task.logic, defaults: task.defaults,
        interfaceConnections: task.interfaceConnections, interfaceOverrides: task.interfaceOverrides, presentation: task.presentation };
}
export function projectSimulationTask(task: SimulationTaskDocument, modules: readonly TaskModuleDefinition[], uri: string,
    interfaceCatalog: InterfaceProtocolCatalog = createInterfaceProtocolCatalog()) {
    const definitions = [...modules.map(module => ({ ...module, key: taskModuleKey(module.source, module.module) })),
        ...task.instances.flatMap(instance => 'preset' in instance ? [{ ...describePreset(instance.preset), key: `preset:${instance.id}` }] : [])];
    const catalog: ArchDesignModuleDefinition[] = definitions.map(module => ({ key: module.key, name: module.module,
        parameters: (module.parameters ?? []).map(parameter => ({ name: parameter.name, defaultExpression: parameter.defaultValue })),
        ports: module.ports.map(port => ({ name: port.name, direction: port.direction, width: typeof port.width === 'number'
            ? { kind: 'known', bits: port.width } : typeof port.width === 'string' ? { kind: 'symbolic', expression: port.width } : { kind: 'unknown' } })),
    }));
    const design = taskDesign(task, modules, decodeURIComponent(uri));
    const projected = projectArchDesignGraph(design, catalog, { fileUri: uri, interfaceCatalog });
    const projection: SchematicEditorProjection = { design, catalog, validation: projected.validation,
        inspector: projectArchDesignInspectorData(design, catalog, interfaceCatalog),
        moduleChoices: modules.map(module => ({ label: module.module, description: module.source, moduleName: module.module, definitionKey: taskModuleKey(module.source, module.module) })) };
    const graph = { ...projected.graph, nodes: projected.graph.nodes.map(node => {
        const instance = task.instances.find(item => node.id === 'instance:' + item.id);
        if (!instance || !('preset' in instance)) return node;
        const { definitionKey: _key, ...presetNode } = node;
        const preset = instance.preset;
        const title = preset.kind === 'protocol'
            ? `${({ axis: 'AXI-STREAM', axi4lite: 'AXI-Lite', axi4: 'AXI-Full', rgb888: 'RGB' } as Record<string, string>)[preset.protocol] ?? preset.protocol.toUpperCase()} ${preset.role}`
            : { clock: 'Clock', reset: 'Reset', stimulus: 'Stimulus' }[preset.kind];
        return { ...presetNode, subtitle: title };
    }) };
    return { projection, graph, layout: archDesignLayout(design, graph) };
}
