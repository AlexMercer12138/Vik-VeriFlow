import { applyArchDesignEdit, type ArchDesignEdit } from '@veriflow/schematic-core/arch-design';
import { parseSimulationTask, type SimulationTaskDocument, type TaskModuleDefinition, type StInstance } from '@veriflow/hdl-runtime/simulationTask';
import { taskDesign, taskModuleKey } from './taskProjection';
/** Use the same graph-edit operations as AD; only instance source identity is ST-specific. */
export function applyTaskEdit(task: SimulationTaskDocument, modules: readonly TaskModuleDefinition[], edit: ArchDesignEdit): SimulationTaskDocument {
    const forbidden = ['addPort', 'updatePort', 'removePort', 'promotePort', 'promoteInterface', 'resyncInterfacePort', 'renameInterfacePort', 'removeInterfacePort', 'setExport'];
    if (forbidden.includes(edit.type)) throw new Error('Simulation tasks have no external top-level ports or RTL export settings.');
    const design = applyArchDesignEdit(taskDesign(task, modules, 'simulation.st'), edit);
    const instances: StInstance[] = design.instances.map(instance => {
        const originalId = edit.type === 'renameInstance' && instance.name === edit.nextName ? edit.name : instance.name;
        const previous = task.instances.find(item => item.id === originalId);
        if (previous && 'preset' in previous) return { ...previous, id: instance.name };
        const parameters = Object.fromEntries(Object.entries(instance.parameters ?? {}).map(([key, value]) => [key, String(value)]));
        if (previous && 'source' in previous) return { ...previous, id: instance.name, parameters };
        const definition = modules.find(item => taskModuleKey(item.source, item.module) === instance.definitionKey);
        if (!definition) throw new Error('Select a module with an exact source identity.');
        return { id: instance.name, parameters, source: definition.source.toLowerCase().endsWith('.ad')
            ? { kind: 'ad', path: definition.source } : { kind: 'hdl', path: definition.source, module: definition.module } };
    });
    return parseSimulationTask(JSON.stringify({ ...task, instances, connections: design.connections, logic: design.logic,
        defaults: design.defaults, interfaceConnections: design.interfaceConnections, interfaceOverrides: design.interfaceOverrides, presentation: design.presentation }));
}
