import type { SimulationPreset, SimulationTaskDocument, TimeScale } from '@veriflow/hdl-runtime/simulationTask';
import { clockTiming } from '@veriflow/hdl-runtime/simulationTask/timing';
import { PROTOCOL_PRESET_TEMPLATES, createProtocolPreset, protocolPresetPayloadFields, validateProtocolPreset,
    normalizeProtocolPreset, protocolPresetTransactions, type ProtocolPresetTransaction,
    type ProtocolPreset, type ProtocolPresetName } from '@veriflow/hdl-runtime/simulationTask/protocolPresets';
import type { ArchDesignInspectorField, ArchDesignInspectorModel } from '../../../../veriflow-vscode/src/schematic/webviewSupport';

export type TaskInspectorCommand = Readonly<{
    type: 'task';
    command: 'updatePreset' | 'updateTaskSettings';
    payload: unknown;
}>;
export type InspectorField = Omit<ArchDesignInspectorField, 'commit'> & {
    commit?: (value: string) => ReturnType<NonNullable<ArchDesignInspectorField['commit']>> | TaskInspectorCommand;
};
type Transition = Extract<SimulationPreset, { kind: 'stimulus' }>['transitions'][number];
export class TransitionValidationError extends Error {
    constructor(readonly rowIndex: number, readonly field: 'time' | 'value', reason: unknown) {
        super(`Transition ${rowIndex + 1} ${field}: ${reason instanceof Error ? reason.message : String(reason)}`);
    }
}
export type AuthoringInspectorModel = Omit<ArchDesignInspectorModel, 'fields'> & {
    fields: readonly InspectorField[];
    transitions?: { rows: readonly Transition[]; commit: (rows: Transition[]) => TaskInspectorCommand };
    valueTables?: { label: string; placeholder: string; rows: readonly string[]; commit: (rows: string[]) => TaskInspectorCommand }[];
    transactions?: { rows: readonly ProtocolPresetTransaction[]; role: string; burst: boolean;
        commit: (rows: ProtocolPresetTransaction[]) => TaskInspectorCommand };
};

export function defaultSimulationPreset(kind: Exclude<SimulationPreset['kind'], 'protocol'> | ProtocolPresetName): SimulationPreset {
    if (kind === 'clock') return { kind, frequencyMHz: 100, initial: 0 };
    if (kind === 'reset') return { kind, active: 0, duration: 100 };
    if (kind === 'stimulus') return { kind, width: 1, initial: "1'b0", transitions: [] };
    return createProtocolPreset(kind);
}

function number(value: string, positive = false, integer = false): number {
    const parsed = Number(value);
    if (!value.trim() || !Number.isFinite(parsed) || (positive ? parsed <= 0 : parsed < 0)
        || (integer && !Number.isSafeInteger(parsed))) {
        throw new Error(`Enter a ${positive ? 'positive' : 'non-negative'} ${integer ? 'integer' : 'number'}.`);
    }
    return parsed;
}

function stimulusValue(value: string, width: number): string {
    const text = value.trim();
    const literal = /^(\d+)'([bBoOdDhH])([0-9a-fA-FxXzZ?_]+)$/.exec(text);
    if (!literal || Number(literal[1]) > width || Number(literal[1]) < 1) throw new Error(`Enter a ${width}-bit Verilog literal matching the width.`);
    const digits = literal[3].replace(/_/g, '');
    const base = literal[2].toLowerCase();
    const valid = base === 'b' ? /^[01xz?]+$/i : base === 'o' ? /^[0-7xz?]+$/i : base === 'd' ? /^(\d+|[xz?])$/i : /^[0-9a-fxz?]+$/i;
    if (!valid.test(digits)) throw new Error('Invalid digit in stimulus value.');
    const known = digits.replace(/[xz?]/gi, '0');
    const magnitude = BigInt((base === 'b' ? '0b' : base === 'o' ? '0o' : base === 'h' ? '0x' : '') + known);
    if (magnitude.toString(2).length > Number(literal[1])) throw new Error('Stimulus value exceeds its declared width.');
    return text;
}

const timeOptions = ['s', 'ms', 'us', 'ns', 'ps', 'fs'].flatMap(unit =>
    [1, 10, 100].map(magnitude => ({ value: `${magnitude}${unit}`, label: `${magnitude}${unit}` })));
function timeSeconds(time: TimeScale): number {
    const match = /^(1|10|100)(s|ms|us|ns|ps|fs)$/.exec(time)!;
    return Number(match[1]) * ({ s: 1, ms: 1e-3, us: 1e-6, ns: 1e-9, ps: 1e-12, fs: 1e-15 }[match[2]]!);
}
const levels = [{ value: '0', label: 'Low (0)' }, { value: '1', label: 'High (1)' }];
const readonly = (id: string, label: string, value: string): InspectorField => ({ id, label, control: 'readonly', value });
const text = (id: string, label: string, value: string | number, commit: NonNullable<InspectorField['commit']>): InspectorField =>
    ({ id, label, control: 'text', value: String(value), commit });
const select = (id: string, label: string, value: string | number, options: NonNullable<InspectorField['options']>, commit: NonNullable<InspectorField['commit']>): InspectorField =>
    ({ ...text(id, label, value, commit), control: 'select', options });

export function projectSimulationTaskInspector(
    task: SimulationTaskDocument,
    moduleName: string,
    model: ArchDesignInspectorModel,
): AuthoringInspectorModel {
    const settings = task.settings;
    if (model.kind === 'design') {
        const update = (changes: Partial<typeof settings>): TaskInspectorCommand => ({
            type: 'task', command: 'updateTaskSettings', payload: { settings: { ...settings, ...changes } },
        });
        const time = (key: 'timeUnit' | 'timePrecision', value: string): TaskInspectorCommand => {
            if (!timeOptions.some(option => option.value === value)) throw new Error('Choose a supported time scale.');
            const next = { ...settings, [key]: value };
            if (timeSeconds(next.timePrecision) > timeSeconds(next.timeUnit)) throw new Error('Time precision cannot be coarser than the time unit.');
            return update({ [key]: value });
        };
        return { ...model, title: 'Simulation Task', fields: [
            readonly('task-module', 'Testbench module', moduleName),
            select('task-time-unit', 'Time unit', settings.timeUnit, timeOptions, value => time('timeUnit', value)),
            select('task-time-precision', 'Time precision', settings.timePrecision, timeOptions, value => time('timePrecision', value)),
            text('task-duration', 'End time', settings.duration, value => update({ duration: number(value, true) })),
            select('task-wave-enabled', 'Generate waveform', String(settings.waveform.enabled), [
                { value: 'true', label: 'Enabled' }, { value: 'false', label: 'Disabled' },
            ], value => update({ waveform: { ...settings.waveform, enabled: value === 'true' } })),
            text('task-wave-filename', 'Waveform filename', settings.waveform.filename, value => {
                if (!value.trim()) throw new Error('Enter a waveform filename.');
                return update({ waveform: { ...settings.waveform, filename: value.trim() } });
            }),
        ] };
    }
    if (model.kind !== 'instance') return model;
    const id = model.fields.find(field => field.id === 'instance-name')?.value;
    const instance = task.instances.find(instance => instance.id === id);
    if (!instance) return model;
    if ('source' in instance) return { ...model, fields: [
        ...model.fields, readonly('instance-source', 'Source', instance.source.path),
    ] };
    const preset = instance.preset.kind === 'protocol' ? normalizeProtocolPreset(instance.preset) : instance.preset;
    const update = (next: SimulationPreset): TaskInspectorCommand => ({
        type: 'task', command: 'updatePreset', payload: { id: instance.id, preset: next },
    });
    const fields: InspectorField[] = [
        ...model.fields.filter(field => field.id === 'instance-name'),
        readonly('preset-kind', 'Simulation Utility', preset.kind === 'protocol'
            ? ({ axis: 'AXI-STREAM', axi4lite: 'AXI-Lite', axi4: 'AXI-Full', rgb888: 'RGB' } as Record<string, string>)[preset.protocol] ?? preset.protocol.toUpperCase()
            : preset.kind[0].toUpperCase() + preset.kind.slice(1)),
    ];
    if (preset.kind === 'clock') {
        fields.push(
            text('preset-frequency', 'Frequency (MHz)', preset.frequencyMHz, value => update({ ...preset, frequencyMHz: number(value, true) })),
            readonly('preset-period', 'Period', `${clockTiming(preset, settings.timeUnit, settings.timePrecision).period} (${settings.timeUnit})`),
            select('preset-initial', 'Initial level', preset.initial, levels, value => update({ ...preset, initial: value === '1' ? 1 : 0 })),
        );
    } else if (preset.kind === 'reset') {
        fields.push(
            select('preset-active', 'Active level', preset.active, levels, value => update({ ...preset, active: value === '1' ? 1 : 0 })),
            text('preset-duration', `Duration (${settings.timeUnit})`, preset.duration, value => update({ ...preset, duration: number(value) })),
        );
    } else if (preset.kind === 'protocol') {
        const memoryBus = ['apb', 'axi4lite', 'axi4'].includes(preset.protocol);
        const templates = PROTOCOL_PRESET_TEMPLATES.filter(item => item.protocol === preset.protocol);
        const template = templates.find(item => item.role === preset.role)!;
        const commit = (next: ProtocolPreset): TaskInspectorCommand => {
            const errors = validateProtocolPreset(next, timeSeconds(settings.timePrecision) / timeSeconds(settings.timeUnit));
            if (errors.length) throw new Error(errors[0]);
            return update(next);
        };
        fields.push(
            select('preset-role', 'Role', preset.role, templates.map(item => ({ value: item.role, label: item.label })), value => {
                if (!templates.some(item => item.role === value)) throw new Error('Choose a supported role.');
                return commit({ ...createProtocolPreset(preset.protocol, value), start: preset.start, timeout: preset.timeout });
            }),
            text('preset-start', `Start time (${settings.timeUnit})`, preset.start, value => commit({ ...preset, start: number(value) })),
            text('preset-timeout', `Timeout (${settings.timeUnit})`, preset.timeout, value => commit({ ...preset, timeout: number(value, true) })),
        );
        for (const option of template.options) {
            if (memoryBus && ['address', 'write'].includes(option.key)) continue;
            const value = preset.options[option.key] ?? option.defaultValue;
            const change = (input: string): TaskInspectorCommand => {
                let nextValue: string | number | boolean = input.trim();
                if (option.kind === 'number') {
                    nextValue = number(input, false, true);
                    if (nextValue < (option.min ?? 0) || nextValue > (option.max ?? Number.MAX_SAFE_INTEGER)) throw new Error(`${option.label} is out of range.`);
                } else if (option.kind === 'boolean') nextValue = input === 'true';
                else if (option.kind === 'select') {
                    if (!option.values?.some(item => String(item.value) === input)) throw new Error(`Choose a supported ${option.label}.`);
                    if (['stopBits', 'cpol', 'cpha', 'hsyncPolarity', 'vsyncPolarity'].includes(option.key)) nextValue = Number(input);
                }
                const next = { ...preset, options: { ...preset.options, [option.key]: nextValue } };
                return commit(next);
            };
            const id = `preset-option-${option.key}`;
            if (option.kind === 'boolean') fields.push(select(id, option.label, String(value), [{ value: 'true', label: 'Yes' }, { value: 'false', label: 'No' }], change));
            else if (option.kind === 'select') fields.push(select(id, option.label, String(value), option.values!.map(item => ({ value: String(item.value), label: item.label })), change));
            else fields.push(text(id, option.label, String(value), change));
        }
        if (memoryBus) return { ...model, fields, transactions: {
            rows: protocolPresetTransactions(preset), role: preset.role, burst: preset.protocol === 'axi4',
            commit: rows => {
                const { expected: _expected, ...next } = preset;
                const { address: _address, write: _write, ...options } = preset.options;
                return commit({ ...next, data: [], options, transactions: rows });
            },
        } };
        const payload = protocolPresetPayloadFields(preset);
        const valueTables: NonNullable<AuthoringInspectorModel['valueTables']> = [];
        for (const key of ['data', 'expected'] as const) {
            if (!payload[key]) continue;
            valueTables.push({ label: key === 'data' ? 'Transmit values' : 'Expected values',
                placeholder: preset.protocol === 'rgb888' ? "24'hff0000" : "8'h5a", rows: preset[key] ?? [],
                commit: rows => commit({ ...preset, [key]: rows.map(row => row.trim()) }),
            });
        }
        return { ...model, fields, valueTables };
    } else {
        fields.push(
            text('preset-width', 'Width', preset.width, value => update({ ...preset, width: number(value, true, true) })),
            text('preset-initial', 'Initial value', preset.initial, value => update({ ...preset, initial: stimulusValue(value, preset.width) })),
        );
        return { ...model, fields, transitions: {
            rows: preset.transitions,
            commit: rows => {
                let previous = -1;
                const transitions = rows.map((row, index) => {
                    let at: number;
                    try {
                        at = number(String(row.at));
                        if (at <= previous) throw new Error('Transition times must be strictly increasing.');
                    } catch (error) { throw new TransitionValidationError(index, 'time', error); }
                    previous = at;
                    try { return { at, value: stimulusValue(row.value, preset.width) }; }
                    catch (error) { throw new TransitionValidationError(index, 'value', error); }
                });
                return update({ ...preset, transitions });
            },
        } };
    }
    return { ...model, fields };
}
