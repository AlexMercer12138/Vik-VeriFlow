const isTaskIdentifier = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z_][A-Za-z0-9_$]*$/.test(value);
import { compileI2cProtocol } from './protocols/i2c';
import { compileAxiProtocol } from './protocols/axi';
import { compileRgb888Protocol } from './protocols/rgb888';
import { validateAdvancedProtocol } from './protocols/validation';

export type TaskProtocolName = 'uart' | 'spi' | 'apb' | 'axis' | 'i2c' | 'axi4' | 'axi4lite' | 'rgb888';

export interface TaskProtocolOptions {
    width?: number; period?: number; cpol?: 0 | 1; cpha?: 0 | 1;
    parity?: 'none' | 'even' | 'odd'; stopBits?: 1 | 2;
    waitCycles?: number; address?: string; write?: boolean;
    repeatedStart?: boolean; stretchCycles?: number; targetAck?: boolean;
    id?: string; burst?: 'fixed' | 'incr' | 'wrap'; response?: 'okay' | 'exokay' | 'slverr' | 'decerr'; strobe?: string;
    hTotal?: number; hSyncStart?: number; hSyncEnd?: number;
    vTotal?: number; vSyncStart?: number; vSyncEnd?: number;
    hActive?: number; hFrontPorch?: number; hSync?: number; hBackPorch?: number;
    vActive?: number; vFrontPorch?: number; vSync?: number; vBackPorch?: number;
    hsyncPolarity?: 0 | 1; vsyncPolarity?: 0 | 1; frames?: number; pattern?: 'colorBars' | 'pixels';
}

export interface TaskProtocolStep {
    kind: 'protocol';
    protocol: TaskProtocolName;
    role: string;
    signals: Record<string, string>;
    clock?: string;
    timeout: number;
    data: string[];
    expected?: string[];
    options?: TaskProtocolOptions;
}

export interface ProtocolOptionDescriptor {
    key: keyof TaskProtocolOptions; label: string; kind: 'number' | 'boolean' | 'select' | 'literal';
    defaultValue: number | boolean | string; min?: number; max?: number;
    values?: Array<{ value: string | number; label: string }>;
}

export interface ProtocolTemplate {
    protocol: TaskProtocolStep['protocol']; role: string; label: string;
    signals: string[]; optionalSignals?: string[]; clock: boolean;
    options: ProtocolOptionDescriptor[];
}

const numberOption = (key: keyof TaskProtocolOptions, label: string, defaultValue: number, min: number, max: number): ProtocolOptionDescriptor =>
    ({ key, label, kind: 'number', defaultValue, min, max });
const booleanOption = (key: keyof TaskProtocolOptions, label: string, defaultValue: boolean): ProtocolOptionDescriptor =>
    ({ key, label, kind: 'boolean', defaultValue });
const literalOption = (key: keyof TaskProtocolOptions, label: string, defaultValue: string): ProtocolOptionDescriptor =>
    ({ key, label, kind: 'literal', defaultValue });
const selectOption = (key: keyof TaskProtocolOptions, label: string, defaultValue: string, values: string[]): ProtocolOptionDescriptor =>
    ({ key, label, kind: 'select', defaultValue, values: values.map(value => ({ value, label: value })) });

const AXI4_SIGNALS = ['awid', 'awaddr', 'awlen', 'awsize', 'awburst', 'awvalid', 'awready', 'wdata', 'wstrb', 'wlast', 'wvalid', 'wready', 'bid', 'bresp', 'bvalid', 'bready', 'arid', 'araddr', 'arlen', 'arsize', 'arburst', 'arvalid', 'arready', 'rid', 'rdata', 'rresp', 'rlast', 'rvalid', 'rready'];
const AXI4LITE_SIGNALS = ['awaddr', 'awvalid', 'awready', 'wdata', 'wstrb', 'wvalid', 'wready', 'bresp', 'bvalid', 'bready', 'araddr', 'arvalid', 'arready', 'rdata', 'rresp', 'rvalid', 'rready'];
const RGB_OPTIONS = [numberOption('period', 'Pixel clock period', 10, 2, 1000000),
    numberOption('hTotal', 'H total', 11, 1, 32768), numberOption('hActive', 'H active', 8, 1, 8192),
    numberOption('hSyncStart', 'H sync start', 9, 0, 32768), numberOption('hSyncEnd', 'H sync end', 10, 1, 32768),
    numberOption('vTotal', 'V total', 4, 1, 32768), numberOption('vActive', 'V active', 1, 1, 8192),
    numberOption('vSyncStart', 'V sync start', 2, 0, 32768), numberOption('vSyncEnd', 'V sync end', 3, 1, 32768),
    selectOption('hsyncPolarity', 'HSYNC polarity', '1', ['0', '1']), selectOption('vsyncPolarity', 'VSYNC polarity', '1', ['0', '1']),
    numberOption('frames', 'Frames', 1, 1, 1000), selectOption('pattern', 'Pixel pattern', 'colorBars', ['colorBars', 'pixels'])];

export const PROTOCOL_TEMPLATES: ProtocolTemplate[] = [
    { protocol: 'uart', role: 'tx', label: 'UART transmitter', signals: ['data'], clock: false, options: [numberOption('width', 'Data bits', 8, 5, 9), numberOption('period', 'Bit period', 100, 2, 1000000), selectOption('parity', 'Parity', 'none', ['none', 'even', 'odd']), selectOption('stopBits', 'Stop bits', '1', ['1', '2'])] },
    { protocol: 'uart', role: 'rx', label: 'UART receiver', signals: ['data'], clock: false, options: [numberOption('width', 'Data bits', 8, 5, 9), numberOption('period', 'Bit period', 100, 2, 1000000), selectOption('parity', 'Parity', 'none', ['none', 'even', 'odd']), selectOption('stopBits', 'Stop bits', '1', ['1', '2'])] },
    { protocol: 'spi', role: 'controller', label: 'SPI controller', signals: ['sclk', 'cs', 'mosi', 'miso'], clock: false, options: [numberOption('width', 'Word width', 8, 1, 32), numberOption('period', 'Clock period', 10, 2, 1000000), selectOption('cpol', 'Clock polarity', '0', ['0', '1']), selectOption('cpha', 'Clock phase', '0', ['0', '1'])] },
    { protocol: 'spi', role: 'peripheral', label: 'SPI peripheral', signals: ['sclk', 'cs', 'mosi', 'miso'], clock: false, options: [numberOption('width', 'Word width', 8, 1, 32), numberOption('period', 'Clock period', 10, 2, 1000000), selectOption('cpol', 'Clock polarity', '0', ['0', '1']), selectOption('cpha', 'Clock phase', '0', ['0', '1'])] },
    { protocol: 'apb', role: 'initiator', label: 'APB initiator', signals: ['select', 'enable', 'address', 'write', 'wdata', 'rdata', 'ready'], optionalSignals: ['error'], clock: true, options: [literalOption('address', 'Address', '0'), booleanOption('write', 'Write', true)] },
    { protocol: 'apb', role: 'responder', label: 'APB responder', signals: ['select', 'enable', 'address', 'write', 'wdata', 'rdata', 'ready'], optionalSignals: ['error'], clock: true, options: [literalOption('address', 'Address', '0'), booleanOption('write', 'Write', true), numberOption('waitCycles', 'Wait cycles', 0, 0, 1000000)] },
    { protocol: 'axis', role: 'source', label: 'AXI-STREAM source', signals: ['data', 'valid', 'ready'], optionalSignals: ['last'], clock: true, options: [] },
    { protocol: 'axis', role: 'sink', label: 'AXI-STREAM sink', signals: ['data', 'valid', 'ready'], optionalSignals: ['last'], clock: true, options: [numberOption('waitCycles', 'Backpressure cycles', 0, 0, 1000000)] },
    { protocol: 'axis', role: 'monitor', label: 'AXI-STREAM monitor', signals: ['data', 'valid', 'ready'], optionalSignals: ['last'], clock: true, options: [] },
    { protocol: 'i2c', role: 'controller', label: 'I2C controller', signals: ['scl', 'sda'], clock: false, options: [numberOption('period', 'Clock period', 10, 2, 1000000), literalOption('address', '7-bit address', "7'h50"), booleanOption('write', 'Write', true), booleanOption('repeatedStart', 'Repeated START read', false)] },
    { protocol: 'i2c', role: 'target', label: 'I2C target', signals: ['scl', 'sda'], clock: false, options: [numberOption('period', 'Clock period', 10, 2, 1000000), literalOption('address', '7-bit address', "7'h50"), booleanOption('write', 'Write', true), booleanOption('repeatedStart', 'Repeated START read', false), numberOption('stretchCycles', 'Stretch time in clock periods', 0, 0, 1000000), booleanOption('targetAck', 'Acknowledge address', true)] },
    { protocol: 'axi4', role: 'initiator', label: 'AXI-Full initiator', signals: AXI4_SIGNALS, clock: true, options: [literalOption('address', 'Address', '0'), booleanOption('write', 'Write', true), literalOption('id', 'Transaction ID', '0'), selectOption('burst', 'Burst', 'incr', ['fixed', 'incr', 'wrap']), selectOption('response', 'Response', 'okay', ['okay', 'exokay', 'slverr', 'decerr']), literalOption('strobe', 'Byte strobe', '15')] },
    { protocol: 'axi4', role: 'responder', label: 'AXI-Full responder', signals: AXI4_SIGNALS, clock: true, options: [literalOption('address', 'Address', '0'), booleanOption('write', 'Write', true), literalOption('id', 'Transaction ID', '0'), selectOption('burst', 'Burst', 'incr', ['fixed', 'incr', 'wrap']), selectOption('response', 'Response', 'okay', ['okay', 'exokay', 'slverr', 'decerr']), literalOption('strobe', 'Byte strobe', '15'), numberOption('waitCycles', 'Backpressure cycles', 0, 0, 1000000)] },
    { protocol: 'axi4lite', role: 'initiator', label: 'AXI-Lite initiator', signals: AXI4LITE_SIGNALS, clock: true, options: [literalOption('address', 'Address', '0'), booleanOption('write', 'Write', true), selectOption('response', 'Response', 'okay', ['okay', 'slverr', 'decerr']), literalOption('strobe', 'Byte strobe', '15')] },
    { protocol: 'axi4lite', role: 'responder', label: 'AXI-Lite responder', signals: AXI4LITE_SIGNALS, clock: true, options: [literalOption('address', 'Address', '0'), booleanOption('write', 'Write', true), selectOption('response', 'Response', 'okay', ['okay', 'slverr', 'decerr']), literalOption('strobe', 'Byte strobe', '15'), numberOption('waitCycles', 'Backpressure cycles', 0, 0, 1000000)] },
    { protocol: 'rgb888', role: 'source', label: 'RGB source', signals: ['pclk', 'hsync', 'vsync', 'de', 'r', 'g', 'b'], clock: false, options: RGB_OPTIONS },
    { protocol: 'rgb888', role: 'monitor', label: 'RGB monitor', signals: ['pclk', 'hsync', 'vsync', 'de', 'r', 'g', 'b'], clock: false, options: RGB_OPTIONS.filter(option => option.key !== 'period') },
];

export function createProtocolStep(protocol: TaskProtocolStep['protocol'], role: string): TaskProtocolStep {
    const template = PROTOCOL_TEMPLATES.find(item => item.protocol === protocol && item.role === role);
    if (!template) throw new Error(`Unsupported protocol role ${protocol}/${role}.`);
    const passive = role === 'rx' || role === 'sink' || role === 'monitor' || role === 'responder';
    const options = Object.fromEntries(template.options.map(option => [option.key,
        option.key === 'hsyncPolarity' || option.key === 'vsyncPolarity' || option.key === 'stopBits' || option.key === 'cpol' || option.key === 'cpha'
            ? Number(option.defaultValue) : option.defaultValue])) as TaskProtocolOptions;
    let data = passive ? [] : ["8'h55"];
    let expected: string[] | undefined = passive ? ["8'h55"] : undefined;
    if (protocol === 'axi4' || protocol === 'axi4lite') {
        data = role === 'initiator' ? ["32'h12345678"] : [];
        expected = role === 'responder' ? ["32'h12345678"] : undefined;
    } else if (protocol === 'i2c' && role === 'target') {
        data = []; expected = ["8'h55"];
    } else if (protocol === 'rgb888') {
        data = []; expected = undefined;
    }
    return {
        kind: 'protocol', protocol, role,
        signals: Object.fromEntries(template.signals.map(signal => [signal, signal])),
        ...(template.clock ? { clock: 'clk' } : {}), timeout: 10000,
        data, ...(expected ? { expected } : {}), options,
    };
}

export function literal(value: unknown): value is string {
    if (typeof value !== 'string' || !value.length || value.length > 4096) return false;
    if (/^[xz]$/i.test(value) || /^-?\d[\d_]*$/.test(value)) return true;
    const match = /^(\d[\d_]*)?'[sS]?([bBoOdDhH])([\da-fA-F_xXzZ?]+)$/.exec(value);
    if (!match || (match[1] && (Number(match[1].replace(/_/g, '')) < 1 || Number(match[1].replace(/_/g, '')) > 65536))) return false;
    return ({ b: /^[01xz?]+$/i, o: /^[0-7xz?]+$/i, d: /^(?:\d+|[xz?])$/i, h: /^[0-9a-fxz?]+$/i })[match[2].toLowerCase()]!.test(match[3].replace(/_/g, ''));
}

function plain(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === 'object' && !Array.isArray(value)
        && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)
        && !Object.keys(value).some(key => ['__proto__', 'constructor', 'prototype'].includes(key));
}

/** JSON shape validation, independent of the environment and source-file access. */
export function validateProtocolStep(value: unknown, path: string): Array<{ path: string; message: string }> {
    const errors: Array<{ path: string; message: string }> = [];
    const error = (field: string, message: string) => errors.push({ path: `${path}${field ? `.${field}` : ''}`, message });
    if (!plain(value)) { error('', 'Expected a plain protocol object without prototype keys.'); return errors; }
    const allowed = ['kind', 'protocol', 'role', 'signals', 'clock', 'timeout', 'data', 'expected', 'options'];
    for (const key of Object.keys(value)) if (!allowed.includes(key)) error(key, 'Unknown protocol field.');
    if (value.kind !== 'protocol') error('kind', 'Expected protocol.');
    const template = PROTOCOL_TEMPLATES.find(item => item.protocol === value.protocol && item.role === value.role);
    if (!template) { error('role', 'Unsupported protocol or role.'); return errors; }
    if (!plain(value.signals)) error('signals', 'Expected a plain signal map without prototype keys.');
    else {
        for (const signal of template.signals) if (!isTaskIdentifier(value.signals[signal])) error(`signals.${signal}`, 'Map this signal to a valid net identifier.');
        for (const [signal, net] of Object.entries(value.signals)) {
            if (![...template.signals, ...(template.optionalSignals ?? [])].includes(signal)) error(`signals.${signal}`, 'Unknown protocol signal.');
            else if (!isTaskIdentifier(net)) error(`signals.${signal}`, 'Expected a valid net identifier.');
        }
    }
    if (template.clock ? !isTaskIdentifier(value.clock) : value.clock !== undefined) error('clock', template.clock ? 'Select an automatic clock.' : 'This protocol uses its period or mapped serial clock, not an automatic clock.');
    if (typeof value.timeout !== 'number' || !Number.isFinite(value.timeout) || value.timeout <= 0) error('timeout', 'Expected a finite positive timeout in task time units.');
    for (const field of ['data', 'expected'] as const) {
        const values = value[field];
        if (field === 'expected' && values === undefined) continue;
        if (!Array.isArray(values) || values.length > 4096) error(field, 'Expected at most 4096 Verilog literals.');
        else for (const [index, entry] of values.entries()) if (!literal(entry)) error(`${field}[${index}]`, 'Expected a Verilog integer or 4-state literal.');
    }
    const options = value.options === undefined ? {} : value.options;
    if (!plain(options)) { error('options', 'Expected a plain options object.'); return errors; }
    if (['i2c', 'axi4', 'axi4lite', 'rgb888'].includes(String(value.protocol))) {
        validateAdvancedProtocol(value as unknown as TaskProtocolStep, options as TaskProtocolOptions, template, error);
        return errors;
    }
    const optionKeys = value.protocol === 'uart' ? ['width', 'period', 'parity', 'stopBits']
        : value.protocol === 'spi' ? ['width', 'period', 'cpol', 'cpha']
            : value.protocol === 'apb' ? ['address', 'write', ...(value.role === 'responder' ? ['waitCycles'] : [])]
                : value.role === 'sink' ? ['waitCycles'] : [];
    for (const key of Object.keys(options)) if (!optionKeys.includes(key)) error(`options.${key}`, 'Option is unsupported for this protocol role.');
    if (options.width !== undefined && (!Number.isInteger(options.width) || Number(options.width) < (value.protocol === 'uart' ? 5 : 1) || Number(options.width) > (value.protocol === 'uart' ? 9 : 32))) error('options.width', value.protocol === 'uart' ? 'UART width must be 5 through 9.' : 'SPI width must be 1 through 32.');
    if (['uart', 'spi'].includes(String(value.protocol)) && (typeof options.period !== 'number' || !Number.isFinite(options.period) || options.period <= 0)) error('options.period', 'Set a finite positive bit/serial-clock period.');
    for (const key of ['cpol', 'cpha']) if (options[key] !== undefined && options[key] !== 0 && options[key] !== 1) error(`options.${key}`, 'Expected 0 or 1.');
    if (options.parity !== undefined && !['none', 'even', 'odd'].includes(String(options.parity))) error('options.parity', 'Expected none, even or odd.');
    if (options.stopBits !== undefined && options.stopBits !== 1 && options.stopBits !== 2) error('options.stopBits', 'Expected 1 or 2 stop bits.');
    if (options.waitCycles !== undefined && (!Number.isInteger(options.waitCycles) || Number(options.waitCycles) < 0 || Number(options.waitCycles) > 1000000)) error('options.waitCycles', 'Expected zero through 1000000 wait cycles.');
    if (options.address !== undefined && !literal(options.address)) error('options.address', 'Expected a Verilog address literal.');
    if (options.write !== undefined && typeof options.write !== 'boolean') error('options.write', 'Expected a boolean.');
    const receives = value.role === 'rx' || value.role === 'sink' || value.role === 'monitor'
        || (value.protocol === 'apb' && ((value.role === 'initiator' && options.write === false) || (value.role === 'responder' && options.write !== false)));
    if (receives) {
        if (!Array.isArray(value.expected) || !value.expected.length) error('expected', 'This receiving role requires a finite nonempty expected list.');
        if (Array.isArray(value.data) && value.data.length) error('data', 'This receiving role uses expected instead of transmitted data.');
    } else {
        if (Array.isArray(value.data) && !value.data.length) error('data', 'Provide transmitted data.');
        if (value.protocol !== 'spi' && value.expected !== undefined) error('expected', 'Expected data is unsupported for this transmitting role.');
    }
    if (value.protocol === 'spi' && Array.isArray(value.expected) && Array.isArray(value.data) && value.expected.length !== value.data.length) error('expected', 'SPI expected and data lists must have the same transaction count.');
    return errors;
}

export function protocolDrivenSignals(step: TaskProtocolStep): string[] {
    const keys = step.protocol === 'uart' ? (step.role === 'tx' ? ['data'] : [])
        : step.protocol === 'spi' ? (step.role === 'controller' ? ['sclk', 'cs', 'mosi'] : ['miso'])
            : step.protocol === 'apb' ? (step.role === 'initiator' ? ['select', 'enable', 'address', 'write', 'wdata'] : ['rdata', 'ready', 'error'])
                : step.protocol === 'axis' ? (step.role === 'source' ? ['data', 'valid', 'last'] : step.role === 'sink' ? ['ready'] : [])
                    : step.protocol === 'i2c' ? ['scl', 'sda']
                        : step.protocol === 'axi4' ? (step.role === 'initiator'
                            ? ['awid', 'awaddr', 'awlen', 'awsize', 'awburst', 'awvalid', 'wdata', 'wstrb', 'wlast', 'wvalid', 'bready', 'arid', 'araddr', 'arlen', 'arsize', 'arburst', 'arvalid', 'rready']
                            : ['awready', 'wready', 'bid', 'bresp', 'bvalid', 'arready', 'rid', 'rdata', 'rresp', 'rlast', 'rvalid'])
                            : step.protocol === 'axi4lite' ? (step.role === 'initiator'
                                ? ['awaddr', 'awvalid', 'wdata', 'wstrb', 'wvalid', 'bready', 'araddr', 'arvalid', 'rready']
                                : ['awready', 'wready', 'bresp', 'bvalid', 'arready', 'rdata', 'rresp', 'rvalid'])
                                : step.role === 'source' ? ['pclk', 'hsync', 'vsync', 'de', 'r', 'g', 'b'] : [];
    return keys.flatMap(key => step.signals[key] === undefined ? [] : [step.signals[key]]);
}

export function protocolOpenDrainSignals(step: TaskProtocolStep): string[] {
    return step.protocol === 'i2c' ? ['scl', 'sda'].map(key => step.signals[key]).filter((net): net is string => net !== undefined) : [];
}

export function protocolPayloadFields(step: TaskProtocolStep): { data: boolean; expected: boolean } {
    const options = step.options ?? {};
    if (step.protocol === 'rgb888') {
        if (options.pattern !== 'pixels') return { data: false, expected: false };
        return step.role === 'source' ? { data: true, expected: false } : { data: false, expected: true };
    }
    if (step.protocol === 'i2c' && options.repeatedStart === true) return { data: true, expected: true };
    const transmitting = step.protocol === 'uart' ? step.role === 'tx'
        : step.protocol === 'spi' ? true
            : step.protocol === 'axis' ? step.role === 'source'
                : step.protocol === 'apb' || step.protocol === 'i2c' || step.protocol === 'axi4' || step.protocol === 'axi4lite'
                    ? (step.role === 'initiator' || step.role === 'controller') === (options.write !== false)
                    : false;
    return transmitting ? { data: true, expected: step.protocol === 'spi' }
        : { data: false, expected: true };
}

export interface ProtocolCompileContext {
    path: string; prefix: string; tick: number;
    netWidths: Record<string, number>; clocks: Record<string, number>;
    /** Compiler-owned assignment targets for inouts; all observations use resolved nets. */
    writeTargets?: Readonly<Record<string, string>>;
}

export interface ProtocolCompileResult { declarations: string[]; statements: string[]; }

function numeric(value: string, width: number): string { return /^[xz]$/i.test(value) ? `${width}'b${value}` : value; }

/** Reject known overflow rather than silently truncating the user's transaction. */
export function fits(value: string, width: number): boolean {
    if (/^[xz]$/i.test(value)) return true;
    const text = value.replace(/_/g, '');
    const match = /^(\d+)?'[sS]?([bBoOdDhH])(.+)$/.exec(text);
    if (match && /[xz?]/i.test(match[3])) {
        const declared = match[1] ? Number(match[1]) : width;
        const digitBits = ({ b: 1, o: 3, h: 4 } as Record<string, number>)[match[2].toLowerCase()];
        return declared <= width && (!digitBits || match[3].length <= Math.ceil(declared / digitBits));
    }
    const digits = match?.[3] ?? text;
    const base = match?.[2].toLowerCase();
    const number = BigInt((base === 'b' ? '0b' : base === 'h' ? '0x' : base === 'o' ? '0o' : '') + digits);
    const declaredWidth = match?.[1] ? Number(match[1]) : width;
    return declaredWidth <= width && number >= -(1n << BigInt(declaredWidth - 1)) && number < (1n << BigInt(declaredWidth));
}

export function compileProtocolStep(step: TaskProtocolStep, context: ProtocolCompileContext): ProtocolCompileResult {
    const errors = validateProtocolStep(step, context.path);
    if (errors.length) throw new Error(`${errors[0].path}: ${errors[0].message}`);
    const fail = (field: string, message: string): never => { throw new Error(`${context.path}.${field}: ${message}`); };
    if (!/^vf_[a-zA-Z0-9_]+$/.test(context.prefix) || !/^preset$/.test(context.path)) fail('', 'Invalid compiler-generated prefix or step path.');
    const time = (value: number, field: string) => {
        if (!Number.isFinite(value) || !Number.isFinite(context.tick) || context.tick <= 0 || value < context.tick || Math.abs(value / context.tick - Math.round(value / context.tick)) > 1e-6) fail(field, 'Time must be a finite positive multiple of the task precision.');
    };
    time(step.timeout, 'timeout');
    if (step.options?.period !== undefined) time(step.options.period / 2, 'options.period');
    const s = step.signals;
    const targets = context.writeTargets ?? {};
    if (!plain(targets)) fail('signals', 'Invalid compiler-generated write-target map.');
    const driven = new Set(protocolDrivenSignals(step));
    const openDrain = new Set(protocolOpenDrainSignals(step));
    for (const [net, target] of Object.entries(targets)) {
        const openDrainTarget = openDrain.has(net) && target === `${context.prefix}_drive_${net}`;
        if (!driven.has(net) || (target !== net && target !== `vf_drive_${net}` && !openDrainTarget)) fail('signals', 'Invalid compiler-generated protocol write target.');
    }
    const w = Object.fromEntries(Object.entries(s).map(([role, net]) => [role,
        Object.prototype.hasOwnProperty.call(targets, net) ? targets[net] : net]));
    if (new Set(Object.values(s)).size !== Object.keys(s).length) fail('signals', 'Protocol signal mappings must be distinct.');
    if (step.protocol === 'i2c' || step.protocol === 'axi4' || step.protocol === 'axi4lite' || step.protocol === 'rgb888') {
        for (const [key, net] of Object.entries(s)) {
            if (!Object.prototype.hasOwnProperty.call(context.netWidths, net)) fail(`signals.${key}`, `Unknown net ${net}.`);
        }
        if (step.clock) {
            if (context.netWidths[step.clock] !== 1) fail('clock', 'Select a declared one-bit clock net.');
            if (Object.values(s).includes(step.clock)) fail('clock', 'Clock and protocol signal mappings must be distinct.');
            if (Object.prototype.hasOwnProperty.call(context.clocks, step.clock)) time(context.clocks[step.clock] / 2, 'clock');
        }
        const input = { step, context, observed: s, driven: w, fail, fits, numeric };
        if (step.protocol === 'i2c') return compileI2cProtocol(input);
        if (step.protocol === 'rgb888') return compileRgb888Protocol(input);
        return compileAxiProtocol(input);
    }
    for (const [key, net] of Object.entries(s)) {
        if (!Object.prototype.hasOwnProperty.call(context.netWidths, net)) fail(`signals.${key}`, `Unknown net ${net}.`);
        const width = context.netWidths[net];
        if (!Number.isInteger(width) || width < 1 || width > 65536) fail(`signals.${key}`, 'Invalid net width.');
        if (!(step.protocol === 'apb' && ['address', 'wdata', 'rdata'].includes(key)) && !(step.protocol === 'axis' && key === 'data') && width !== 1) fail(`signals.${key}`, 'Control and serial signals must have width 1.');
    }
    if (step.clock) {
        if (context.netWidths[step.clock] !== 1) fail('clock', 'Select a declared one-bit clock net.');
        if (Object.values(s).includes(step.clock)) fail('clock', 'Clock and protocol signal mappings must be distinct.');
        if (Object.prototype.hasOwnProperty.call(context.clocks, step.clock)) time(context.clocks[step.clock] / 2, 'clock');
    }
    const width = step.protocol === 'uart' || step.protocol === 'spi' ? step.options?.width ?? 8
        : context.netWidths[s[step.protocol === 'apb' ? 'wdata' : 'data']];
    if (step.protocol === 'apb' && context.netWidths[s.rdata] !== width) fail('signals.rdata', 'APB write and read data widths must match.');
    for (const [field, values] of [['data', step.data], ['expected', step.expected ?? []]] as const) values.forEach((value, index) => { if (!fits(value, width)) fail(`${field}[${index}]`, `Value must fit the ${width}-bit transaction width.`); });
    if (step.protocol === 'apb' && !fits(step.options?.address ?? '0', context.netWidths[s.address])) fail('options.address', 'Address must fit the mapped address width.');
    const prefix = context.prefix;
    const actual = `${prefix}_actual`; const ok = `${prefix}_ok`; const bit = `${prefix}_bit`;
    const declarations = [`reg [${width - 1}:0] ${actual};`, `reg ${ok};`, `integer ${bit};`];
    const statements: string[] = [];
    const options = step.options ?? {};
    const period = options.period!;
    const half = period / 2;
    const clock = step.clock;
    const rise = `@(posedge ${clock});`;
    const fall = `@(negedge ${clock});`;
    const values = step.data.length ? step.data : step.expected!;
    const constant = (name: string, value: string, bits = width): string => {
        declarations.push(`localparam [${bits - 1}:0] ${name} = ${numeric(value, bits)};`);
        return name;
    };
    function check(lines: string[], index: number, expected: string, received: string, controls = "1'b1"): void {
        lines.push(`$display("ST_PROTOCOL_CHECK|%m|transaction[${index}]|%0d|%b|%b", ((${received} === ${expected}) && (${controls})), ${expected}, ${received});`, `if (!(((${received} === ${expected}) && (${controls})) === 1'b1)) $fatal(1, "Protocol expectation failed: %m");`);
    }
    function transaction(index: number, lines: string[]): void {
        const block = `${prefix}_transaction_${index}`;
        statements.push(`begin : ${block}`, '    fork', '        begin',
            ...lines.map(line => `            ${line}`), `            disable ${block};`, '        end',
            `        begin #(${step.timeout}); $fatal(1, "ST_PROTOCOL_TIMEOUT|%m"); end`, '    join', 'end');
    }
    // Drive synchronously sampled signals at falling edges; capture at the rising
    // edge before DUT nonblocking updates. No post-edge delay can skip a transfer.
    if (step.protocol === 'uart') {
        const parity = options.parity ?? 'none';
        const parityExpression = (word: string) => `${parity === 'odd' ? '~' : ''}(^${word})`;
        if (step.role === 'tx') statements.push(`${w.data} <= 1'b1;`, `#(${period});`);
        else statements.push(`#(${context.tick});`);
        values.forEach((value, index) => {
            const word = constant(`${prefix}_word_${index}`, value);
            const lines: string[] = [];
            if (step.role === 'tx') {
                lines.push(`${w.data} <= 1'b0;`, `#(${period});`,
                    `for (${bit} = 0; ${bit} < ${width}; ${bit} = ${bit} + 1) begin`,
                    `    ${w.data} <= ${word}[${bit}];`, `    #(${period});`, 'end');
                if (parity !== 'none') lines.push(`${w.data} <= ${parityExpression(word)};`, `#(${period});`);
                lines.push(`${w.data} <= 1'b1;`, `#(${period * (options.stopBits ?? 1)});`);
            } else {
                lines.push(`wait (${s.data} === 1'b0);`, `#(${half});`, `${ok} = (${s.data} === 1'b0);`,
                    `for (${bit} = 0; ${bit} < ${width}; ${bit} = ${bit} + 1) begin`,
                    `    #(${period});`, `    ${actual}[${bit}] = ${s.data};`, 'end');
                if (parity !== 'none') lines.push(`#(${period});`, `${ok} = ${ok} && (${s.data} === ${parityExpression(actual)});`);
                for (let stop = 0; stop < (options.stopBits ?? 1); stop++) lines.push(`#(${period});`, `${ok} = ${ok} && (${s.data} === 1'b1);`);
                check(lines, index, word, actual, ok);
                lines.push(`#(${half});`);
            }
            transaction(index, lines);
        });
    } else if (step.protocol === 'spi') {
        const cpol = options.cpol ?? 0; const cpha = options.cpha ?? 0;
        const controller = step.role === 'controller';
        const output = controller ? w.mosi : w.miso; const input = controller ? s.miso : s.mosi;
        const leading = `@(${cpol ? 'negedge' : 'posedge'} ${s.sclk});`;
        const trailing = `@(${cpol ? 'posedge' : 'negedge'} ${s.sclk});`;
        if (controller) statements.push(`${w.cs} <= 1'b1;`, `${w.sclk} <= 1'b${cpol};`, `${output} <= 1'b0;`, `#(${half});`);
        else statements.push(`${output} <= 1'bz;`, `#(${context.tick});`);
        values.forEach((value, index) => {
            const word = constant(`${prefix}_word_${index}`, value);
            const lines = [`${ok} = 1'b1;`];
            if (controller) lines.push(`${w.cs} <= 1'b0;`);
            else lines.push(`wait (${s.cs} === 1'b0);`);
            lines.push(`for (${bit} = ${width - 1}; ${bit} >= 0; ${bit} = ${bit} - 1) begin`);
            if (controller) {
                if (!cpha) lines.push(`    ${output} <= ${word}[${bit}];`);
                lines.push(`    #(${half});`, `    ${w.sclk} <= 1'b${1 - cpol};`);
                if (cpha) lines.push(`    ${output} <= ${word}[${bit}];`);
                else lines.push(`    ${actual}[${bit}] = ${input};`);
                lines.push(`    #(${half});`, `    ${w.sclk} <= 1'b${cpol};`);
                if (cpha) lines.push(`    ${actual}[${bit}] = ${input};`);
            } else {
                if (!cpha) lines.push(`    ${output} <= ${word}[${bit}];`);
                lines.push(`    ${leading}`, `    ${ok} = ${ok} && (${s.cs} === 1'b0);`);
                if (cpha) lines.push(`    ${output} <= ${word}[${bit}];`);
                else lines.push(`    ${actual}[${bit}] = ${input};`);
                lines.push(`    ${trailing}`, `    ${ok} = ${ok} && (${s.cs} === 1'b0);`);
                if (cpha) lines.push(`    ${actual}[${bit}] = ${input};`);
            }
            lines.push('end');
            if (step.expected) check(lines, index, constant(`${prefix}_expected_${index}`, step.expected[index]), actual, ok);
            if (controller) lines.push(`#(${half});`, `${w.cs} <= 1'b1;`, `#(${half});`);
            else lines.push(`wait (${s.cs} === 1'b1);`, `${output} <= 1'bz;`);
            transaction(index, lines);
        });
    } else if (step.protocol === 'apb') {
        const write = options.write !== false;
        const initiator = step.role === 'initiator';
        const address = constant(`${prefix}_address`, options.address ?? '0', context.netWidths[s.address]);
        if (initiator) statements.push(`${w.select} <= 1'b0;`, `${w.enable} <= 1'b0;`);
        else statements.push(`${w.ready} <= 1'b0;`, ...(s.error ? [`${w.error} <= 1'b0;`] : []));
        values.forEach((value, index) => {
            const word = constant(`${prefix}_word_${index}`, value);
            const lines: string[] = [];
            if (initiator) {
                lines.push(fall, `${w.select} <= 1'b1;`, `${w.enable} <= 1'b0;`, `${w.address} <= ${address};`, `${w.write} <= 1'b${write ? 1 : 0};`);
                if (write) lines.push(`${w.wdata} <= ${word};`);
                lines.push(fall, `${w.enable} <= 1'b1;`, rise, `while (${s.ready} !== 1'b1) begin ${rise} end`);
                const controls = s.error ? `${s.error} === 1'b0` : "1'b1";
                if (!write) check(lines, index, word, s.rdata, controls);
                else if (s.error) check(lines, index, "1'b0", s.error);
                lines.push(fall, `${w.select} <= 1'b0;`, `${w.enable} <= 1'b0;`);
            } else {
                lines.push(rise, `while (!((${s.select} === 1'b1) && (${s.enable} === 1'b0))) begin ${rise} end`, fall);
                if (!write) lines.push(`${w.rdata} <= ${word};`);
                if (options.waitCycles) lines.push(`repeat (${options.waitCycles}) ${fall}`);
                lines.push(`${w.ready} <= 1'b1;`, rise,
                    `while (!((${s.select} === 1'b1) && (${s.enable} === 1'b1))) begin ${rise} end`);
                const controls = `(${s.address} === ${address}) && (${s.write} === 1'b${write ? 1 : 0})`;
                if (write) check(lines, index, word, s.wdata, controls);
                else check(lines, index, address, s.address, controls);
                lines.push(fall, `${w.ready} <= 1'b0;`);
            }
            transaction(index, lines);
        });
    } else {
        if (step.role === 'source') statements.push(`${w.valid} <= 1'b0;`, ...(s.last ? [`${w.last} <= 1'b0;`] : []));
        if (step.role === 'sink') statements.push(`${w.ready} <= 1'b0;`);
        values.forEach((value, index) => {
            const word = constant(`${prefix}_word_${index}`, value);
            const lines: string[] = [];
            if (step.role === 'source') {
                lines.push(fall, `${w.data} <= ${word};`, `${w.valid} <= 1'b1;`);
                if (s.last) lines.push(`${w.last} <= 1'b${index === values.length - 1 ? 1 : 0};`);
            } else if (step.role === 'sink') {
                if (options.waitCycles) lines.push(`repeat (${options.waitCycles}) ${fall}`);
                lines.push(fall, `${w.ready} <= 1'b1;`);
            }
            lines.push(rise, `while (!((${s.valid} === 1'b1) && (${s.ready} === 1'b1))) begin ${rise} end`);
            if (step.role !== 'source') check(lines, index, word, s.data, s.last ? `${s.last} === 1'b${index === values.length - 1 ? 1 : 0}` : "1'b1");
            if (step.role === 'source') lines.push(fall, `${w.valid} <= 1'b0;`, ...(s.last ? [`${w.last} <= 1'b0;`] : []));
            if (step.role === 'sink') lines.push(fall, `${w.ready} <= 1'b0;`);
            transaction(index, lines);
        });
    }
    return { declarations, statements };
}
