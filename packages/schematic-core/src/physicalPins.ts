export type PhysicalPort = Readonly<{
    name: string;
    direction: 'input' | 'output' | 'inout';
    indices?: readonly number[];
    unresolved?: boolean;
}>;
export type PhysicalSignal = {
    id: string;
    direction: PhysicalPort['direction'];
    pins: string[];
};
export type PhysicalInterface = {
    id: string;
    signals: PhysicalSignal[];
};
export type PhysicalBoardModel = {
    kind: 'board' | 'daughtercard';
    extension: string;
    pins: Record<string, string>;
    interfaces: PhysicalInterface[];
};
export type PhysicalBinding = Readonly<{
    source: {
        card?: string;
        interface: string;
        member: string;
    };
    pin?: string;
    port: {
        name: string;
        bit?: number;
    };
}>;
export type PhysicalConfiguration = Readonly<{
    board: string;
    cards?: readonly {
        id: string;
        board: string;
    }[];
    bindings: readonly PhysicalBinding[];
}>;
export type PhysicalBoard = {
    model: PhysicalBoardModel;
    cards?: Record<string, PhysicalBoardModel>;
};
export type PinDiagnostic = {
    severity: 'error' | 'warning';
    message: string;
};
const id = /^[A-Za-z0-9_][A-Za-z0-9_.:-]*$/;
function requireValue(ok: unknown, message: string): asserts ok {
    if (!ok)
        throw new Error(message);
}
function object(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function keys(value: Record<string, unknown>, allowed: string[]): void { requireValue(Object.keys(value).every(key => allowed.includes(key)), `Unknown physical field: ${Object.keys(value).find(key => !allowed.includes(key))}`); }
function unique(items: readonly string[], label: string): void { requireValue(new Set(items).size === items.length, `Duplicate ${label}`); }
function reference(value: unknown): boolean { return typeof value === 'string' && value.length > 0 && !/[\r\n\0]/.test(value); }
export function parsePhysicalConfiguration(value: unknown): PhysicalConfiguration {
    requireValue(object(value), 'Physical configuration must be an object');
    keys(value, ['board', 'cards', 'bindings']);
    requireValue(reference(value.board), 'Choose a board');
    requireValue(Array.isArray(value.bindings) && value.bindings.length <= 50000, 'Invalid pin bindings');
    for (const binding of value.bindings) {
        requireValue(object(binding) && object(binding.source) && object(binding.port), 'Invalid pin binding');
        keys(binding, ['source', 'port', 'pin']);
        requireValue(binding.pin === undefined || typeof binding.pin === 'string' && !/[\r\n\0]/.test(binding.pin), 'Invalid daughtercard pin');
        requireValue(binding.source.card !== undefined || binding.pin === undefined, 'Board positions are fixed in templates');
        keys(binding.source, ['card', 'interface', 'member']);
        keys(binding.port, ['name', 'bit']);
        requireValue(typeof binding.source.interface === 'string' && id.test(binding.source.interface) && typeof binding.source.member === 'string' && id.test(binding.source.member), 'Invalid interface signal');
        requireValue(binding.source.card === undefined || typeof binding.source.card === 'string' && id.test(binding.source.card), 'Invalid daughtercard ID');
        requireValue(typeof binding.port.name === 'string' && /^[A-Za-z_][A-Za-z0-9_$]*$/.test(binding.port.name), 'Invalid RTL port');
        requireValue(binding.port.bit === undefined || Number.isSafeInteger(binding.port.bit), 'Invalid RTL port bit');
    }
    if (value.cards !== undefined) {
        requireValue(Array.isArray(value.cards) && value.cards.length <= 100, 'Invalid daughtercards');
        for (const card of value.cards) {
            requireValue(object(card), 'Invalid daughtercard');
            keys(card, ['id', 'board']);
            requireValue(typeof card.id === 'string' && id.test(card.id) && reference(card.board), 'Invalid daughtercard');
        }
        unique(value.cards.map(c => c.id as string), 'daughtercard ID');
    }
    return JSON.parse(JSON.stringify(value)) as PhysicalConfiguration;
}
export function createPhysicalBoard(value: unknown): PhysicalBoard {
    requireValue(object(value), 'Invalid constraint profile');
    keys(value, ['kind', 'extension', 'pins', 'interfaces']);
    requireValue(value.kind === 'board' || value.kind === 'daughtercard', 'Choose board or daughtercard');
    requireValue(typeof value.extension === 'string' && /^\.[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value.extension), 'Invalid constraint extension');
    requireValue(object(value.pins) && Object.keys(value.pins).length <= 50000, 'Invalid pin templates');
    for (const [name, text] of Object.entries(value.pins)) {
        requireValue(id.test(name), 'Invalid pin template name: ' + name);
        requireValue(typeof text === 'string' && text.length <= 2000000 && !text.includes('\0'), 'Invalid template: ' + name);
        requireValue(value.kind !== 'board' || !text.includes('{pin name}'), 'Board templates cannot contain {pin name}');
    }
    requireValue(Array.isArray(value.interfaces) && value.interfaces.length <= 4096, 'Invalid interfaces');
    for (const iface of value.interfaces) {
        requireValue(object(iface), 'Invalid interface');
        keys(iface, ['id', 'signals']);
        requireValue(typeof iface.id === 'string' && id.test(iface.id) && Array.isArray(iface.signals), 'Invalid interface ID/signals');
        for (const signal of iface.signals) {
            requireValue(object(signal), 'Invalid signal');
            keys(signal, ['id', 'direction', 'pins']);
            requireValue(typeof signal.id === 'string' && /^[A-Za-z0-9_][A-Za-z0-9_-]*$/.test(signal.id) && ['input', 'output', 'inout'].includes(String(signal.direction)), 'Invalid signal ID/direction');
            requireValue(Array.isArray(signal.pins) && signal.pins.length > 0 && signal.pins.length <= 4096 && signal.pins.every(p => typeof p === 'string' && (p === '' || id.test(p))), 'Invalid signal pins');
            unique(signal.pins.filter(Boolean) as string[], 'signal pin');
        }
        unique(iface.signals.map(s => s.id as string), 'signal ID');
        unique(iface.signals.flatMap(s => s.pins as string[]).filter(Boolean), 'interface pin');
    }
    unique(value.interfaces.map(i => i.id as string), 'interface ID');
    return { model: JSON.parse(JSON.stringify(value)) as PhysicalBoardModel };
}
export function physicalPins(model: PhysicalBoardModel): string[] { return Object.keys(model.pins); }
export function physicalSignalMembers(iface: PhysicalInterface, name: string): string[] {
    const signal = iface.signals.find(s => s.id === name);
    if (!signal)
        return [];
    return signalMembers(signal);
}
function signalMembers(signal: PhysicalSignal): string[] {
    return signal.pins.length === 1 ? [signal.id] : signal.pins.map((_, i) => `${signal.id}.${signal.pins.length - 1 - i}`);
}
export function physicalEndpoint(board: PhysicalBoard, source: PhysicalBinding['source']): {
    pin: string;
    signal: PhysicalSignal;
} {
    const model = source.card ? board.cards?.[source.card] : board.model;
    const iface = model?.interfaces.find(i => i.id === source.interface);
    const name = source.member.split('.')[0];
    const signal = iface?.signals.find(s => s.id === name);
    const index = signal ? signalMembers(signal).indexOf(source.member) : -1;
    requireValue(iface && signal && index >= 0, 'Unknown interface signal: ' + (source.card ? source.card + '.' : '') + source.interface + '.' + source.member);
    return { signal, pin: signal.pins[index] };
}
export function bindPhysicalSignal(board: PhysicalBoard, ports: readonly PhysicalPort[], ifaceId: string, signalId: string, selection: string | readonly PhysicalBinding['port'][], card?: string): PhysicalBinding[] {
    const model = card ? board.cards?.[card] : board.model, iface = model?.interfaces.find(i => i.id === ifaceId);
    requireValue(iface, 'Choose a valid signal');
    const members = iface.signals.some(s => s.id === signalId) ? physicalSignalMembers(iface, signalId) : [signalId];
    const selected = typeof selection === 'string' ? [{ name: selection }] : selection;
    requireValue(Array.isArray(selected) && selected.length > 0 && selected.length <= 4096, 'Choose a valid resolved port');
    const portIndex = new Map(ports.map(port => [port.name, port]));
    const refs = selected.flatMap(ref => {
        const port = portIndex.get(ref?.name);
        requireValue(port && !port.unresolved, 'Choose a valid resolved port');
        requireValue(ref.bit === undefined || port.indices?.includes(ref.bit), 'Unknown port/bit');
        return ref.bit !== undefined ? [{ name: port.name, bit: ref.bit }] : (port.indices ?? [undefined]).map(bit => ({ name: port.name, ...(bit === undefined ? {} : { bit }) }));
    });
    requireValue(refs.length === members.length, 'Width mismatch');
    unique(refs.map(ref => JSON.stringify(ref)), 'port/bit');
    return members.map((member, i) => {
        const source = { ...(card ? { card } : {}), interface: ifaceId, member };
        requireValue(physicalEndpoint(board, source).signal.direction === portIndex.get(refs[i].name)!.direction, 'Port direction mismatch');
        return { source, port: refs[i] };
    });
}
export function generateConstraints(board: PhysicalBoard, configuration: PhysicalConfiguration, ports: readonly PhysicalPort[]): {
    text?: string;
    diagnostics: PinDiagnostic[];
} {
    const diagnostics: PinDiagnostic[] = [], error = (message: string) => { diagnostics.push({ severity: 'error', message }); };
    let config: PhysicalConfiguration;
    try {
        config = parsePhysicalConfiguration(configuration);
    }
    catch (e) {
        return { diagnostics: [{ severity: 'error', message: (e as Error).message }] };
    }
    if (board.model.kind !== 'board')
        error('Choose a main board');
    const ordered: PhysicalBinding[] = [];
    const seen = new Set<string>(), resources = new Set<string>(), usedPorts = new Set<string>();
    const mounts = new Map((config.cards ?? []).map(c => [c.id, c]));
    const models = [[undefined, board.model] as const, ...(config.cards ?? []).map(c => [c.id, board.cards?.[c.id]] as const)];
    const endpointKey = (card: string | undefined, iface: string, member: string) => JSON.stringify([card ?? '', iface, member]);
    const endpoints = new Map<string, { pin: string; signal: PhysicalSignal }>();
    for (const [card, model] of models)
        for (const iface of model?.interfaces ?? [])
            for (const signal of iface.signals)
                signalMembers(signal).forEach((member, index) => endpoints.set(endpointKey(card, iface.id, member), { pin: signal.pins[index], signal }));
    const portIndex = new Map(ports.map(port => [port.name, port]));
    const bindingIndex = new Map<string, PhysicalBinding>();
    for (const mount of config.cards ?? []) {
        const child = board.cards?.[mount.id];
        if (!child || child.kind !== 'daughtercard')
            error('Missing daughtercard: ' + mount.id);
        else if (child.extension !== board.model.extension)
            error('Constraint format differs for daughtercard: ' + mount.id);
    }
    for (const binding of config.bindings) {
        try {
            const card = binding.source.card;
            requireValue(!card || mounts.has(card), 'Daughtercard is not added: ' + card);
            const model = card ? board.cards?.[card] : board.model;
            requireValue(model, 'Missing board model');
            const key = endpointKey(card, binding.source.interface, binding.source.member);
            const endpoint = endpoints.get(key);
            requireValue(endpoint, 'Unknown interface signal: ' + (card ? card + '.' : '') + binding.source.interface + '.' + binding.source.member);
            const { pin, signal } = endpoint;
            requireValue(pin && Object.prototype.hasOwnProperty.call(model.pins, pin), 'Unknown pin template: ' + pin);
            requireValue(!seen.has(key), 'Duplicate signal binding');
            seen.add(key);
            bindingIndex.set(key, binding);
            const resource = JSON.stringify([card ?? '', pin]);
            requireValue(!resources.has(resource), 'Pin template already bound: ' + pin);
            resources.add(resource);
            const port = portIndex.get(binding.port.name);
            const name = binding.port.name + (binding.port.bit === undefined ? '' : `[${binding.port.bit}]`);
            requireValue(port && !port.unresolved && (port.indices ? port.indices.includes(binding.port.bit!) : binding.port.bit === undefined), 'Unknown or unresolved port/bit: ' + name);
            requireValue(port.direction === signal.direction, 'Port direction mismatch: ' + name);
            requireValue(!usedPorts.has(name), 'Port already bound: ' + name);
            usedPorts.add(name);
            const text = model.pins[pin];
            requireValue(text.trim() && text.includes('{signal name}'), 'Template must contain {signal name}: ' + pin);
            requireValue(!card || !text.includes('{pin name}') || binding.pin?.trim(), 'Enter FPGA pin for ' + binding.source.member);
        }
        catch (e) {
            error((e as Error).message);
        }
    }
    for (const [card, model] of models) {
        if (!model)
            continue;
        for (const iface of model.interfaces)
            for (const signal of iface.signals) {
                const members = signalMembers(signal);
                const group = members.map(member => bindingIndex.get(endpointKey(card, iface.id, member))).filter((binding): binding is PhysicalBinding => !!binding);
                if (group.length && group.length !== members.length)
                    error('Assign every bit of ' + iface.id + '.' + signal.id);
                ordered.push(...group);
            }
    }
    if (diagnostics.length)
        return { diagnostics };
    let text = '';
    for (const binding of ordered) {
        const model = binding.source.card ? board.cards![binding.source.card] : board.model;
        const { pin } = endpoints.get(endpointKey(binding.source.card, binding.source.interface, binding.source.member))!;
        const target = binding.port.name + (binding.port.bit === undefined ? '' : `[${binding.port.bit}]`);
        const fragment = model.pins[pin].replace(/\{signal name\}|\{pin name\}/g, token => token === '{signal name}' ? target : binding.pin ?? '');
        text += (text && !/[\r\n]$/.test(text) ? '\n' : '') + fragment;
    }
    return { text, diagnostics };
}
