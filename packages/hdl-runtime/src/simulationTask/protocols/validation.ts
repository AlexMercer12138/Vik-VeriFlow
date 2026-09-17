import type { ProtocolTemplate, TaskProtocolOptions, TaskProtocolStep } from '../protocols';

type ErrorReporter = (field: string, message: string) => void;

function literalInteger(value: unknown): bigint | undefined {
    if (typeof value !== 'string' || /[xz?]/i.test(value)) return undefined;
    const text = value.replace(/_/g, '');
    const match = /^(\d+)?'[sS]?([bBoOdDhH])([0-9a-fA-F]+)$/.exec(text);
    try {
        if (!match) return /^-?\d+$/.test(text) ? BigInt(text) : undefined;
        const prefix = match[2].toLowerCase() === 'b' ? '0b' : match[2].toLowerCase() === 'o' ? '0o' : match[2].toLowerCase() === 'h' ? '0x' : '';
        return BigInt(prefix + match[3]);
    } catch { return undefined; }
}

function integer(options: TaskProtocolOptions, key: keyof TaskProtocolOptions, min: number, max: number, error: ErrorReporter): void {
    const value = options[key];
    if (!Number.isInteger(value) || Number(value) < min || Number(value) > max) error(`options.${key}`, `Expected ${min} through ${max}.`);
}

function boolean(options: TaskProtocolOptions, key: keyof TaskProtocolOptions, error: ErrorReporter): void {
    if (typeof options[key] !== 'boolean') error(`options.${key}`, 'Expected a boolean.');
}

function payload(step: TaskProtocolStep, transmitting: boolean, error: ErrorReporter, single = false): void {
    const values = transmitting ? step.data : step.expected;
    const other = transmitting ? step.expected : step.data;
    const field = transmitting ? 'data' : 'expected';
    if ((!Array.isArray(values) || !values.length)) error(field, `Provide ${single ? 'one' : 'at least one'} ${transmitting ? 'transmitted' : 'expected'} value.`);
    if (single && Array.isArray(values) && values.length !== 1) error(field, 'AXI4-Lite transfers require a single beat.');
    if (Array.isArray(other) && other.length) error(transmitting ? 'expected' : 'data', 'This transfer direction does not use this payload field.');
}

export function validateAdvancedProtocol(step: TaskProtocolStep, options: TaskProtocolOptions, template: ProtocolTemplate, error: ErrorReporter): void {
    const allowed = new Set(template.options.map(option => option.key));
    for (const key of Object.keys(options)) if (!allowed.has(key as keyof TaskProtocolOptions)) error(`options.${key}`, 'Option is unsupported for this protocol role.');
    if (step.protocol === 'i2c') {
        integer(options, 'period', 2, 1000000, error);
        const address = literalInteger(options.address);
        if (address === undefined || address < 0n || address > 0x7fn) error('options.address', 'Expected a known 7-bit address literal.');
        boolean(options, 'write', error); boolean(options, 'repeatedStart', error);
        if (step.role === 'target') { integer(options, 'stretchCycles', 0, 1000000, error); boolean(options, 'targetAck', error); }
        const transmitting = step.role === 'controller' ? options.write === true : options.write === false;
        if (options.repeatedStart === true) {
            if (options.write !== true) error('options.repeatedStart', 'A combined transfer starts with a write before the repeated START read.');
            if ((!step.data.length) || !step.expected?.length) error('expected', 'A repeated START transfer requires nonempty write and read phases.');
        } else payload(step, transmitting, error);
        return;
    }
    if (step.protocol === 'axi4' || step.protocol === 'axi4lite') {
        boolean(options, 'write', error);
        if (literalInteger(options.address) === undefined) error('options.address', 'Expected a known address literal.');
        const responses = step.protocol === 'axi4lite' ? ['okay', 'slverr', 'decerr'] : ['okay', 'exokay', 'slverr', 'decerr'];
        if (!responses.includes(String(options.response))) error('options.response', step.protocol === 'axi4lite'
            ? 'AXI4-Lite permits OKAY, SLVERR or DECERR; EXOKAY requires AXI4 exclusive accesses.'
            : 'Expected okay, exokay, slverr or decerr.');
        if (typeof options.strobe !== 'string' || literalInteger(options.strobe) === undefined) error('options.strobe', 'Expected a known byte-strobe literal.');
        if (step.protocol === 'axi4') {
            if (literalInteger(options.id) === undefined) error('options.id', 'Expected a known transaction ID literal.');
            if (!['fixed', 'incr', 'wrap'].includes(String(options.burst))) error('options.burst', 'Expected fixed, incr or wrap.');
        }
        if (step.role === 'responder') integer(options, 'waitCycles', 0, 1000000, error);
        const transmitting = step.role === 'initiator' ? options.write === true : options.write === false;
        payload(step, transmitting, error, step.protocol === 'axi4lite');
        const beats = (transmitting ? step.data : step.expected)?.length ?? 0;
        if (step.protocol === 'axi4' && (beats < 1 || beats > 256)) error(transmitting ? 'data' : 'expected', 'AXI4 bursts require 1 through 256 beats.');
        if (step.protocol === 'axi4' && options.burst === 'fixed' && beats > 16) error(transmitting ? 'data' : 'expected', 'AXI4 FIXED bursts permit at most 16 beats.');
        return;
    }
    for (const axis of ['h', 'v'] as const) {
        integer(options, `${axis}Active`, 1, 8192, error);
        integer(options, `${axis}Total`, 1, 32768, error);
        integer(options, `${axis}SyncStart`, 0, 32768, error);
        integer(options, `${axis}SyncEnd`, 1, 32768, error);
        if (!(options[`${axis}Active`]! <= options[`${axis}SyncStart`]!
            && options[`${axis}SyncStart`]! < options[`${axis}SyncEnd`]!
            && options[`${axis}SyncEnd`]! <= options[`${axis}Total`]!)) {
            error('options.timing', `${axis.toUpperCase()} timing requires Active <= SyncStart < SyncEnd <= Total.`);
        }
    }
    integer(options, 'frames', 1, 1000, error);
    if (step.role === 'source') integer(options, 'period', 2, 1000000, error);
    for (const key of ['hsyncPolarity', 'vsyncPolarity'] as const) if (options[key] !== 0 && options[key] !== 1) error(`options.${key}`, 'Expected 0 or 1.');
    if (options.pattern !== 'colorBars' && options.pattern !== 'pixels') error('options.pattern', 'Expected colorBars or pixels.');
    if (options.pattern === 'colorBars') {
        if (step.data.length || step.expected?.length) error('data', 'Color bars are generated from timing geometry and do not accept pixel payloads.');
    } else {
        const pixels = Number(options.hActive) * Number(options.vActive);
        if (step.role === 'source') {
            if (step.data.length !== pixels) error('data', `Pixel mode requires exactly ${pixels} packed RGB values for one frame.`);
            if (step.expected !== undefined) error('expected', 'An RGB888 source does not receive pixel data.');
        } else {
            if (step.expected?.length !== pixels) error('expected', `Pixel mode requires exactly ${pixels} packed expected RGB values for one frame.`);
            if (step.data.length) error('data', 'An RGB888 monitor only accepts expected pixels.');
        }
    }
}
