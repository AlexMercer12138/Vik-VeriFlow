import { createEmptyArchDesign, exportArchDesignRtl, resolveArchDesign, type ArchDesign, type ArchDesignModuleDefinition } from '@veriflow/schematic-core/arch-design';
import type { WidthValue } from '@veriflow/hdl-core/model';
import type { InterfaceProtocolCatalog } from '@veriflow/schematic-core/interfaces';
import type { GeneratedTestbench, SimulationTaskDocument, TaskDiagnostic, TaskModuleDefinition } from './model';
import { describePreset, renderPreset } from './presets';
import { parseSimulationTask } from './validation';
import { resolveProtocolPresetPorts } from './protocolPresets';

/** Describe the same scalar and expanded interface ports emitted by the AD RTL exporter. */
export function describeArchDesignSource(design: ArchDesign, source: string, interfaceCatalog?: InterfaceProtocolCatalog): TaskModuleDefinition {
    const resolution = resolveArchDesign(design, [], interfaceCatalog);
    const width = (value: WidthValue | undefined): number | string | undefined => value?.kind === 'known'
        ? value.bits : value?.kind === 'symbolic' ? value.expression : undefined;
    return { source, module: design.module, parameters: [], ports: [
        ...resolution.ports.map(({ port }) => ({ name: port.name, direction: port.direction,
            width: width(resolution.endpointTargets.find(target => target.kind === 'port' && target.port === port.name)?.width) })),
        ...resolution.interfaces.endpoints.flatMap(endpoint => endpoint.endpoint.kind === 'port'
            ? endpoint.members.map(member => ({ name: member.port, direction: member.portDirection, width: width(member.width) })) : []),
    ] };
}

export class SimulationTaskValidationError extends Error {
    constructor(public readonly diagnostics: readonly TaskDiagnostic[]) {
        super(diagnostics.map(d => `${d.path}: ${d.message}`).join('\n'));
        this.name = 'SimulationTaskValidationError';
    }
}
export function generateTestbench(
    input: SimulationTaskDocument, moduleName: string, definitions: readonly TaskModuleDefinition[],
    interfaceCatalog?: InterfaceProtocolCatalog,
): GeneratedTestbench {
    const task = resolveProtocolPresetPorts(parseSimulationTask(JSON.stringify(input)));
    const diagnostics: TaskDiagnostic[] = [];
    const helpers: string[] = [];
    const wrappers = new Map<string, string>();
    const selected = new Map<string, TaskModuleDefinition>();
    const names = new Map<string, string>();
    const graphDefinitions: ArchDesignModuleDefinition[] = [];
    const instances = task.instances.map((instance, index) => {
        let definition: TaskModuleDefinition;
        if ('preset' in instance) {
            definition = { ...describePreset(instance.preset), module: `__veriflow_st_${instance.preset.kind}_${index}` };
            if (definitions.some(d => d.module === definition.module)) throw new Error(`Reserved preset module collision: ${definition.module}`);
            helpers.push(renderPreset(instance.preset, definition.module, task.settings.timeUnit, task.settings.timePrecision));
        } else {
            const matches = definitions.filter(d => d.source.replace(/\\/g, '/') === instance.source.path.replace(/\\/g, '/')
                && (instance.source.kind === 'ad' || d.module === instance.source.module));
            if (matches.length !== 1) throw new Error(`Instance ${instance.id}: expected one definition for ${instance.source.path}, found ${matches.length}`);
            definition = matches[0];
            if (definition.generatedText !== undefined) wrappers.set(definition.module, definition.generatedText);
        }
        if (definition.module === moduleName) throw new Error(`Testbench module ${moduleName} collides with an instance module`);
        const key = definition.definitionKey ?? `${definition.source}#${definition.module}`;
        const priorSource = names.get(definition.module);
        if (priorSource !== undefined && priorSource !== key) throw new Error(`Duplicate module ${definition.module} from different sources`);
        names.set(definition.module, key);
        if (!selected.has(key)) {
            selected.set(key, definition);
            graphDefinitions.push({ key, name: definition.module,
                parameters: (definition.parameters ?? []).map(p => ({ name: p.name, defaultExpression: p.defaultValue })),
                ports: definition.ports.map(p => ({ name: p.name, direction: p.direction,
                    width: p.width === undefined ? { kind: 'unknown' as const } : typeof p.width === 'number'
                        ? { kind: 'known' as const, bits: p.width } : { kind: 'symbolic' as const, expression: p.width } })) });
        }
        return { name: instance.id, module: definition.module, definitionKey: key, parameters: 'source' in instance ? instance.parameters : {} };
    });
    const design = { ...createEmptyArchDesign(moduleName), instances,
        logic: task.logic, defaults: task.defaults, connections: task.connections, interfaceConnections: task.interfaceConnections,
        interfaceOverrides: task.interfaceOverrides, presentation: task.presentation };
    const resolved = resolveArchDesign(design, graphDefinitions, interfaceCatalog);
    diagnostics.push(...resolved.diagnostics.map(d => ({ ...d, severity: 'error' as const })),
        ...resolved.warnings.map(d => ({ ...d, severity: 'warning' as const })));
    const connected = new Set([
        ...resolved.connections.flatMap(c => c.endpoints.map(e => e.identity)),
        ...resolved.interfaces.occupancy.map(e => e.targetIdentity),
    ]);
    for (const target of resolved.endpointTargets) {
        if (target.width.kind !== 'known') diagnostics.push({ severity: 'error', code: 'ST_UNKNOWN_WIDTH', path: target.declarationPath,
            message: `Port ${target.defaultKey} has unresolved width; provide resolvable parameters` });
        if (target.role === 'driver' && !connected.has(target.identity)) diagnostics.push({ severity: 'warning', code: 'ST_UNUSED_OUTPUT', path: target.declarationPath,
            message: `Output ${target.defaultKey} is not connected` });
    }
    for (const fallback of resolved.effectiveDefaults) if (fallback.origin === 'implicit-zero') diagnostics.push({ severity: 'error', code: 'ST_UNDRIVEN_INPUT', path: fallback.sourcePath,
        message: `Input ${fallback.endpoint} is undriven; connect a preset, module output, or Logic Utility` });
    if (diagnostics.some(d => d.severity === 'error')) throw new SimulationTaskValidationError(diagnostics);
    const output = exportArchDesignRtl(design, graphDefinitions, { language: 'verilog', interfaceCatalog });
    if (output.status !== 'generated') throw new SimulationTaskValidationError(output.diagnostics.map(d => ({ ...d, severity: 'error' })));
    const protocolInstances = task.instances.filter(instance => 'preset' in instance && instance.preset.kind === 'protocol');
    const controls = protocolInstances.length ? ['    initial begin', `        #(${task.settings.duration});`,
        '        #0; // Allow protocol tasks finishing at this timestamp to return.',
        ...protocolInstances.map(instance => `        if (${instance.id}.vf_completed !== 1'b1) $fatal(1, "ST_PROTOCOL_INCOMPLETE|${instance.id}: task duration ended before protocol completion");`),
        '        $finish;', '    end'] : [`    initial #(${task.settings.duration}) $finish;`];
    if (task.settings.waveform.enabled) controls.push('    initial begin', `        $dumpfile(${JSON.stringify(task.settings.waveform.filename)});`, `        $dumpvars(0, ${moduleName});`, '    end');
    const top = output.text.slice(output.text.indexOf('\nmodule ') + 1).replace(/endmodule\s*$/, `${controls.join('\n')}\nendmodule\n`);
    const timescale = `\`timescale ${task.settings.timeUnit}/${task.settings.timePrecision}`;
    return { moduleName, diagnostics, text: [`// Generated Simulation Task: ${moduleName}`, timescale, top,
        ...helpers.map(text => `${timescale}\n${text}`), ...[...wrappers.values()].map(text => `${timescale}\n${text}`)].join('\n') };
}
