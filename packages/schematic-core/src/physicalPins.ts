import { constraintPinNames, renderConstraintText } from './physicalConstraints';
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
    constraints: string;
    interfaces: PhysicalInterface[];
};
export type PhysicalBinding = Readonly<{
    source: {
        card?: string;
        interface: string;
        member: string;
    };
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
        connections: readonly {
            cardPin: string;
            boardPin: string;
        }[];
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
function requireValue(ok: unknown, message: string): asserts ok { if (!ok)
    throw new Error(message); }
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
        keys(binding, ['source', 'port']);
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
            keys(card, ['id', 'board', 'connections']);
            requireValue(typeof card.id === 'string' && id.test(card.id) && reference(card.board) && Array.isArray(card.connections), 'Invalid daughtercard');
            for (const connection of card.connections) {
                requireValue(object(connection), 'Invalid daughtercard connection');
                keys(connection, ['cardPin', 'boardPin']);
                requireValue(typeof connection.cardPin === 'string' && id.test(connection.cardPin) && typeof connection.boardPin === 'string' && id.test(connection.boardPin), 'Invalid daughtercard pin');
            }
            unique(card.connections.map(c => c.cardPin as string), 'daughtercard source pin');
            unique(card.connections.map(c => c.boardPin as string), 'daughtercard target pin');
        }
        unique(value.cards.map(c => c.id as string), 'daughtercard ID');
    }
    return JSON.parse(JSON.stringify(value)) as PhysicalConfiguration;
}
export function importPhysicalConstraints(constraints: string, extension: string, kind: PhysicalBoardModel['kind'] = 'board'): PhysicalBoardModel {
    return createPhysicalBoard({ kind, extension, constraints, interfaces: [] }).model;
}
export function createPhysicalBoard(value: unknown): PhysicalBoard {
    requireValue(object(value), 'Invalid constraint profile');
    if ('vendor' in value || 'fpgaPins' in value)
        throw new Error('This unpublished board model has no original constraints. Import the constraint file again.');
    keys(value, ['kind', 'extension', 'constraints', 'interfaces']);
    requireValue(value.kind === 'board' || value.kind === 'daughtercard', 'Choose board or daughtercard');
    requireValue(typeof value.extension === 'string' && /^\.[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value.extension), 'Invalid constraint extension');
    requireValue(typeof value.constraints === 'string' && value.constraints.length <= 20000000 && !value.constraints.includes('\0'), 'Invalid constraint text');
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
export function physicalPins(model: PhysicalBoardModel): string[] { return constraintPinNames(model.constraints, model.extension); }
export function physicalSignalMembers(iface: PhysicalInterface, name: string): string[] {
    const signal = iface.signals.find(s => s.id === name);
    if (!signal)
        return [];
    return signal.pins.length === 1 ? [name] : signal.pins.map((_, i) => `${name}.${signal.pins.length - 1 - i}`);
}
export function physicalEndpoint(board: PhysicalBoard, source: PhysicalBinding['source']): {
    pin: string;
    signal: PhysicalSignal;
} {
    const model = source.card ? board.cards?.[source.card] : board.model;
    const iface = model?.interfaces.find(i => i.id === source.interface);
    const signal = iface?.signals.find(s => physicalSignalMembers(iface, s.id).includes(source.member));
    requireValue(iface && signal, 'Unknown interface signal: ' + (source.card ? source.card + '.' : '') + source.interface + '.' + source.member);
    return { signal, pin: signal.pins[physicalSignalMembers(iface, signal.id).indexOf(source.member)] };
}
export function bindPhysicalSignal(board: PhysicalBoard, ports: readonly PhysicalPort[], ifaceId: string, signalId: string, portName: string, card?: string): PhysicalBinding[] {
    const model = card ? board.cards?.[card] : board.model, iface = model?.interfaces.find(i => i.id === ifaceId), port = ports.find(p => p.name === portName);
    requireValue(iface && port && !port.unresolved, 'Choose a valid signal and resolved port');
    const members = iface.signals.some(s => s.id === signalId) ? physicalSignalMembers(iface, signalId) : [signalId];
    const indices = port.indices ?? [undefined];
    requireValue(indices.length === members.length, 'Width mismatch');
    return members.map((member, i) => {
        const source = { ...(card ? { card } : {}), interface: ifaceId, member };
        requireValue(physicalEndpoint(board, source).signal.direction === port.direction, 'Port direction mismatch');
        return { source, port: { name: portName, ...(indices[i] === undefined ? {} : { bit: indices[i] }) } };
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
    const targets = new Map<string, Map<string, {
        port: string;
        pin: string;
    }>>([['', new Map()]]), usedPins = new Set<string>(), usedPorts = new Set<string>(), sources = new Set<string>();
    const mountedPins = new Map<string, string>();
    const availablePins = new Map<string, Set<string>>([['', new Set(physicalPins(board.model))], ...Object.entries(board.cards ?? {}).map(([id, model]): [
            string,
            Set<string>
        ] => [id, new Set(physicalPins(model))])]);
    for (const mount of config.cards ?? []) {
        const child = board.cards?.[mount.id];
        if (!child || child.kind !== 'daughtercard') {
            error('Missing daughtercard: ' + mount.id);
            continue;
        }
        if (child.extension !== board.model.extension)
            error('Constraint format differs for daughtercard: ' + mount.id);
        const available = availablePins.get('')!, childPins = availablePins.get(mount.id)!;
        for (const connection of mount.connections) {
            if (!available.has(connection.boardPin) || !childPins.has(connection.cardPin))
                error('Unknown mounted pin: ' + mount.id + '.' + connection.cardPin);
            if (mountedPins.has(connection.boardPin))
                error('Daughtercard pin conflict: ' + connection.boardPin);
            mountedPins.set(connection.boardPin, mount.id);
        }
        targets.set(mount.id, new Map());
    }
    for (const binding of config.bindings) {
        try {
            const { pin, signal } = physicalEndpoint(board, binding.source), card = binding.source.card ?? '';
            requireValue(pin, 'Select a pin for ' + binding.source.member);
            requireValue(availablePins.get(card)?.has(pin), 'Unknown constraint pin: ' + pin);
            const mount = config.cards?.find(c => c.id === card), finalPin = card ? mount?.connections.find(c => c.cardPin === pin)?.boardPin : pin;
            requireValue(finalPin, 'Unmapped daughtercard pin: ' + card + '.' + pin);
            requireValue(!mountedPins.has(finalPin) || mountedPins.get(finalPin) === card, 'Pin reserved by daughtercard: ' + finalPin);
            const port = ports.find(p => p.name === binding.port.name), target = binding.port.name + (binding.port.bit === undefined ? '' : `[${binding.port.bit}]`);
            requireValue(port && !port.unresolved && (port.indices ? port.indices.includes(binding.port.bit!) : binding.port.bit === undefined), 'Unknown or unresolved port/bit: ' + target);
            requireValue(port.direction === signal.direction, 'Port direction mismatch: ' + target);
            const key = JSON.stringify(binding.source);
            requireValue(!sources.has(key), 'Duplicate physical signal binding');
            sources.add(key);
            requireValue(!usedPins.has(finalPin), 'Pin conflict: ' + finalPin);
            requireValue(!usedPorts.has(target), 'Port conflict: ' + target);
            usedPins.add(finalPin);
            usedPorts.add(target);
            requireValue(targets.has(card), 'Daughtercard is not mounted: ' + card);
            targets.get(card)!.set(pin, { port: target, pin: finalPin });
        }
        catch (e) {
            error((e as Error).message);
        }
    }
    const output: string[] = [];
    for (const [card, mapping] of targets) {
        if (card && !mapping.size)
            continue;
        const model = card ? board.cards![card] : board.model;
        const rendered = renderConstraintText(model.constraints, model.extension, mapping);
        rendered.errors.forEach(error);
        if (rendered.text !== undefined)
            output.push(rendered.text);
    }
    const newline = board.model.constraints.includes('\r\n') ? '\r\n' : '\n';
    const text = output.reduce((combined, fragment) => !fragment ? combined
        : combined + (combined && !/[\r\n]$/.test(combined) ? newline : '') + fragment, '');
    return diagnostics.length ? { diagnostics } : { text, diagnostics };
}
