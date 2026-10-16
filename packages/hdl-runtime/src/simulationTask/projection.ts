import { createEmptyArchDesign, type ArchDesign } from '@veriflow/schematic-core/arch-design';
import { resolveProtocolPresetPorts } from './protocolPresets';
import { describePreset } from './presets';
import { deriveTaskModuleName, type SimulationTaskDocument, type TaskModuleDefinition } from './model';
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
