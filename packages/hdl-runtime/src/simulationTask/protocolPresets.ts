import type { SimulationTaskDocument, TaskModuleDefinition } from './model';
import { PROTOCOL_TEMPLATES, createProtocolStep, compileProtocolStep, protocolDrivenSignals, protocolPayloadFields,
    validateProtocolStep, literal, fits, type TaskProtocolName, type TaskProtocolOptions, type TaskProtocolStep, type ProtocolOptionDescriptor } from './protocols';

export type ProtocolPresetName = TaskProtocolName;
export interface ProtocolPresetOptions extends TaskProtocolOptions {
    addressWidth?: number; dataWidth?: number; idWidth?: number; includeLast?: boolean; includeError?: boolean;
}
export interface ProtocolPreset {
    kind: 'protocol'; protocol: ProtocolPresetName; role: string; start: number; timeout: number;
    data: string[]; expected?: string[]; options: ProtocolPresetOptions; transactions?: ProtocolPresetTransaction[];
}
export interface ProtocolPresetTransaction {
    operation: 'write' | 'read'; address: string; data: string[]; expected?: string[];
}
const memoryProtocol = (protocol: ProtocolPresetName) => ['apb', 'axi4lite', 'axi4'].includes(protocol);

/** Adapt saved scalar bus presets without changing their serialized documents. */
export function protocolPresetTransactions(preset: ProtocolPreset): ProtocolPresetTransaction[] {
    if (preset.transactions !== undefined) return preset.transactions;
    if (!memoryProtocol(preset.protocol)) return [];
    const operation = preset.options.write === false ? 'read' : 'write';
    const address = preset.options.address ?? '0';
    const transmitting = (preset.role === 'initiator') === (operation === 'write');
    if (preset.protocol !== 'apb') return [{ operation, address, data: transmitting ? preset.data : [],
        ...(transmitting ? {} : { expected: preset.expected ?? [] }) }];
    return (transmitting ? preset.data : preset.expected ?? []).map(value => ({ operation, address,
        data: transmitting ? [value] : [], ...(transmitting ? {} : { expected: [value] }) }));
}

/** Expose explicit RGB counter boundaries for older porch-based documents. */
export function normalizeProtocolPreset(preset: ProtocolPreset): ProtocolPreset {
    if (preset.protocol !== 'rgb888') return preset;
    const options = { ...preset.options };
    for (const axis of ['h', 'v'] as const) {
        const active = options[`${axis}Active`]!;
        const front = options[`${axis}FrontPorch`];
        const sync = options[`${axis}Sync`];
        const back = options[`${axis}BackPorch`];
        if (front !== undefined || sync !== undefined || back !== undefined) {
            options[`${axis}SyncStart`] ??= active + front!;
            options[`${axis}SyncEnd`] ??= active + front! + sync!;
            options[`${axis}Total`] ??= active + front! + sync! + back!;
        }
        delete options[`${axis}FrontPorch`]; delete options[`${axis}Sync`]; delete options[`${axis}BackPorch`];
    }
    return { ...preset, options };
}
export interface ProtocolPresetOptionDescriptor extends Omit<ProtocolOptionDescriptor, 'key'> { key: keyof ProtocolPresetOptions }
export interface ProtocolPresetTemplate {
    protocol: ProtocolPresetName; role: string; label: string; options: ProtocolPresetOptionDescriptor[];
}
const widthOption = (key: 'dataWidth' | 'addressWidth' | 'idWidth', label: string, defaultValue: number, max: number): ProtocolPresetOptionDescriptor =>
    ({ key, label, kind: 'number', defaultValue, min: 1, max });
const pinOption = (key: 'includeLast' | 'includeError', label: string): ProtocolPresetOptionDescriptor =>
    ({ key, label, kind: 'boolean', defaultValue: true });

/** Pure metadata shared by the canvas inspector and the compiler. */
export const PROTOCOL_PRESET_TEMPLATES: ProtocolPresetTemplate[] = PROTOCOL_TEMPLATES.map(template => ({
    protocol: template.protocol, role: template.role, label: template.label,
    options: [...template.options.filter(option => !(template.protocol === 'rgb888' && option.key === 'period')),
        ...(template.protocol === 'axis' ? [pinOption('includeLast', 'Include LAST pin')] : []),
        ...(template.protocol === 'apb' ? [pinOption('includeError', 'Include error pin')] : []),
        ...(['apb', 'axi4', 'axi4lite'].includes(template.protocol) ? [widthOption('addressWidth', 'Address width', 32, 64)] : []),
        ...(['apb', 'axis', 'axi4', 'axi4lite'].includes(template.protocol) ? [widthOption('dataWidth', 'Data width', 32, 1024)] : []),
        ...(template.protocol === 'axi4' ? [widthOption('idWidth', 'ID width', 4, 32)] : [])],
})).sort((a, b) => ['uart', 'spi', 'i2c', 'apb', 'axis', 'axi4lite', 'axi4', 'rgb888'].indexOf(a.protocol)
    - ['uart', 'spi', 'i2c', 'apb', 'axis', 'axi4lite', 'axi4', 'rgb888'].indexOf(b.protocol));

export function createProtocolPreset(protocol: ProtocolPresetName, role?: string): ProtocolPreset {
    const template = PROTOCOL_PRESET_TEMPLATES.find(item => item.protocol === protocol && (role === undefined || item.role === role));
    if (!template) throw new Error(`Unsupported protocol role ${protocol}/${role}.`);
    const previous = createProtocolStep(protocol, template.role);
    const options = Object.fromEntries(template.options.map(option => [option.key,
        ['hsyncPolarity', 'vsyncPolarity', 'stopBits', 'cpol', 'cpha'].includes(option.key) ? Number(option.defaultValue) : option.defaultValue])) as ProtocolPresetOptions;
    const preset: ProtocolPreset = { kind: 'protocol', protocol, role: template.role, start: 0, timeout: 10000,
        data: previous.data, ...(previous.expected ? { expected: previous.expected } : {}), options };
    if (memoryProtocol(protocol)) {
        preset.transactions = protocolPresetTransactions(preset);
        preset.data = []; delete preset.expected; delete options.write; delete options.address;
    }
    return preset;
}

/** Map compiler signal roles to the standard HDL pins recognized by AD. */
function protocolPresetPortName(preset: ProtocolPreset, signal: string): string {
    const master = preset.role === 'initiator' || preset.role === 'source';
    const prefix = master ? 'm' : 's';
    if (preset.protocol === 'apb') {
        const member = ({ select: 'psel', enable: 'penable', address: 'paddr', write: 'pwrite',
            wdata: 'pwdata', rdata: 'prdata', ready: 'pready', error: 'pslverr' } as Record<string, string>)[signal];
        return member ? `${prefix}_apb_${member}` : signal;
    }
    if (preset.protocol === 'axis' && ['data', 'valid', 'ready', 'last'].includes(signal)) return `${prefix}_axis_t${signal}`;
    if (preset.protocol === 'axi4' || preset.protocol === 'axi4lite') return `${prefix}_axi_${signal}`;
    return signal;
}

/** Resolve old scalar pin references at the graph boundary without editing the saved task. */
export function resolveProtocolPresetPorts(task: SimulationTaskDocument): SimulationTaskDocument {
    const aliases = new Map(task.instances.flatMap(instance => 'preset' in instance && instance.preset.kind === 'protocol'
        ? [[instance.id, compilerStep(instance.preset).signals] as const] : []));
    const portName = (instance: string, port: string) => aliases.get(instance)?.[port] ?? port;
    const defaults = (values: Readonly<Record<string, string>>) => Object.fromEntries(Object.entries(values).map(([key, value]) => {
        const separator = key.indexOf('.');
        return [separator < 0 ? key : `${key.slice(0, separator)}.${portName(key.slice(0, separator), key.slice(separator + 1))}`, value];
    }));
    return { ...task, defaults: defaults(task.defaults), connections: task.connections.map(connection => ({ ...connection,
        endpoints: connection.endpoints.map(endpoint => endpoint.kind === 'instance'
            ? { ...endpoint, port: portName(endpoint.instance, endpoint.port) } : endpoint),
        ...(connection.defaults ? { defaults: defaults(connection.defaults) } : {}),
    })) };
}

function compilerStep(preset: ProtocolPreset): TaskProtocolStep {
    preset = normalizeProtocolPreset(preset);
    const template = PROTOCOL_TEMPLATES.find(item => item.protocol === preset.protocol && item.role === preset.role);
    if (!template) throw new Error('Unsupported protocol or role.');
    const { addressWidth: _addressWidth, dataWidth: _dataWidth, idWidth: _idWidth, includeLast, includeError, ...options } = preset.options;
    const optionalSignals = (template.optionalSignals ?? []).filter(name => !(name === 'last' && includeLast === false) && !(name === 'error' && includeError === false));
    // The legacy pixel engine uses an option for validation; clock edges are now supplied by the canvas.
    if (preset.protocol === 'rgb888' && preset.role === 'source') options.period = 10;
    return { kind: 'protocol', protocol: preset.protocol, role: preset.role, timeout: preset.timeout,
        data: preset.data, ...(preset.expected === undefined ? {} : { expected: preset.expected }), options,
        signals: Object.fromEntries([...template.signals, ...optionalSignals].map(name => [name, protocolPresetPortName(preset, name)])),
        ...(template.clock ? { clock: 'clk' } : {}) };
}

export function protocolPresetPayloadFields(preset: ProtocolPreset): { data: boolean; expected: boolean } {
    const fields = protocolPayloadFields(compilerStep(preset));
    return { data: fields.data, expected: fields.expected };
}

export function describeProtocolPreset(preset: ProtocolPreset): TaskModuleDefinition {
    const step = compilerStep(preset), outputs = new Set(protocolDrivenSignals(step));
    const o = preset.options;
    const width = (name: string): number => {
        if (preset.protocol === 'apb') return name === 'address' ? o.addressWidth ?? 32 : ['wdata', 'rdata'].includes(name) ? o.dataWidth ?? 32 : 1;
        if (preset.protocol === 'axis') return name === 'data' ? o.dataWidth ?? 32 : 1;
        if (preset.protocol === 'rgb888') return ['r', 'g', 'b'].includes(name) ? 8 : 1;
        if (preset.protocol === 'axi4' || preset.protocol === 'axi4lite') {
            if (name.endsWith('addr')) return o.addressWidth ?? 32;
            if (name.endsWith('data')) return o.dataWidth ?? 32;
            if (['awid', 'arid', 'bid', 'rid'].includes(name)) return o.idWidth ?? 4;
            if (name === 'wstrb') return (o.dataWidth ?? 32) / 8;
            if (name.endsWith('len')) return 8;
            if (name.endsWith('size')) return 3;
            if (name.endsWith('resp') || name.endsWith('burst')) return 2;
        }
        return 1;
    };
    const ports: TaskModuleDefinition['ports'] = Object.entries(step.signals).map(([signal, name]) => ({ name, width: width(signal),
        direction: preset.protocol === 'i2c' ? 'inout' : outputs.has(name) ? 'output' : 'input' }));
    if (step.clock || preset.protocol === 'rgb888' && preset.role === 'source') ports.unshift({ name: 'clk', width: 1, direction: 'input' });
    return { source: `preset:${preset.protocol}:${preset.role}`, module: `__veriflow_st_${preset.protocol}_${preset.role}`, parameters: [], ports };
}

function compile(preset: ProtocolPreset, tick: number) {
    const errors = validateProtocolPreset(preset, tick);
    if (errors.length) throw new Error(errors[0]);
    const step = compilerStep(preset), ports = describeProtocolPreset(preset).ports;
    const context = { path: 'preset', prefix: 'vf_preset', tick, clocks: {},
        netWidths: Object.fromEntries(ports.map(port => [port.name, Number(port.width)])),
        ...(preset.protocol === 'i2c' ? { writeTargets: { scl: 'vf_preset_drive_scl', sda: 'vf_preset_drive_sda' } } : {}) };
    if (memoryProtocol(preset.protocol)) {
        const rows = protocolPresetTransactions(preset);
        if (!rows.length) throw new Error('Provide at least one bus transaction.');
        const compiled = rows.map((row, index) => {
            if (!row.address) throw new Error(`transactions[${index}].address: Provide an address literal.`);
            const transmitting = (preset.role === 'initiator') === (row.operation === 'write');
            const values = transmitting ? row.data : row.expected;
            if (!values?.length) throw new Error(`transactions[${index}]: Provide ${transmitting ? 'data' : 'expected'} values.`);
            if (preset.protocol !== 'axi4' && values.length !== 1) throw new Error(`transactions[${index}]: APB and AXI-Lite require exactly one beat.`);
            return compileProtocolStep({ ...step, data: transmitting ? row.data : [], expected: transmitting ? undefined : row.expected,
                options: { ...step.options, address: row.address, write: row.operation === 'write' } },
            { ...context, prefix: `vf_preset_row_${index}` });
        });
        return { declarations: compiled.flatMap(item => item.declarations), statements: compiled.flatMap(item => item.statements) };
    }
    const payload = protocolPayloadFields(step);
    if (!payload.data) step.data = [];
    if (!payload.expected) delete step.expected;
    return compileProtocolStep(step, context);
}

/** Returns actionable errors for untrusted inspector/host payloads. No file access or application state. */
export function validateProtocolPreset(value: unknown, tick = 0): string[] {
    try {
        if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Protocol preset must be an object.');
        let p = value as ProtocolPreset;
        const allowed = ['kind', 'protocol', 'role', 'start', 'timeout', 'data', 'expected', 'options', 'transactions'];
        for (const key of Object.keys(p)) if (!allowed.includes(key)) throw new Error(`Unsupported preset field ${key}.`);
        if (p.kind !== 'protocol') throw new Error('Expected protocol preset.');
        const template = PROTOCOL_PRESET_TEMPLATES.find(item => item.protocol === p.protocol && item.role === p.role);
        if (!template) throw new Error('Unsupported protocol or role.');
        if (!Number.isFinite(p.start) || p.start < 0) throw new Error('Start time must be nonnegative.');
        if (!p.options || typeof p.options !== 'object' || Array.isArray(p.options)) throw new Error('Protocol options must be an object.');
        if (p.protocol === 'rgb888') {
            for (const key of ['hFrontPorch', 'hSync', 'hBackPorch', 'vFrontPorch', 'vSync', 'vBackPorch'] as const) {
                const value = p.options[key];
                if (value !== undefined && (!Number.isInteger(value) || value < (key.endsWith('Sync') ? 1 : 0) || value > 8192)) throw new Error(`Invalid legacy timing option ${key}.`);
            }
            p = normalizeProtocolPreset(p);
        }
        for (const [key, option] of Object.entries(p.options)) {
            const descriptor = template.options.find(item => item.key === key);
            if (!descriptor) throw new Error(`Unsupported option ${key}.`);
            if (descriptor.kind === 'boolean' && typeof option !== 'boolean') throw new Error(`${key} must be a boolean.`);
            if (descriptor.kind === 'number' && (!Number.isInteger(option) || Number(option) < descriptor.min! || Number(option) > descriptor.max!)) throw new Error(`${key} must be an integer from ${descriptor.min} through ${descriptor.max}.`);
        }
        if (p.protocol === 'axi4lite' && ![32, 64].includes(p.options.dataWidth ?? 32)) throw new Error('AXI4-Lite data width must be 32 or 64.');
        if (p.protocol === 'axi4') {
            const bytes = (p.options.dataWidth ?? 32) / 8;
            if (!Number.isInteger(bytes) || bytes < 1 || bytes > 128 || (bytes & (bytes - 1))) throw new Error('AXI4 data width must be a power of two from 8 through 1024.');
        }
        const step = compilerStep(p);
        if (memoryProtocol(p.protocol)) step.options = { ...step.options, write: p.options.write ?? true, address: p.options.address ?? '0' };
        const errors = validateProtocolStep(step, 'preset').filter(error => !/^preset\.(data|expected)$/.test(error.path)
            && !(p.protocol === 'rgb888' && error.path === 'preset.options.timing'));
        if (errors.length) throw new Error(`${errors[0].path}: ${errors[0].message}`);
        const payloadWidth = ['uart', 'spi'].includes(p.protocol) ? p.options.width ?? 8 : p.protocol === 'i2c' ? 8 : p.protocol === 'rgb888' ? 24 : p.options.dataWidth ?? 32;
        for (const [field, values] of [['data', p.data], ['expected', p.expected]] as const) {
            if (values === undefined && field === 'expected') continue;
            if (!Array.isArray(values) || values.length > 4096) throw new Error(`${field} must contain at most 4096 literals.`);
            for (const value of values) if (!literal(value) || !fits(value, payloadWidth)) throw new Error(`${field} literal must fit ${payloadWidth} bits without truncation.`);
        }
        for (const [key, bits] of [['address', p.protocol === 'i2c' ? 7 : p.options.addressWidth ?? 32], ['id', p.options.idWidth ?? 4], ['strobe', (p.options.dataWidth ?? 32) / 8]] as const) {
            const value = p.options[key];
            if (value !== undefined && (!literal(value) || !fits(value, bits))) throw new Error(`${key} must fit ${bits} bits without truncation.`);
        }
        if (p.transactions !== undefined) {
            if (!memoryProtocol(p.protocol)) throw new Error('Transactions are supported only for APB and AXI memory buses.');
            if (!Array.isArray(p.transactions) || p.transactions.length > 4096) throw new Error('transactions must contain at most 4096 rows.');
            for (const [index, row] of p.transactions.entries()) {
                if (!row || typeof row !== 'object' || Array.isArray(row)) throw new Error(`transactions[${index}] must be an object.`);
                for (const key of Object.keys(row)) if (!['operation', 'address', 'data', 'expected'].includes(key)) throw new Error(`Unsupported transaction field ${key}.`);
                if (!['write', 'read'].includes(row.operation)) throw new Error(`transactions[${index}].operation must be write or read.`);
                if (row.address !== '' && (!literal(row.address) || /[xz?]/i.test(row.address) || !fits(row.address, p.options.addressWidth ?? 32))) throw new Error(`transactions[${index}].address must fit ${p.options.addressWidth ?? 32} bits without truncation.`);
                const transmitting = (p.role === 'initiator') === (row.operation === 'write');
                for (const [field, values] of [['data', row.data], ['expected', row.expected]] as const) {
                    if (field === 'expected' && values === undefined) continue;
                    if (!Array.isArray(values) || values.length > 4096) throw new Error(`transactions[${index}].${field} must contain at most 4096 literals.`);
                    for (const value of values) if (!literal(value) || !fits(value, payloadWidth)) throw new Error(`transactions[${index}].${field} literal must fit ${payloadWidth} bits without truncation.`);
                    if (values.length && (field === 'data') !== transmitting) throw new Error(`transactions[${index}].${field} is unused for this role and operation.`);
                }
            }
        }
        for (const [label, delay] of [['start', p.start], ['timeout', p.timeout], ['half period', p.options.period === undefined ? 1 : p.options.period / 2]] as const) {
            if (!Number.isFinite(delay) || (label === 'start' ? delay < 0 : delay <= 0) || tick > 0 && (delay < (label === 'start' ? 0 : tick) || Math.abs(delay / tick - Math.round(delay / tick)) > 1e-6)) throw new Error(`${label} must be representable at the task precision.`);
        }
        return [];
    } catch (error) { return [error instanceof Error ? error.message : String(error)]; }
}

export function renderProtocolPreset(preset: ProtocolPreset, moduleName: string, tick: number): string {
    const compiled = compile(preset, tick), ports = describeProtocolPreset(preset).ports;
    const declarations = ports.map(port => {
        const wireOutput = preset.protocol === 'rgb888' && port.name === 'pclk';
        return `    ${port.direction}${port.direction === 'output' && !wireOutput ? ' reg' : ''}${Number(port.width) > 1 ? ` [${Number(port.width) - 1}:0]` : ''} ${port.name}`;
    });
    const drain = preset.protocol === 'i2c' ? ['scl', 'sda'].flatMap(name => [
        `reg vf_preset_drive_${name} = 1'bz;`, `assign ${name} = vf_preset_drive_${name};`, `pullup(${name});`]) : [];
    return [`module ${moduleName}(`, declarations.join(',\n'), ');', "reg vf_completed = 1'b0;", ...drain, ...compiled.declarations,
        'task vf_run;', 'begin', ...compiled.statements, 'end', 'endtask',
        `initial begin #(${preset.start}); vf_run; vf_completed = 1'b1; end`, 'endmodule', ''].join('\n');
}
