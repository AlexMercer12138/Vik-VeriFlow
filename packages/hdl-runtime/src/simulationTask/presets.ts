import type { SimulationPreset, TaskModuleDefinition, TimeScale } from './model';
import { describeProtocolPreset, renderProtocolPreset } from './protocolPresets';
import { clockTiming, decimalRatio, numberRatio, timeScaleFemtoseconds } from './timing';

export function describePreset(preset: SimulationPreset): TaskModuleDefinition {
    if (preset.kind === 'protocol') return describeProtocolPreset(preset);
    return { source: `preset:${preset.kind}`, module: `__veriflow_st_${preset.kind}`, parameters: [],
        ports: [{ name: preset.kind === 'clock' ? 'clk' : preset.kind === 'reset' ? 'reset' : 'out',
            direction: 'output', width: preset.kind === 'stimulus' ? preset.width : 1 }] };
}
export function renderPreset(preset: SimulationPreset, moduleName: string, unit: TimeScale, precision: TimeScale = '1ps'): string {
    if (preset.kind === 'protocol') return renderProtocolPreset(preset, moduleName, timeScaleFemtoseconds(precision) / timeScaleFemtoseconds(unit));
    if (preset.kind === 'clock') {
        const { halfPeriod } = clockTiming(preset, unit, precision);
        return `module ${moduleName}(output reg clk = 1'b${preset.initial});\n    always #(${halfPeriod}) clk = ~clk;\nendmodule\n`;
    }
    if (preset.kind === 'reset') return `module ${moduleName}(output reg reset = 1'b${preset.active});\n    initial #(${preset.duration}) reset = 1'b${1 - preset.active};\nendmodule\n`;
    let previous = 0;
    const transitions = preset.transitions.map(row => {
        const [nextN, nextD] = numberRatio(row.at), [priorN, priorD] = numberRatio(previous);
        const delay = decimalRatio(nextN * priorD - priorN * nextD, nextD * priorD);
        previous = row.at;
        return `        #(${delay}) out <= ${row.value};`;
    });
    return `module ${moduleName}(output reg [${preset.width - 1}:0] out = ${preset.initial});\n    initial begin\n${transitions.join('\n')}\n    end\nendmodule\n`;
}
