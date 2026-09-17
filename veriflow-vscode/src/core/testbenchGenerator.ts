import * as fs from 'fs';
import * as path from 'path';
import { formatModuleInstantiation } from './moduleInstantiationFormatter';
import { effectiveModuleInstanceIdentifier } from './moduleInstantiationIdentifier';
import { Port, Parameter } from './types';

export interface TbModuleConfig {
    definitionKey: string;
    module_name: string;
    instance_name: string;
    ports: Port[];
    parameters: Parameter[];
    port_signals: Record<string, string>;
    param_values: Record<string, string>;
}

function isValidVerilogIdentifier(name: string): boolean {
    return /^[A-Za-z_][A-Za-z0-9_$]*$/.test(name) || /^\\\S+$/.test(name);
}

function identifierBeforePunctuation(name: string): string {
    return name.startsWith('\\') ? `${name} ` : name;
}

function normalizeStringRecord(value: unknown): Record<string, string> {
    const normalized = Object.create(null) as Record<string, string>;
    if (!value || typeof value !== 'object') { return normalized; }
    for (const key of Object.keys(value)) {
        const item = (value as Record<string, unknown>)[key];
        if (typeof item === 'string') {
            normalized[key] = item;
        }
    }
    return normalized;
}

function ownValue(
    values: Record<string, string>,
    name: string,
    fallback: string
): string {
    return Object.prototype.hasOwnProperty.call(values, name)
        ? values[name]
        : fallback;
}

/** Preserve HDL arithmetic instead of evaluating it as JavaScript or guessing one bit. */
function substituteParameters(expression: string, values: Record<string, string>, active = new Set<string>()): string {
    return expression.replace(/[A-Za-z_$][A-Za-z0-9_$]*/g, token => {
        if (!Object.prototype.hasOwnProperty.call(values, token)) return token;
        if (active.has(token)) throw new Error(`Cyclic testbench parameter: ${token}`);
        const next = new Set(active); next.add(token);
        return `(${substituteParameters(values[token], values, next)})`;
    });
}
function resolvePortWidth(width: string | undefined, values: Record<string, string>): string | undefined {
    return width ? substituteParameters(width, values) : undefined;
}
function timeSeconds(value: string): number {
    const match = /^(1|10|100)(s|ms|us|ns|ps|fs)$/.exec(value);
    if (!match) throw new Error(`Invalid timescale: ${value}`);
    return Number(match[1]) * ({ s: 1, ms: 1e-3, us: 1e-6, ns: 1e-9, ps: 1e-12, fs: 1e-15 }[match[2]]!);
}
function positiveDelay(value: string, label: string): string {
    if (!/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(value) || !Number.isFinite(Number(value)) || Number(value) <= 0) {
        throw new Error(`${label} must be a positive delay in timescale units`);
    }
    return value;
}

export interface TbConfig {
    name: string;
    time_unit: string;
    time_precision: string;
    clocks_mhz: string[];
    reset_active_high: boolean;
    reset_duration: string;
    modules: TbModuleConfig[];
    wave_file: string;
    timeout: string;
}

export class TestbenchGenerator {
    generate(config: TbConfig, outputDir: string): string {
        const filepath = path.join(outputDir, `${config.name || 'tb_top'}.v`);
        fs.mkdirSync(outputDir, { recursive: true });
        fs.writeFileSync(filepath, this.render(config), 'utf-8');
        return filepath;
    }

    render(config: TbConfig): string {
        const name = config.name || 'tb_top';
        const timeUnit = config.time_unit || '1ns';
        const timePrecision = config.time_precision || '1ps';
        const clocksMhz = config.clocks_mhz || ['100'];
        const resetActiveHigh = config.reset_active_high !== false;
        const resetDuration = config.reset_duration || '100';
        const originalModules = config.modules || [];
        const modules = originalModules.map((mod, index) => ({ ...mod,
            port_signals: Object.fromEntries(mod.ports.map(port => [port.name,
                ownValue(normalizeStringRecord(mod.port_signals), port.name,
                    originalModules.length > 1 ? `dut_${index}_${port.name.replace(/[^A-Za-z0-9_$]/g, '_')}` : port.name)])),
        }));
        const waveFile = config.wave_file || `${name}.vcd`;
        const timeout = config.timeout || '1000000';

        const lines = this._build(name, timeUnit, timePrecision, clocksMhz, resetActiveHigh, resetDuration, modules, waveFile, timeout);

        return lines.join('\n');
    }

    private _build(
        name: string,
        timeUnit: string,
        timePrecision: string,
        clocksMhz: string[],
        resetActiveHigh: boolean,
        resetDuration: string,
        modules: TbModuleConfig[],
        waveFile: string,
        timeout: string
    ): string[] {
        const L: string[] = [];
        const unitSeconds = timeSeconds(timeUnit);
        const precisionSeconds = timeSeconds(timePrecision);
        if (precisionSeconds > unitSeconds) throw new Error('Time precision must not exceed time unit');
        positiveDelay(resetDuration, 'Reset duration');
        positiveDelay(timeout, 'Timeout');

        L.push(`\`timescale ${timeUnit} / ${timePrecision}`);
        L.push('');
        L.push(`module ${name};`);
        L.push('');

        // ---- Clock signals ----
        for (let i = 0; i < clocksMhz.length; i++) {
            const freq = clocksMhz[i];
            if (!freq) { continue; }
            const freqVal = Number(freq);
            if (!Number.isFinite(freqVal) || freqVal <= 0) throw new Error('Clock frequency must be positive MHz');
            const halfSeconds = 1 / (2 * freqVal * 1e6);
            const ticks = halfSeconds / precisionSeconds;
            if (Math.abs(ticks - Math.round(ticks)) > Math.max(1, ticks) * 1e-9 || ticks < 1) {
                throw new Error('Clock half-period cannot be represented by this time precision');
            }
            const halfPeriod = Number((halfSeconds / unitSeconds).toPrecision(12));
            const cname = i > 0 ? `clk_${i}` : 'clk';
            L.push(`    reg ${cname} = 0;`);
            L.push(`    always #(${halfPeriod}) ${cname} = ~${cname};`);
            L.push('');
        }

        // ---- Reset signal ----
        const rstSignal = resetActiveHigh ? 'rst' : 'rst_n';
        const rstValInit = resetActiveHigh ? "1'b1" : "1'b0";
        const rstValRelease = resetActiveHigh ? "1'b0" : "1'b1";
        L.push(`    reg ${rstSignal} = ${rstValInit};`);
        L.push('    initial begin');
        L.push(`        #(${resetDuration}) ${rstSignal} = ${rstValRelease};`);
        L.push('    end');
        L.push('');

        // ---- Collect all ports across modules, merge same-name ----
        const excludeSignals = new Set<string>([rstSignal]);
        for (let i = 0; i < clocksMhz.length; i++) {
            if (!clocksMhz[i]) { continue; }
            excludeSignals.add(i > 0 ? `clk_${i}` : 'clk');
        }

        const mergedSignals = new Map<string, { port: Port; paramMap: Record<string, string> }>();
        const allParsed = modules.map(mod => ({
            mod,
            ports: mod.ports,
            params: mod.parameters,
        }));

        for (const { mod, ports, params } of allParsed) {
            // Build param value map for width resolution
            const paramValues = normalizeStringRecord(mod.param_values);
            const paramMap = Object.create(null) as Record<string, string>;
            for (const p of params) {
                paramMap[p.name] = ownValue(paramValues, p.name, p.value);
            }
            const portSignals = normalizeStringRecord(mod.port_signals);
            for (const port of ports) {
                const sigName = ownValue(portSignals, port.name, port.name);
                if (excludeSignals.has(sigName)) { continue; }
                const existing = mergedSignals.get(sigName);
                if (!existing) {
                    mergedSignals.set(sigName, { port, paramMap });
                } else {
                    if (this._getWidthStr(existing.port, existing.paramMap) !== this._getWidthStr(port, paramMap)
                        || existing.port.direction !== port.direction) {
                        throw new Error(`Conflicting explicitly shared DUT signal: ${sigName}`);
                    }
                }
            }
        }

        // ---- Generate shared signal declarations ----
        // Only generate declarations for simple or escaped Verilog identifiers.
        const inputSignals = Object.create(null) as Record<string, string | undefined>;
        const outputSignals = Object.create(null) as Record<string, string | undefined>;
        const inoutSignals = Object.create(null) as Record<string, string | undefined>;

        for (const [sigName, { port, paramMap }] of mergedSignals.entries()) {
            if (!isValidVerilogIdentifier(sigName)) { continue; }
            const widthStr = this._getWidthStr(port, paramMap);
            if (port.direction === 'input') {
                inputSignals[sigName] = widthStr;
            } else if (port.direction === 'inout') {
                inoutSignals[sigName] = widthStr;
            } else {
                outputSignals[sigName] = widthStr;
            }
        }

        if (Object.keys(inputSignals).length > 0) {
            L.push('    // ---- Shared DUT input signals (reg) ----');
            for (const sig of Object.keys(inputSignals).sort()) {
                const w = inputSignals[sig];
                const identifier = identifierBeforePunctuation(sig);
                const decl = w ? `    reg ${w} ${identifier};` : `    reg ${identifier};`;
                L.push(decl);
            }
            L.push('');
        }

        if (Object.keys(outputSignals).length > 0) {
            L.push('    // ---- Shared DUT output signals (wire) ----');
            for (const sig of Object.keys(outputSignals).sort()) {
                const w = outputSignals[sig];
                const identifier = identifierBeforePunctuation(sig);
                const decl = w ? `    wire ${w} ${identifier};` : `    wire ${identifier};`;
                L.push(decl);
            }
            L.push('');
        }

        if (Object.keys(inoutSignals).length > 0) {
            L.push('    // ---- Shared DUT inout signals (wire) ----');
            for (const sig of Object.keys(inoutSignals).sort()) {
                const w = inoutSignals[sig];
                const identifier = identifierBeforePunctuation(sig);
                const decl = w ? `    wire ${w} ${identifier};` : `    wire ${identifier};`;
                L.push(decl);
            }
            L.push('');
        }

        // ---- DUT instantiations ----
        for (const { mod, ports, params } of allParsed) {
            const modName = mod.module_name || 'unknown';
            const instName = effectiveModuleInstanceIdentifier(modName, mod.instance_name);
            const portSignals = normalizeStringRecord(mod.port_signals);
            const paramValues = normalizeStringRecord(mod.param_values);

            L.push(`    // ---- DUT: ${modName} (${instName}) ----`);

            const instantiation = formatModuleInstantiation({
                moduleName: modName,
                instanceName: instName,
                parameters: params.map(param => ({
                    name: param.name,
                    value: substituteParameters(ownValue(paramValues, param.name, param.value), Object.fromEntries(params.filter(p => p.name !== param.name).map(p => [p.name, ownValue(paramValues, p.name, p.value)]))),
                })),
                ports: ports.map(port => ({
                    name: port.name,
                    value: ownValue(portSignals, port.name, port.name),
                })),
                baseIndent: '    ',
            });
            L.push(...instantiation.split('\n'));
            L.push('');
        }

        // ---- $dump ----
        L.push('    initial begin');
        L.push(`        $dumpfile("${waveFile.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\r/g, '\\r').replace(/\n/g, '\\n')}");`);
        L.push(`        $dumpvars(0, ${name});`);
        L.push('    end');
        L.push('');

        // ---- Timeout ----
        L.push('    initial begin');
        L.push(`        #(${timeout}) $finish;`);
        L.push('    end');
        L.push('');
        L.push('endmodule');
        L.push('');

        return L;
    }

    private _getWidthStr(port: Port, paramMap?: Record<string, string>): string | undefined {
        if (paramMap && port.width) {
            return resolvePortWidth(port.width, paramMap);
        }
        return port.width;
    }
}
