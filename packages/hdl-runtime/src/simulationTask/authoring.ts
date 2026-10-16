import { applyArchDesignEdit, type ArchDesignEdit } from '@veriflow/schematic-core/arch-design';
import { validateSimulationTaskValue } from './validation';
import type { SimulationTaskDocument, TaskModuleDefinition, StInstance } from './model';
import { taskDesign, taskModuleKey } from './projection';
import type { SimulationPreset, StSource } from './model';
export type TaskEdit = ArchDesignEdit
    | { type: 'addSourceInstance'; id: string; source: StSource; parameters?: Record<string, string | number> }
    | { type: 'addPreset'; id: string; preset: SimulationPreset }
    | { type: 'updatePreset'; id: string; preset: SimulationPreset }
    | { type: 'updateTaskSettings'; settings: Partial<SimulationTaskDocument['settings']> };
/** Use the same graph-edit operations as AD; only instance source identity is ST-specific. */
export function applyTaskEdit(task: SimulationTaskDocument, modules: readonly TaskModuleDefinition[], edit: TaskEdit): SimulationTaskDocument {
    if (edit.type === 'addSourceInstance' || edit.type === 'addPreset') {
        const instance: StInstance = edit.type === 'addPreset' ? { id: edit.id, preset: edit.preset }
            : { id: edit.id, source: edit.source, parameters: edit.parameters ?? {} };
        return validateSimulationTaskValue({ ...task, instances: [...task.instances, instance] });
    }
    if (edit.type === 'updatePreset') {
        const previous = task.instances.find(instance => instance.id === edit.id);
        if (!previous || !('preset' in previous) || previous.preset.kind !== edit.preset.kind)
            throw new Error('This simulation utility no longer exists.');
        return validateSimulationTaskValue({ ...task, instances: task.instances.map(instance => instance.id === edit.id ? { id: edit.id, preset: edit.preset } : instance) });
    }
    if (edit.type === 'updateTaskSettings') return validateSimulationTaskValue({ ...task, settings: { ...task.settings, ...edit.settings } });
    const forbidden = ['addPort', 'updatePort', 'removePort', 'promotePort', 'promoteInterface', 'resyncInterfacePort', 'renameInterfacePort', 'removeInterfacePort', 'setExport', 'setPhysical'];
    if (forbidden.includes(edit.type)) throw new Error('Simulation tasks have no external top-level ports or RTL export settings.');
    const design = applyArchDesignEdit(taskDesign(task, modules, 'simulation.st'), edit);
    const instances: StInstance[] = design.instances.map(instance => {
        const originalId = edit.type === 'renameInstance' && instance.name === edit.nextName ? edit.name : instance.name;
        const previous = task.instances.find(item => item.id === originalId);
        if (previous && 'preset' in previous) return { ...previous, id: instance.name };
        const parameters = instance.parameters ?? {};
        if (previous && 'source' in previous) return { ...previous, id: instance.name, parameters };
        const definition = modules.find(item => taskModuleKey(item.source, item.module) === instance.definitionKey);
        if (!definition) throw new Error('Select a module with an exact source identity.');
        return { id: instance.name, parameters, source: definition.source.toLowerCase().endsWith('.ad')
            ? { kind: 'ad', path: definition.source } : { kind: 'hdl', path: definition.source, module: definition.module } };
    });
    return validateSimulationTaskValue({ ...task, instances, connections: design.connections, logic: design.logic,
        defaults: design.defaults, interfaceConnections: design.interfaceConnections, interfaceOverrides: design.interfaceOverrides, presentation: design.presentation });
}
