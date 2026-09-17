import type { ArchDesign } from '@veriflow/schematic-core/arch-design';
import type { ProtocolPreset } from './protocolPresets';

export type TimeScale = `${1 | 10 | 100}${'s' | 'ms' | 'us' | 'ns' | 'ps' | 'fs'}`;
export type StSource = { kind: 'hdl'; path: string; module: string } | { kind: 'ad'; path: string };
export type SimulationPreset =
    | ProtocolPreset
    | { kind: 'clock'; frequencyMHz: number; initial: 0 | 1 }
    | { kind: 'reset'; active: 0 | 1; duration: number }
    | { kind: 'stimulus'; width: number; initial: string; transitions: { at: number; value: string }[] };
export type StInstance = { id: string; source: StSource; parameters: Record<string, string> }
    | { id: string; preset: SimulationPreset };
export interface SimulationTaskDocument {
    format: 'veriflow-simulation-task';
    schemaVersion: 1;
    settings: {
        timeUnit: TimeScale; timePrecision: TimeScale; duration: number;
        waveform: { enabled: boolean; filename: string };
        exportPath?: string;
    };
    instances: StInstance[];
    connections: ArchDesign['connections'];
    logic: ArchDesign['logic'];
    defaults: ArchDesign['defaults'];
    interfaceConnections: ArchDesign['interfaceConnections'];
    interfaceOverrides: ArchDesign['interfaceOverrides'];
    presentation: ArchDesign['presentation'];
}
export interface TaskModuleDefinition {
    source: string;
    module: string;
    definitionKey?: string;
    ports: { name: string; direction: 'input' | 'output' | 'inout'; width?: number | string }[];
    parameters?: { name: string; defaultValue?: string }[];
    generatedText?: string;
}
export interface TaskDiagnostic { severity: 'error' | 'warning'; code: string; path: string; message: string }
export interface GeneratedTestbench { moduleName: string; text: string; diagnostics: TaskDiagnostic[] }

export function deriveTaskModuleName(filename: string): string {
    const base = filename.replace(/\\/g, '/').split('/').pop()!.replace(/\.[^.]*$/, '');
    const identifier = base.replace(/[^A-Za-z0-9_$]/g, '_') || 'simulation';
    return `${/^[A-Za-z_]/.test(identifier) ? identifier : `_${identifier}`}_tb`;
}
export function createSimulationTask(filename = 'simulation.st'): SimulationTaskDocument {
    return {
        format: 'veriflow-simulation-task', schemaVersion: 1,
        settings: { timeUnit: '1ns', timePrecision: '1ps', duration: 1000000,
            waveform: { enabled: true, filename: `${deriveTaskModuleName(filename)}.vcd` } },
        instances: [], connections: [], logic: [], defaults: {}, interfaceConnections: [], interfaceOverrides: {}, presentation: {},
    };
}
