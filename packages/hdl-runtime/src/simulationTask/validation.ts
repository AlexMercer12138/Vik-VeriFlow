import { createEmptyArchDesign, parseArchDesignValue, isSafeDefaultExpression } from '@veriflow/schematic-core/arch-design';
import type { SimulationTaskDocument, SimulationPreset, TimeScale } from './model';
import { clockTiming, timeScaleFemtoseconds, numberRatio } from './timing';
import { validateProtocolPreset } from './protocolPresets';

function fail(message: string): never { throw new Error(`Unsupported or invalid Simulation Task: ${message}`); }
function record(value: unknown, keys: readonly string[], label: string): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${label} must be an object`);
    for (const key of Object.keys(value)) if (!keys.includes(key)) fail(`${label}.${key} is unsupported`);
    return value as Record<string, unknown>;
}
function identifier(value: unknown, label: string): void {
    if (typeof value !== 'string' || !/^[A-Za-z_][A-Za-z0-9_$]*$/.test(value)) fail(`${label} must be a Verilog identifier`);
}
function relativePath(value: unknown, label: string): void {
    if (typeof value !== 'string' || !value.trim() || /^(?:[A-Za-z]:|[\\/])/.test(value) || /[\r\n\0]/.test(value)) fail(`${label} must be a relative file path`);
}
function time(value: unknown, unit: TimeScale, precision: TimeScale, label: string, positive = false): void {
    if (typeof value !== 'number' || !Number.isFinite(value) || (positive ? value <= 0 : value < 0)) fail(`${label} must be ${positive ? 'positive' : 'nonnegative'}`);
    const [n, d] = numberRatio(value);
    const numerator = n * BigInt(timeScaleFemtoseconds(unit));
    const denominator = d * BigInt(timeScaleFemtoseconds(precision));
    if (numerator % denominator !== 0n || numerator / denominator > BigInt(Number.MAX_SAFE_INTEGER)) fail(`${label} cannot be represented exactly at the task precision`);
}
function literal(value: unknown, width: number, label: string): void {
    if (typeof value !== 'string') fail(`${label} must be a Verilog literal`);
    const match = /^(\d+)'([bBoOdDhH])([0-9a-fA-F_xXzZ?]+)$/.exec(value);
    if (!match || Number(match[1]) < 1 || Number(match[1]) > width) fail(`${label} must be a sized literal compatible with width ${width}`);
    const digits = match[3].replace(/_/g, '').toLowerCase();
    const base = match[2].toLowerCase();
    const declaredWidth = Number(match[1]);
    const valid = base === 'b' ? /^[01xz?]+$/ : base === 'o' ? /^[0-7xz?]+$/ : base === 'd' ? /^(?:[0-9]+|[xz?])$/ : /^[0-9a-fxz?]+$/;
    if (!valid.test(digits)) fail(`${label} contains invalid digits`);
    if (!/[xz?]/.test(digits)) {
        const n = BigInt(base === 'd' ? digits : `${base === 'b' ? '0b' : base === 'o' ? '0o' : '0x'}${digits}`);
        if (n >= (1n << BigInt(declaredWidth))) fail(`${label} exceeds its declared width ${declaredWidth}`);
    } else if (base !== 'd' && digits.length * (base === 'h' ? 4 : base === 'o' ? 3 : 1) > declaredWidth + (base === 'h' ? 3 : base === 'o' ? 2 : 0)) fail(`${label} exceeds its declared width ${declaredWidth}`);
}

function graphShape(task: SimulationTaskDocument): void {
    const width = (value: unknown) => { if (value && typeof value === 'object') record(value, ['expression'], 'width'); };
    const defaults = (value: unknown, label: string) => {
        if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${label} must be an object`);
        for (const expression of Object.values(value)) if (typeof expression !== 'string') fail(`${label} values must be strings`);
    };
    defaults(task.defaults, 'defaults');
    for (const raw of task.connections) {
        const connection = record(raw, ['name', 'endpoints', 'defaults'], 'connection');
        if (!Array.isArray(connection.endpoints)) fail('Connection endpoints must be an array');
        if (connection.defaults !== undefined) defaults(connection.defaults, 'connection.defaults');
        for (const rawEndpoint of connection.endpoints) {
            const endpoint = record(rawEndpoint, ['kind', 'instance', 'logic', 'port'], 'endpoint');
            if (endpoint.kind !== 'instance' && endpoint.kind !== 'logic') fail('ST endpoints must refer to instances or logic');
            if (endpoint.kind === 'instance' && 'logic' in endpoint || endpoint.kind === 'logic' && 'instance' in endpoint) fail('Invalid endpoint fields');
        }
    }
    const operationFields: Record<string, string[]> = {
        constant: ['width', 'expression'], not: ['width'], mux: ['width'],
        and: ['width', 'inputCount'], or: ['width', 'inputCount'], xor: ['width', 'inputCount'], nand: ['width', 'inputCount'], nor: ['width', 'inputCount'], xnor: ['width', 'inputCount'],
        concat: ['inputWidths'], slice: ['inputWidth', 'msb', 'lsb'], replicate: ['inputWidth', 'count'],
        'zero-extend': ['inputWidth', 'outputWidth'], 'sign-extend': ['inputWidth', 'outputWidth'],
        'reduce-and': ['inputWidth'], 'reduce-or': ['inputWidth'], 'reduce-xor': ['inputWidth'],
    };
    for (const item of task.logic) {
        const node = record(item, ['name', 'operation', ...(operationFields[item?.operation] ?? [])], 'logic');
        for (const key of ['width', 'inputWidth', 'outputWidth']) width(node[key]);
        if (Array.isArray(node.inputWidths)) node.inputWidths.forEach(width);
    }
    for (const raw of task.interfaceConnections) {
        const connection = record(raw, ['name', 'master', 'slave', 'defaults'], 'interfaceConnection');
        if (connection.defaults !== undefined) defaults(connection.defaults, 'interfaceConnection.defaults');
        for (const rawEndpoint of [connection.master, connection.slave]) {
            const endpoint = record(rawEndpoint, ['kind', 'instance', 'interface'], 'interfaceEndpoint');
            if (endpoint.kind !== 'instance') fail('ST cannot connect an external interface port');
        }
    }
    if (!task.interfaceOverrides || typeof task.interfaceOverrides !== 'object' || Array.isArray(task.interfaceOverrides)) fail('interfaceOverrides must be an object');
    for (const value of Object.values(task.interfaceOverrides)) record(value, ['protocol', 'role'], 'interfaceOverride');
    const presentation = record(task.presentation, ['nodes', 'collapsedInterfaces'], 'presentation');
    if (presentation.nodes && typeof presentation.nodes === 'object') for (const node of Object.values(presentation.nodes)) record(node, ['column', 'order', 'offset', 'userPositioned'], 'placement');
}
export function validatePreset(preset: SimulationPreset, settings: SimulationTaskDocument['settings']): void {
    const { timeUnit: unit, timePrecision: precision } = settings;
    if (preset?.kind === 'protocol') {
        const errors = validateProtocolPreset(preset, timeScaleFemtoseconds(precision) / timeScaleFemtoseconds(unit));
        if (errors.length) fail(errors.join('\n'));
        time(preset.start, unit, precision, 'Protocol start');
        time(preset.timeout, unit, precision, 'Protocol timeout', true);
        if (preset.options.period !== undefined) time(preset.options.period / 2, unit, precision, 'Protocol half period', true);
        return;
    }
    const p = record(preset, ['kind', ...(preset?.kind === 'clock' ? ['frequencyMHz', 'initial'] : preset?.kind === 'reset' ? ['active', 'duration'] : ['width', 'initial', 'transitions'])], 'preset');
    if (p.kind === 'clock') {
        if (typeof p.frequencyMHz !== 'number' || !Number.isFinite(p.frequencyMHz) || p.frequencyMHz <= 0) fail('Clock frequency must be positive');
        if (p.initial !== 0 && p.initial !== 1) fail('Clock initial must be 0 or 1');
        try { clockTiming(preset as Extract<SimulationPreset, { kind: 'clock' }>, unit, precision); }
        catch (error) { fail(error instanceof Error ? error.message : String(error)); }
    } else if (p.kind === 'reset') {
        if (p.active !== 0 && p.active !== 1) fail('Reset active must be 0 or 1');
        time(p.duration, unit, precision, 'Reset duration');
    } else if (p.kind === 'stimulus') {
        if (!Number.isSafeInteger(p.width) || (p.width as number) < 1 || (p.width as number) > 1048576) fail('Stimulus width must be a positive integer up to 1048576');
        literal(p.initial, p.width as number, 'Stimulus initial');
        if (!Array.isArray(p.transitions)) fail('Stimulus transitions must be an array');
        let previous = -1;
        for (const value of p.transitions) {
            const row = record(value, ['at', 'value'], 'transition');
            time(row.at, unit, precision, 'Stimulus time');
            if ((row.at as number) <= previous) fail('Stimulus times must be strictly increasing');
            previous = row.at as number;
            literal(row.value, p.width as number, 'Stimulus value');
        }
    } else fail('Unknown preset kind');
}

/** Parse the first supported schema strictly; this deliberately has no migration path. */
export function parseSimulationTask(text: string): SimulationTaskDocument {
    const task = record(JSON.parse(text), ['format', 'schemaVersion', 'settings', 'instances', 'connections', 'logic', 'defaults', 'interfaceConnections', 'interfaceOverrides', 'presentation'], 'task');
    if (task.format !== 'veriflow-simulation-task' || task.schemaVersion !== 1) fail('format/schema version');
    const settings = record(task.settings, ['timeUnit', 'timePrecision', 'duration', 'waveform', 'exportPath'], 'settings');
    const unit = settings.timeUnit as TimeScale, precision = settings.timePrecision as TimeScale;
    if (timeScaleFemtoseconds(precision) > timeScaleFemtoseconds(unit)) fail('Time precision cannot be coarser than time unit');
    time(settings.duration, unit, precision, 'Task duration', true);
    if (settings.exportPath !== undefined) relativePath(settings.exportPath, 'Export path');
    const waveform = record(settings.waveform, ['enabled', 'filename'], 'waveform');
    if (typeof waveform.enabled !== 'boolean') fail('Waveform enabled must be boolean');
    if (typeof waveform.filename !== 'string' || !/^[^\\/:*?"<>|\r\n\0]+\.vcd$/i.test(waveform.filename) || waveform.filename === '.vcd') fail('Waveform filename must be a .vcd basename');
    if (!Array.isArray(task.instances)) fail('instances must be an array');
    const ids = new Set<string>();
    for (const raw of task.instances) {
        const instance = record(raw, raw && 'preset' in raw ? ['id', 'preset'] : ['id', 'source', 'parameters'], 'instance');
        identifier(instance.id, 'Instance id');
        if (ids.has(instance.id as string)) fail(`Duplicate instance ${instance.id}`);
        ids.add(instance.id as string);
        if ('preset' in instance) validatePreset(instance.preset as SimulationPreset, settings as SimulationTaskDocument['settings']);
        else {
            const source = record(instance.source, ['kind', 'path', 'module'], 'source');
            if (source.kind !== 'hdl' && source.kind !== 'ad') fail('Source must be HDL or AD');
            relativePath(source.path, 'Source path');
            if (source.kind === 'hdl') identifier(source.module, 'Module');
            else if ('module' in source) fail('AD source.module is unsupported');
            if (!instance.parameters || typeof instance.parameters !== 'object' || Array.isArray(instance.parameters)) fail('parameters must be an object');
            for (const [name, value] of Object.entries(instance.parameters)) {
                identifier(name, 'Parameter');
                if (typeof value !== 'string' || !isSafeDefaultExpression(value)) fail(`Unsafe parameter ${name}`);
            }
        }
    }
    for (const key of ['connections', 'logic', 'interfaceConnections']) if (!Array.isArray(task[key])) fail(`${key} must be an array`);
    const document = task as unknown as SimulationTaskDocument;
    graphShape(document);
    for (const connection of document.connections) for (const endpoint of connection.endpoints ?? []) if (endpoint.kind === 'port') fail('ST cannot connect an external port');
    for (const connection of document.interfaceConnections) if (connection.master?.kind === 'port' || connection.slave?.kind === 'port') fail('ST cannot connect an external interface port');
    const parsed = parseArchDesignValue({ ...createEmptyArchDesign('simulation_tb'),
        instances: document.instances.map(i => ({ name: i.id, module: 'placeholder' })),
        connections: document.connections, logic: document.logic, defaults: document.defaults, interfaceConnections: document.interfaceConnections,
        interfaceOverrides: document.interfaceOverrides, presentation: document.presentation });
    if (parsed.status !== 'editable') fail(parsed.status === 'invalid' ? parsed.diagnostics.map(d => d.message).join('\n') : 'graph');
    return document;
}
