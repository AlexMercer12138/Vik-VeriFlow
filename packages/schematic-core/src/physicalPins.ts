import { physicalStandardRules } from './physicalIoStandards';
export { physicalPinVoltage, physicalBankType } from './physicalIoStandards';
/** Hardware facts stay in the board model; vendor constraint rules live here. */
export type PhysicalPort = Readonly<{
    name: string;
    direction: 'input' | 'output' | 'inout';
    indices?: readonly number[];
    unresolved?: boolean;
}>;
export type PhysicalBinding = Readonly<{
    source: {
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
    selections?: readonly { interface: string; members: readonly string[] }[];
    ioStandards?: readonly { interface: string; member: string; standard: string }[];
    railVoltages?: readonly {
        rail: string;
        millivolts: number;
    }[];
    bindings: readonly PhysicalBinding[];
}>;
export type PhysicalInterface = {
    kind: 'fixed' | 'expansion';
    signals: string[];
    function?: Record<string, Record<string, 'input' | 'output' | 'inout'>>;
    bus?: Record<string, number>;
    groups?: {
        id: string;
        members: string[];
        selection?: 'individual' | 'together';
    }[];
    differentialPairs?: {
        positive: string;
        negative: string;
    }[];
};
export type PhysicalBoardModel = {
    kind: 'board';
    vendor: string;
    device: string;
    rails?: {
        id: string;
        millivolts?: number | number[];
    }[];
    banks?: {
        id: string;
        supplyRail?: string;
        type?: 'hp' | 'hr' | 'hd' | 'gt';
    }[];
    fpgaPins: {
        id: string;
        bank?: string;
        reservation?: 'warn' | 'forbid';
        clockCapable?: boolean;
    }[];
    differentialPairs?: {
        positive: string;
        negative: string;
    }[];
    interfaces: {
        id: string;
        definition: string;
        function?: string;
        signals?: string[];
    }[];
    routes: {
        interface: string;
        member: string;
        pin: string;
    }[];
    clocks?: {
        interface: string;
        member: string;
        frequencyHz: number;
    }[];
};
export type PhysicalBoard = {
    model: PhysicalBoardModel;
    definitions: Record<string, PhysicalInterface>;
};
export type PinDiagnostic = {
    severity: 'error' | 'warning';
    message: string;
};
const id = /^[A-Za-z0-9_][A-Za-z0-9_.-]*$/;
const hdlId = /^[A-Za-z_][A-Za-z0-9_$]*$/;
function requireValue(ok: unknown, message: string): asserts ok { if (!ok)
    throw new Error(message); }
function object(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function keys(value: Record<string, unknown>, allowed: string[]): void { requireValue(Object.keys(value).every(key => allowed.includes(key)), `Unknown physical field: ${Object.keys(value).find(key => !allowed.includes(key))}`); }
function unique(items: readonly string[], label: string): void { requireValue(new Set(items).size === items.length, `Duplicate ${label}`); }
function records(value: Record<string, unknown>, field: string, allowed: string[], required = allowed, optional = true): void {
    const items = value[field];
    if (items === undefined && optional)
        return;
    requireValue(Array.isArray(items) && items.length > 0 && items.length <= 50000, `Invalid ${field}`);
    for (const item of items) {
        requireValue(object(item), `Invalid ${field} entry`);
        keys(item, allowed);
        requireValue(required.every(key => item[key] !== undefined), `Missing ${field} field`);
    }
}
const signalKey = (iface: string, member: string): string => JSON.stringify([iface, member]);
export function parsePhysicalConfiguration(value: unknown): PhysicalConfiguration {
    requireValue(object(value), 'Physical configuration must be an object');
    keys(value, ['board', 'selections', 'ioStandards', 'railVoltages', 'bindings', 'boardSettings']);
    requireValue(typeof value.board === 'string' && value.board.length > 0 && !/[\r\n\0]/.test(value.board), 'Choose a board');
    requireValue(Array.isArray(value.bindings) && value.bindings.length <= 50000, 'Invalid pin bindings');
    if (value.selections !== undefined) {
        requireValue(Array.isArray(value.selections) && value.selections.length <= 4096, 'Invalid physical selections');
        for (const selection of value.selections) {
            requireValue(object(selection), 'Invalid physical selection');
            keys(selection, ['interface', 'members']);
            requireValue(typeof selection.interface === 'string' && id.test(selection.interface) && Array.isArray(selection.members) && selection.members.length > 0 && selection.members.length <= 50000 && selection.members.every(m => typeof m === 'string' && id.test(m)), 'Invalid physical selection');
            unique(selection.members as string[], 'selected signal');
        }
        unique(value.selections.map(s => s.interface as string), 'selected interface');
    }
    for (const binding of value.bindings) {
        requireValue(object(binding) && object(binding.source) && object(binding.port), 'Invalid pin binding');
        keys(binding, ['source', 'port']);
        keys(binding.source, ['interface', 'member']);
        keys(binding.port, ['name', 'bit']);
        requireValue(typeof binding.source.interface === 'string' && id.test(binding.source.interface) && typeof binding.source.member === 'string' && id.test(binding.source.member), 'Invalid physical signal');
        requireValue(typeof binding.port.name === 'string' && hdlId.test(binding.port.name), 'Invalid RTL port');
        requireValue(binding.port.bit === undefined || Number.isSafeInteger(binding.port.bit), 'Invalid port bit');
    }
    if (value.ioStandards !== undefined) {
        requireValue(Array.isArray(value.ioStandards) && value.ioStandards.length <= 50000, 'Invalid IO standards');
        for (const entry of value.ioStandards) {
            requireValue(object(entry), 'Invalid IO standard');
            keys(entry, ['interface', 'member', 'standard']);
            requireValue(typeof entry.interface === 'string' && id.test(entry.interface) && typeof entry.member === 'string' && id.test(entry.member)
                && typeof entry.standard === 'string' && /^[A-Z][A-Z0-9_]*$/.test(entry.standard), 'Invalid IO standard');
        }
        unique(value.ioStandards.map(e => signalKey(e.interface as string, e.member as string)), 'IO standard');
    }
    if (value.railVoltages !== undefined) {
        requireValue(Array.isArray(value.railVoltages) && value.railVoltages.length <= 4096, 'Invalid railVoltages');
        for (const entry of value.railVoltages) {
            requireValue(object(entry), 'Invalid rail voltage');
            keys(entry, ['rail', 'millivolts']);
            requireValue(typeof entry.rail === 'string' && id.test(entry.rail) && Number.isSafeInteger(entry.millivolts) && Number(entry.millivolts) > 0, 'Invalid rail voltage');
        }
    }
    // Old ADs may contain jumper settings. Ignore them; resources are reserved by selection.
    const { boardSettings: _legacy, ...current } = value;
    return JSON.parse(JSON.stringify(current)) as PhysicalConfiguration;
}
export function physicalSignalMembers(def: PhysicalInterface, signal: string): string[] {
    const bus = Object.prototype.hasOwnProperty.call(def.bus ?? {}, signal) ? def.bus![signal] : undefined;
    return bus === undefined ? [signal] : Array.from({ length: bus }, (_, i) => `${signal}.${bus - 1 - i}`);
}
export function physicalMembers(def: PhysicalInterface): string[] { return def.signals.flatMap(signal => physicalSignalMembers(def, signal)); }
function memberDirection(def: PhysicalInterface, role: string, member: string): PhysicalPort['direction'] | undefined {
    const signal = def.signals.find(signal => physicalSignalMembers(def, signal).includes(member));
    return signal === undefined ? undefined : def.function?.[role]?.[signal];
}
export function physicalPairs(def: PhysicalInterface): {
    positive: string;
    negative: string;
}[] {
    return (def.differentialPairs ?? []).flatMap(pair => {
        const p = physicalSignalMembers(def, pair.positive), n = physicalSignalMembers(def, pair.negative);
        requireValue(p.length === n.length, 'Differential bus widths differ');
        return p.map((positive, i) => ({ positive, negative: n[i] }));
    });
}
/** Hardware instances can use part of a shared template without redefining it. */
export function physicalInterfaceSubset(def: PhysicalInterface, signals?: readonly string[]): PhysicalInterface {
    if (signals === undefined) return def;
    requireValue(Array.isArray(signals) && signals.length > 0 && signals.every(s => def.signals.includes(s)), 'Unknown interface signal in subset');
    unique(signals, 'interface subset signal');
    const members = new Set(signals.flatMap(s => physicalSignalMembers(def, s)));
    if (def.kind === 'fixed') for (const pair of physicalPairs(def))
        requireValue(members.has(pair.positive) === members.has(pair.negative), 'Select the complete differential pair in the interface subset');
    const groups = (def.groups ?? []).map(group => {
        const remaining = group.members.filter(m => physicalSignalMembers(def, m).every(bit => members.has(bit)));
        requireValue(group.selection !== 'together' || !remaining.length || remaining.length === group.members.length, 'Select the complete group in the interface subset');
        return { ...group, members: remaining };
    }).filter(group => group.members.length);
    const pairs = (def.differentialPairs ?? []).filter(pair => [pair.positive, pair.negative].every(s => physicalSignalMembers(def, s).every(m => members.has(m))));
    const bus = Object.fromEntries(Object.entries(def.bus ?? {}).filter(([s]) => signals.includes(s)));
    return { ...def, signals: def.signals.filter(s => signals.includes(s)),
        ...(def.function ? { function: Object.fromEntries(Object.entries(def.function).map(([role, dirs]) => [role,
            Object.fromEntries(Object.entries(dirs).filter(([s]) => signals.includes(s)))])) } : {}),
        bus: Object.keys(bus).length ? bus : undefined, groups: groups.length ? groups : undefined,
        differentialPairs: pairs.length ? pairs : undefined };
}
export function physicalIoStandards(board: PhysicalBoard, config: PhysicalConfiguration, iface: string, member: string, direction?: PhysicalPort['direction']) {
    const def = board.definitions[iface], route = board.model.routes.find(r => r.interface === iface && r.member === member);
    if (!def || !route) return [];
    const pair = physicalPairs(def).some(p => p.positive === member || p.negative === member);
    const instance = board.model.interfaces.find(i => i.id === iface)!;
    const role = instance.function ?? Object.keys(def.function ?? {})[0];
    return physicalStandardRules(board, config, route.pin, pair ? (def.kind === 'fixed' ? true : undefined) : false,
        direction ?? (def.kind === 'fixed' ? memberDirection(def, role, member) : undefined));
}
export function setPhysicalIoStandard(board: PhysicalBoard, config: PhysicalConfiguration, iface: string, members: readonly string[], standard: string, ports: readonly PhysicalPort[] = []): PhysicalConfiguration {
    const def = board.definitions[iface];
    requireValue(def && members.length > 0 && members.every(m => physicalSelectionMembers(config, iface).includes(m)), 'Select the physical signal first');
    const targets = new Set(members);
    const firstBinding = config.bindings.find(b => b.source.interface === iface && b.source.member === members[0]);
    const firstDirection = ports.find(p => p.name === firstBinding?.port.name)?.direction;
    if (def.kind === 'fixed' || physicalIoStandards(board, config, iface, members[0], firstDirection).some(o => o.name === standard && o.differential))
        for (const pair of physicalPairs(def))
            if (targets.has(pair.positive) || targets.has(pair.negative)) { targets.add(pair.positive); targets.add(pair.negative); }
    if (standard) for (const member of targets) {
        requireValue(physicalSelectionMembers(config, iface).includes(member), 'Select both differential signals first');
        const binding = config.bindings.find(b => b.source.interface === iface && b.source.member === member);
        const direction = ports.find(p => p.name === binding?.port.name)?.direction;
        requireValue(physicalIoStandards(board, config, iface, member, direction).some(o => o.name === standard), 'IO standard is not available for Bank voltage: ' + standard);
    }
    return { ...config, ioStandards: [...(config.ioStandards ?? []).filter(e => e.interface !== iface || !targets.has(e.member)),
        ...[...targets].filter(() => standard).map(member => ({ interface: iface, member, standard }))] };
}
export function createPhysicalBoard(value: unknown, definitions: Record<string, unknown>): PhysicalBoard {
    requireValue(object(value) && value.kind === 'board', 'Not a board model');
    keys(value, ['kind', 'vendor', 'device', 'rails', 'banks', 'fpgaPins', 'differentialPairs', 'interfaces', 'routes', 'clocks']);
    requireValue(typeof value.vendor === 'string' && typeof value.device === 'string', 'Missing board device/vendor');
    requireValue(Array.isArray(value.fpgaPins) && Array.isArray(value.interfaces) && Array.isArray(value.routes), 'Missing board pins, interfaces or routes');
    requireValue(/^[a-z][a-z0-9-]*$/.test(value.vendor) && value.device.length > 0, 'Invalid board device/vendor');
    records(value, 'fpgaPins', ['id', 'bank', 'reservation', 'clockCapable'], ['id'], false);
    records(value, 'interfaces', ['id', 'definition', 'function', 'signals'], ['id', 'definition'], false);
    records(value, 'routes', ['interface', 'member', 'pin'], ['interface', 'member', 'pin'], false);
    records(value, 'rails', ['id', 'millivolts'], ['id']);
    records(value, 'banks', ['id', 'supplyRail', 'type'], ['id']);
    records(value, 'differentialPairs', ['positive', 'negative']);
    records(value, 'clocks', ['interface', 'member', 'frequencyHz']);
    const model = value as unknown as PhysicalBoardModel;
    const defs: Record<string, PhysicalInterface> = Object.create(null);
    unique(model.fpgaPins.map(pin => pin.id), 'package pin');
    unique(model.interfaces.map(i => i.id), 'board interface');
    unique((model.banks ?? []).map(b => b.id), 'Bank');
    unique((model.rails ?? []).map(r => r.id), 'rail');
    unique(model.routes.map(r => signalKey(r.interface, r.member)), 'interface route');
    for (const pin of model.fpgaPins) {
        requireValue(typeof pin.id === 'string' && id.test(pin.id), 'Invalid package pin');
        requireValue(pin.reservation === undefined || ['warn', 'forbid'].includes(pin.reservation), 'Invalid pin reservation');
        requireValue(pin.clockCapable === undefined || typeof pin.clockCapable === 'boolean', 'Invalid clock-capable pin');
        requireValue(pin.bank === undefined || model.banks?.some(bank => bank.id === pin.bank), `Unknown Bank of ${pin.id}`);
    }
    for (const bank of model.banks ?? []) {
        requireValue(bank.type === undefined || ['hp', 'hr', 'hd', 'gt'].includes(bank.type), 'Invalid Bank type');
        requireValue(typeof bank.id === 'string' && id.test(bank.id), 'Invalid Bank ID');
        requireValue(bank.supplyRail === undefined || model.rails?.some(rail => rail.id === bank.supplyRail), `Unknown rail of Bank ${bank.id}`);
    }
    for (const rail of model.rails ?? []) {
        requireValue(typeof rail.id === 'string' && id.test(rail.id), 'Invalid rail ID');
        if (rail.millivolts === undefined)
            continue;
        const voltages = Array.isArray(rail.millivolts) ? rail.millivolts : [rail.millivolts];
        requireValue(voltages.length > 0 && voltages.every(v => Number.isSafeInteger(v) && v > 0), `Invalid voltage for ${rail.id}`);
        unique(voltages.map(String), 'rail voltage');
    }
    for (const instance of model.interfaces) {
        requireValue(typeof instance.id === 'string' && id.test(instance.id) && typeof instance.definition === 'string' &&
            (/^library:interfaces\/[A-Za-z0-9_][A-Za-z0-9_.-]*\.json$/.test(instance.definition) ||
                /^(?![A-Za-z][A-Za-z0-9+.-]*:)(?![/\\])(?!.*[\r\n\u0000]).+$/.test(instance.definition)), 'Invalid board interface');
        const def = definitions[instance.definition];
        requireValue(object(def) && (def.kind === 'fixed' || def.kind === 'expansion') && Array.isArray(def.signals), 'Missing interface definition: ' + instance.definition);
        keys(def, ['kind', 'signals', 'function', 'bus', 'groups', 'differentialPairs']);
        const iface = def as unknown as PhysicalInterface;
        records(def, 'groups', ['id', 'members', 'selection'], ['id', 'members']);
        records(def, 'differentialPairs', ['positive', 'negative']);
        requireValue(iface.signals.length > 0 && iface.signals.every(s => typeof s === 'string' && id.test(s)), 'Invalid interface signals');
        unique(iface.signals, 'signal');
        requireValue(iface.bus === undefined || object(iface.bus), 'Invalid bus');
        for (const [name, bus] of Object.entries(iface.bus ?? {})) {
            requireValue(id.test(name), 'Invalid bus ID');
            requireValue(Number.isSafeInteger(bus) && bus > 0 && bus <= 4096 && iface.signals.includes(name), 'Invalid bus width');
        }
        const members = physicalMembers(iface);
        unique(members, 'expanded signal');
        if (iface.kind === 'fixed') {
            requireValue(object(iface.function) && Object.keys(iface.function).length > 0, 'Missing fixed interface roles');
            requireValue(Object.keys(iface.function).every(role => id.test(role)), 'Invalid interface role');
            for (const dirs of Object.values(iface.function)) {
                requireValue(object(dirs) && Object.keys(dirs).length === iface.signals.length && iface.signals.every(s => ['input', 'output', 'inout'].includes(dirs[s])), 'Role must cover all signals');
            }
            requireValue(instance.function ? Object.prototype.hasOwnProperty.call(iface.function, instance.function) : Object.keys(iface.function).length === 1, 'Choose interface function: ' + instance.id);
        }
        else
            requireValue(instance.function === undefined && iface.function === undefined, 'Expansion cannot have a function');
        const pairs = physicalPairs(iface);
        unique(pairs.flatMap(p => [p.positive, p.negative]), 'differential member');
        for (const p of pairs) {
            requireValue(members.includes(p.positive) && members.includes(p.negative), 'Unknown differential pair member');
            for (const role of Object.keys(iface.function ?? {}))
                requireValue(memberDirection(iface, role, p.positive) === memberDirection(iface, role, p.negative), 'Differential pair direction differs');
        }
        unique((iface.groups ?? []).map(g => g.id), 'group');
        for (const group of iface.groups ?? []) {
            requireValue(typeof group.id === 'string' && id.test(group.id) && Array.isArray(group.members) && group.members.length > 0 && (group.selection === undefined || ['together', 'individual'].includes(group.selection)), 'Invalid signal group');
            unique(group.members, 'group member');
            requireValue(group.members.every(m => members.includes(m) || iface.signals.includes(m) || Object.prototype.hasOwnProperty.call(iface.bus ?? {}, m)), 'Unknown group member');
        }
        defs[instance.id] = physicalInterfaceSubset(iface, instance.signals);
    }
    for (const route of model.routes) {
        requireValue(defs[route.interface] && physicalMembers(defs[route.interface]).includes(route.member) && model.fpgaPins.some(pin => pin.id === route.pin), 'Unknown board route');
    }
    for (const instance of model.interfaces)
        for (const member of physicalMembers(defs[instance.id]))
            requireValue(model.routes.some(r => r.interface === instance.id && r.member === member), `No route for ${instance.id}.${member}`);
    for (const p of model.differentialPairs ?? [])
        requireValue(p.positive !== p.negative && model.fpgaPins.some(pin => pin.id === p.positive) && model.fpgaPins.some(pin => pin.id === p.negative) && model.fpgaPins.find(pin => pin.id === p.positive)?.bank === model.fpgaPins.find(pin => pin.id === p.negative)?.bank, 'Unknown package differential pair or mismatched Banks');
    unique((model.differentialPairs ?? []).flatMap(p => [p.positive, p.negative]), 'package pair member');
    unique((model.clocks ?? []).map(c => signalKey(c.interface, c.member)), 'board clock');
    for (const clock of model.clocks ?? []) {
        const def = defs[clock.interface], instance = model.interfaces.find(i => i.id === clock.interface);
        requireValue(def?.kind === 'fixed' && physicalMembers(def).includes(clock.member) && Number.isSafeInteger(clock.frequencyHz) && clock.frequencyHz > 0, 'Invalid board clock');
        const role = instance?.function ?? Object.keys(def.function ?? {})[0];
        requireValue(memberDirection(def, role, clock.member) === 'input' && !physicalPairs(def).some(p => p.negative === clock.member), 'Invalid clock direction/polarity');
    }
    return { model, definitions: defs };
}
export function bindPhysicalSignal(board: PhysicalBoard, ports: readonly PhysicalPort[], iface: string, signal: string, portName: string): PhysicalBinding[] {
    const def = board.definitions[iface], port = ports.find(p => p.name === portName);
    requireValue(def && port, 'Unknown interface or port');
    requireValue(!port.unresolved, 'Resolve the RTL port range before binding');
    const members = physicalSignalMembers(def, signal);
    requireValue(members.every(m => physicalMembers(def).includes(m)), 'Unknown interface signal');
    const indices = port.indices ?? [undefined];
    requireValue(members.length === indices.length, `Width mismatch: ${signal} has ${members.length} pins; ${portName} has ${indices.length} bits`);
    const bindings: PhysicalBinding[] = members.map((member, i) => ({ source: { interface: iface, member }, port: { name: portName, ...(indices[i] === undefined ? {} : { bit: indices[i] }) } }));
    if (def.kind === 'fixed') {
        const pairs = physicalPairs(def);
        const partners = members.map(member => pairs.find(p => p.positive === member)?.negative ?? pairs.find(p => p.negative === member)?.positive);
        if (partners.some(Boolean)) {
            requireValue(partners.every(Boolean), 'Only part of this bus is differential');
            requireValue(!(/_p$/.test(portName) && members.some(m => pairs.some(p => p.negative === m))) && !(/_n$/.test(portName) && members.some(m => pairs.some(p => p.positive === m))), 'Differential port polarity differs');
            const name = /_p$/.test(portName) ? portName.replace(/_p$/, '_n') : /_n$/.test(portName) ? portName.replace(/_n$/, '_p') : undefined;
            const counterpart = ports.find(p => p.name === name);
            requireValue(counterpart && !counterpart.unresolved && JSON.stringify(counterpart.indices) === JSON.stringify(port.indices), `Missing matching differential port ${name ?? '(_p / _n)'}`);
            partners.forEach((member, i) => bindings.push({ source: { interface: iface, member: member! }, port: { name: counterpart.name, ...(indices[i] === undefined ? {} : { bit: indices[i] }) } }));
        }
    }
    return bindings;
}
export function physicalGroupMembers(def: PhysicalInterface, group?: string): string[] {
    if (group === undefined)
        return physicalMembers(def);
    const selection = def.groups?.find(g => g.id === group);
    requireValue(selection, 'Unknown signal group');
    return [...new Set(selection.members.flatMap(member => physicalSignalMembers(def, member)))];
}
export function physicalSelectionMembers(configuration: PhysicalConfiguration, iface: string): readonly string[] {
    return configuration.selections?.find(s => s.interface === iface)?.members ??
        (configuration.selections === undefined ? [...new Set(configuration.bindings.filter(b => b.source.interface === iface).map(b => b.source.member))] : []);
}
/** Reserve hardware independently from RTL assignments, including transitive mandatory groups. */
export function setPhysicalSelection(board: PhysicalBoard, configuration: PhysicalConfiguration, iface: string, requested: readonly string[], checked: boolean): PhysicalConfiguration {
    const def = board.definitions[iface];
    requireValue(def && requested.length > 0 && requested.every(m => physicalMembers(def).includes(m)), 'Unknown physical selection');
    const closure = new Set(requested);
    let size: number;
    do {
        size = closure.size;
        const units = [...(def.groups ?? []).filter(g => g.selection === 'together').map(g => g.members.flatMap(m => physicalSignalMembers(def, m))),
            ...(def.kind === 'fixed' ? physicalPairs(def).map(p => [p.positive, p.negative]) : [])];
        for (const unit of units)
            if (unit.some(m => closure.has(m))) unit.forEach(m => closure.add(m));
    } while (size !== closure.size);
    const selected = new Set(physicalSelectionMembers(configuration, iface));
    for (const member of closure) checked ? selected.add(member) : selected.delete(member);
    const selections = board.model.interfaces.map(instance => ({ interface: instance.id,
        members: instance.id === iface ? physicalMembers(def).filter(m => selected.has(m)) : [...physicalSelectionMembers(configuration, instance.id)] })).filter(s => s.members.length);
    const next: PhysicalConfiguration = { ...configuration, selections,
        bindings: configuration.bindings.filter(b => selections.some(s => s.interface === b.source.interface && s.members.includes(b.source.member))),
        ...(configuration.ioStandards ? { ioStandards: configuration.ioStandards.filter(e => selections.some(s => s.interface === e.interface && s.members.includes(e.member))) } : {}) };
    if (checked) {
        const used = new Set<string>();
        for (const selection of selections) for (const member of selection.members) {
            const routes = board.model.routes.filter(r => r.interface === selection.interface && r.member === member);
            requireValue(routes.length === 1, 'Missing or ambiguous route: ' + selection.interface + '.' + member);
            const pin = board.model.fpgaPins.find(p => p.id === routes[0].pin)!;
            requireValue(pin.reservation !== 'forbid', 'Reserved pin: ' + pin.id);
            requireValue(!used.has(pin.id), 'Pin conflict: ' + pin.id);
            used.add(pin.id);
        }
    }
    return next;
}
/** Group selection reuses manual mappings and fills the remaining ports by unambiguous names. */
export function bindPhysicalGroup(board: PhysicalBoard, ports: readonly PhysicalPort[], iface: string, group?: string, existing: readonly PhysicalBinding[] = []): PhysicalBinding[] {
    const def = board.definitions[iface];
    requireValue(def, 'Unknown interface');
    const members = physicalGroupMembers(def, group), covered = new Set(existing.filter(b => b.source.interface === iface).map(b => b.source.member));
    const added: PhysicalBinding[] = [];
    for (const signal of [...Object.keys(def.bus ?? {}), ...def.signals.filter(s => !Object.prototype.hasOwnProperty.call(def.bus ?? {}, s))]) {
        const bits = physicalSignalMembers(def, signal);
        if (!bits.every(m => members.includes(m)) || bits.every(m => covered.has(m)))
            continue;
        const exact = ports.filter(p => [signal, `${iface}_${signal}`].some(name => name.toLowerCase() === p.name.toLowerCase()));
        const candidates = exact.length ? exact : ports.filter(p => p.name.toLowerCase().endsWith('_' + signal.toLowerCase()));
        requireValue(candidates.length === 1, `Select a port manually for ${iface}.${signal}: ${candidates.length ? 'ambiguous names' : 'no matching port'}`);
        const bindings = bindPhysicalSignal(board, ports, iface, signal, candidates[0].name);
        added.push(...bindings);
        bindings.forEach(b => covered.add(b.source.member));
    }
    requireValue(members.every(m => covered.has(m)), 'Map remaining group members manually');
    return added;
}
export function generateXdc(board: PhysicalBoard, configuration: PhysicalConfiguration, ports: readonly PhysicalPort[]): {
    text?: string;
    diagnostics: PinDiagnostic[];
} {
    const diagnostics: PinDiagnostic[] = [], lines: string[] = [];
    const error = (message: string): void => { diagnostics.push({ severity: 'error', message }); };
    const warn = (message: string): void => { diagnostics.push({ severity: 'warning', message }); };
    const config = parsePhysicalConfiguration(configuration), model = board.model;
    if (config.selections !== undefined) {
        for (const selection of config.selections)
            for (const member of selection.members) {
                if (!board.definitions[selection.interface] || !physicalMembers(board.definitions[selection.interface]).includes(member))
                    error(`Unknown selected signal: ${selection.interface}.${member}`);
                if (!config.bindings.some(b => b.source.interface === selection.interface && b.source.member === member))
                    error(`Unassigned signal: ${selection.interface}.${member}`);
            }
        for (const binding of config.bindings)
            if (!physicalSelectionMembers(config, binding.source.interface).includes(binding.source.member))
                error(`Signal is not selected: ${binding.source.interface}.${binding.source.member}`);
    }
    try {
        unique(config.railVoltages?.map(s => s.rail) ?? [], 'rail setting');
    }
    catch (e) {
        error(String(e));
    }
    for (const setting of config.railVoltages ?? []) {
        const rail = model.rails?.find(r => r.id === setting.rail);
        if (!Array.isArray(rail?.millivolts) || !rail.millivolts.includes(setting.millivolts))
            error('Invalid selected voltage: ' + setting.rail);
    }
    const usedPins = new Set<string>(), usedPorts = new Set<string>(), resolved = new Map<string, {
        pin: string;
        standard?: string;
        differential?: boolean;
        direction: PhysicalPort['direction'];
        port: string;
    }>();
    const bindings = new Map(config.bindings.map(b => [signalKey(b.source.interface, b.source.member), b]));
    if (bindings.size !== config.bindings.length)
        error('One physical signal is bound more than once');
    if (model.vendor !== 'amd') error('This XDC generator supports AMD devices');
    for (const entry of config.ioStandards ?? [])
        if (!board.definitions[entry.interface] || !physicalMembers(board.definitions[entry.interface]).includes(entry.member))
            error('Unknown IO standard signal: ' + entry.interface + '.' + entry.member);
    for (const binding of config.bindings) {
        const { source } = binding, def = board.definitions[source.interface], port = ports.find(p => p.name === binding.port.name);
        const label = `${source.interface}.${source.member}`;
        if (!def || !physicalMembers(def).includes(source.member)) {
            error('Unknown signal: ' + label);
            continue;
        }
        if (!port || port.unresolved || (port.indices ? !port.indices.includes(binding.port.bit!) : binding.port.bit !== undefined)) {
            error('Unknown port or bit: ' + binding.port.name);
            continue;
        }
        const instance = model.interfaces.find(i => i.id === source.interface)!;
        const role = instance.function ?? Object.keys(def.function ?? {})[0];
        if (def.kind === 'fixed' && memberDirection(def, role, source.member) !== port.direction)
            error('Port direction differs from ' + label);
        const routes = model.routes.filter(r => r.interface === source.interface && r.member === source.member);
        if (routes.length !== 1) {
            error('Missing or ambiguous route for ' + label);
            continue;
        }
        const pin = model.fpgaPins.find(p => p.id === routes[0].pin)!;
        if (pin.reservation === 'forbid')
            error('Reserved pin: ' + pin.id);
        if (pin.reservation === 'warn')
            warn('Reserved pin: ' + pin.id);
        const portTarget = binding.port.name + (binding.port.bit === undefined ? '' : `[${binding.port.bit}]`);
        if (usedPins.has(pin.id))
            error('Pin conflict: ' + pin.id);
        if (usedPorts.has(portTarget))
            error('Port conflict: ' + portTarget);
        usedPins.add(pin.id);
        usedPorts.add(portTarget);
        const differential = def.kind === 'fixed' && physicalPairs(def).some(p => p.positive === source.member || p.negative === source.member);
        if (differential && physicalPairs(def).some(pair => (pair.positive === source.member && /_n$/.test(port.name)) || (pair.negative === source.member && /_p$/.test(port.name))))
            error('Differential port polarity differs: ' + label);
        const standard = config.ioStandards?.find(e => e.interface === source.interface && e.member === source.member)?.standard;
        const options = physicalIoStandards(board, config, source.interface, source.member, port.direction);
        if (!standard) error('Choose IO standard: ' + label);
        else if (!options.some(o => o.name === standard)) error('IO standard is not available for Bank voltage / signal: ' + label + ' (' + standard + ')');
        resolved.set(signalKey(source.interface, source.member), { pin: pin.id, standard,
            differential: options.find(o => o.name === standard)?.differential, direction: port.direction, port: portTarget });
        lines.push(`set_property PACKAGE_PIN ${pin.id} [get_ports {${portTarget}}]`);
        if (standard && standard !== 'GT')
            lines.push(`set_property IOSTANDARD ${standard} [get_ports {${portTarget}}]`);
    }
    for (const instance of model.interfaces) {
        const def = board.definitions[instance.id];
        for (const pair of physicalPairs(def)) {
            const p = resolved.get(signalKey(instance.id, pair.positive)), n = resolved.get(signalKey(instance.id, pair.negative));
            if (!p && !n) continue;
            if (def.kind === 'expansion' && ![p, n].some(endpoint => endpoint?.differential)) continue;
            if (!p || !n || p.standard !== n.standard || p.direction !== n.direction || !model.differentialPairs?.some(pair => pair.positive === p.pin && pair.negative === n.pin))
                error('Incomplete or incorrect differential pair: ' + instance.id + '.' + pair.positive);
        }
        for (const group of def.groups ?? [])
            if (group.selection === 'together') {
                const members = group.members.flatMap(m => physicalSignalMembers(def, m));
                if (members.some(m => bindings.has(signalKey(instance.id, m))) && !members.every(m => bindings.has(signalKey(instance.id, m))))
                    error('Bind the complete group: ' + instance.id + '.' + group.id);
            }
    }
    for (const clock of model.clocks ?? []) {
        const endpoint = resolved.get(signalKey(clock.interface, clock.member));
        if (!endpoint)
            continue;
        if (!Number.isSafeInteger(clock.frequencyHz) || clock.frequencyHz <= 0) {
            error('Invalid board clock frequency');
            continue;
        }
        lines.push(`create_clock -period ${(1e9 / clock.frequencyHz).toFixed(6)} [get_ports {${endpoint.port}}]`);
    }
    return { diagnostics, ...(diagnostics.some(d => d.severity === 'error') ? {} : { text: lines.join('\n') + '\n' }) };
}
