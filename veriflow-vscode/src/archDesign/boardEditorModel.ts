import { createPhysicalBoard, physicalBankType, physicalInterfaceSubset, physicalMembers, physicalPairs, physicalSignalMembers,
    type PhysicalBoardModel, type PhysicalInterface } from '@veriflow/schematic-core/arch-design';
import type { SavedPhysicalBoard } from './physicalBoardLibrary';

export type BoardIssue = { severity: 'error' | 'warning'; message: string; target: string };
export type WiringRow = { interface: string; member: string; pin: string; bank?: string; frequencyHz?: number;
    reservation?: string; references: string[]; direction?: string };
export const wiringTarget = (iface: string, member: string): string => `route:${iface}:${member}`;
export function emptyBoard(): SavedPhysicalBoard {
    return { id: '', name: '', model: { kind: 'board', vendor: '', device: '', fpgaPins: [], interfaces: [], routes: [] }, definitions: {} };
}

/** Use the existing physical validator for templates without duplicating its schema. */
export function validateInterfaceDefinition(value: PhysicalInterface): void {
    if (!value || !Array.isArray(value.signals)) throw new Error('Invalid interface signals');
    for (const width of Object.values(value.bus ?? {}))
        if (!Number.isSafeInteger(width) || width < 1 || width > 4096) throw new Error('Invalid bus width');
    const members = physicalMembers(value);
    if (members.length > 50000) throw new Error('Too many interface members');
    const pins = members.map((_, i) => ({ id: 'P' + i }));
    const pin = (member: string) => pins[members.indexOf(member)]?.id ?? 'UNKNOWN';
    createPhysicalBoard({ kind: 'board', vendor: 'manual', device: 'manual', fpgaPins: pins,
        interfaces: [{ id: 'template', definition: 'template.json', ...(value.kind === 'fixed' ? { function: Object.keys(value.function ?? {})[0] } : {}) }],
        routes: members.map(member => ({ interface: 'template', member, pin: pin(member) })),
    }, { 'template.json': value });
}

export function wiringRows(draft: SavedPhysicalBoard): WiringRow[] {
    const model = draft.model, pins = new Map(model.fpgaPins.map(p => [p.id, p]));
    const routes = new Map(model.routes.map(r => [wiringTarget(r.interface, r.member), r]));
    const references = new Map<string, string[]>();
    for (const route of model.routes) references.set(route.pin, [...(references.get(route.pin) ?? []), `${route.interface}.${route.member}`]);
    return model.interfaces.flatMap(instance => {
        const definition = draft.definitions[instance.definition];
        if (!definition) return [];
        validateInterfaceDefinition(definition);
        const def = physicalInterfaceSubset(definition, instance.signals);
        const role = instance.function ?? Object.keys(def.function ?? {})[0];
        return physicalMembers(def).map(member => {
            const route = routes.get(wiringTarget(instance.id, member)), pin = pins.get(route?.pin ?? '');
            const signal = def.signals.find(s => physicalSignalMembers(def, s).includes(member))!;
            return { interface: instance.id, member, pin: route?.pin ?? '', bank: pin?.bank,
                reservation: pin?.reservation, references: references.get(route?.pin ?? '') ?? [],
                frequencyHz: model.clocks?.find(c => c.interface === instance.id && c.member === member)?.frequencyHz,
                direction: def.function?.[role]?.[signal] };
        });
    });
}

export function inferredBankType(model: PhysicalBoardModel, bank: string): 'hp' | 'hr' | 'hd' | 'gt' | undefined {
    if (model.vendor !== 'amd') return undefined;
    const type = physicalBankType({ model: { ...model, banks: [] }, definitions: {} }, bank);
    return type === 'hp' || type === 'hr' || type === 'hd' || type === 'gt' ? type : undefined;
}

export function inspectBoardDraft(draft: SavedPhysicalBoard): { issues: BoardIssue[]; summary: { interfaces: number; mapped: number; total: number; sharedPins: number; banks: string[] } } {
    const issues: BoardIssue[] = [], model = draft.model;
    const error = (message: string, target: string) => issues.push({ severity: 'error', message, target });
    const warn = (message: string, target: string) => issues.push({ severity: 'warning', message, target });
    if (!/^[A-Za-z0-9_][A-Za-z0-9_.-]*$/.test(draft.id)) error('Enter a valid board ID', 'field:id');
    if (!draft.name.trim()) error('Enter a board name', 'field:name');
    if (!model.vendor) error('Enter a vendor', 'field:vendor');
    if (!model.device.trim()) error('Enter the complete FPGA device model', 'field:device');
    if (!(model.vendor === 'amd' && /^(xc|xa|xq)(au|ku|vu|zu)/i.test(model.device)))
        warn('No constraint generation rules for this device; manual hardware entry is available', 'field:device');
    const usage = new Map<string, Set<string>>(), seen = new Set<string>(), pins = new Map(model.fpgaPins.map(p => [p.id, p]));
    for (const [items, prefix] of [[model.fpgaPins, 'pin:'], [model.banks ?? [], 'bank:'], [model.rails ?? [], 'rail:'], [model.interfaces, 'interface:']] as const) {
        const ids = new Set<string>();
        for (const item of items) {
            if (typeof item.id !== 'string' || !/^[A-Za-z0-9_][A-Za-z0-9_.-]*$/.test(item.id)) error('Invalid ID', prefix + item.id);
            if (ids.has(item.id)) error('Duplicate ID: ' + item.id, prefix + item.id);
            ids.add(item.id);
        }
    }
    for (const rail of model.rails ?? []) {
        if (rail.millivolts === undefined) continue;
        const values = Array.isArray(rail.millivolts) ? rail.millivolts : [rail.millivolts];
        if (!values.length || values.some(v => !Number.isSafeInteger(v) || v <= 0) || new Set(values).size !== values.length)
            error('Enter positive, unique integer voltages in mV', 'rail:' + rail.id);
    }
    for (const pin of model.fpgaPins) if (pin.bank && !model.banks?.some(b => b.id === pin.bank)) error('Unknown Bank: ' + pin.bank, 'pin:' + pin.id);
    for (const bank of model.banks ?? []) if (bank.supplyRail && !model.rails?.some(r => r.id === bank.supplyRail)) error('Unknown supply rail: ' + bank.supplyRail, 'bank:' + bank.id);
    for (const route of model.routes) {
        const target = wiringTarget(route.interface, route.member);
        if (seen.has(target)) error('Duplicate signal mapping', target);
        seen.add(target);
        if (!pins.has(route.pin)) error('Unknown package pin: ' + route.pin, target);
        const refs = usage.get(route.pin) ?? new Set<string>(); refs.add(route.interface); usage.set(route.pin, refs);
        if (model.routes.some(r => r !== route && r.interface === route.interface && r.pin === route.pin && r.member !== route.member))
            error('Duplicate package pin in the same interface: ' + route.pin, target);
        if (pins.get(route.pin)?.reservation) warn('Reserved package pin (' + pins.get(route.pin)!.reservation + '): ' + route.pin, target);
    }
    let rows: WiringRow[] = [];
    try {
        rows = wiringRows(draft);
        for (const row of rows) if (!row.pin) error('No package pin for ' + row.interface + '.' + row.member, wiringTarget(row.interface, row.member));
        for (const instance of model.interfaces) {
            const def = physicalInterfaceSubset(draft.definitions[instance.definition], instance.signals);
            const roles = Object.keys(def.function ?? {});
            if ((def.kind === 'fixed' && (instance.function ? !roles.includes(instance.function) : roles.length !== 1))
                || (def.kind === 'expansion' && instance.function !== undefined)) error('Choose a valid interface role', 'interface:' + instance.id);
            for (const pair of physicalPairs(def)) {
                const p = model.routes.find(r => r.interface === instance.id && r.member === pair.positive);
                const n = model.routes.find(r => r.interface === instance.id && r.member === pair.negative);
                if (p && n && !model.differentialPairs?.some(d => d.positive === p.pin && d.negative === n.pin))
                    error('Differential package pair or polarity mismatch: ' + instance.id + '.' + pair.positive, wiringTarget(instance.id, pair.positive));
            }
        }
        for (const clock of model.clocks ?? []) {
            const row = rows.find(r => r.interface === clock.interface && r.member === clock.member);
            const instance = model.interfaces.find(i => i.id === clock.interface);
            const def = instance && draft.definitions[instance.definition];
            if (!row || row.direction !== 'input' || !Number.isSafeInteger(clock.frequencyHz) || clock.frequencyHz <= 0
                || (def && physicalPairs(def).some(p => p.negative === clock.member)))
                error('Invalid board clock frequency, direction or polarity', wiringTarget(clock.interface, clock.member));
        }
        createPhysicalBoard(model, draft.definitions);
    } catch (cause) {
        error(cause instanceof Error ? cause.message : String(cause), 'interfaces');
    }
    return { issues, summary: { interfaces: model.interfaces.length, mapped: rows.filter(r => r.pin && pins.has(r.pin)).length, total: rows.length,
        sharedPins: [...usage.values()].filter(refs => refs.size > 1).length,
        banks: (model.banks ?? []).map(bank => {
            const voltage = model.rails?.find(r => r.id === bank.supplyRail)?.millivolts;
            return `${bank.id}: ${Array.isArray(voltage) ? voltage.map(v => v / 1000).join('/') : voltage === undefined ? '?' : voltage / 1000} V`;
        }) } };
}

/** Validate the Webview trust boundary before using any draft data. */
export function parseBoardDraft(value: unknown): SavedPhysicalBoard {
    if (!value || typeof value !== 'object' || JSON.stringify(value).length > 8_000_000) throw new Error('Invalid board draft');
    const draft = value as SavedPhysicalBoard;
    if (typeof draft.id !== 'string' || typeof draft.name !== 'string' || !draft.model || draft.model.kind !== 'board'
        || typeof draft.model.vendor !== 'string' || typeof draft.model.device !== 'string' || !draft.definitions
        || typeof draft.definitions !== 'object' || Array.isArray(draft.definitions)) throw new Error('Invalid board draft');
    for (const key of ['fpgaPins', 'interfaces', 'routes', 'banks', 'rails', 'differentialPairs', 'clocks'] as const) {
        const entries = draft.model[key];
        if (entries === undefined && ['banks', 'rails', 'differentialPairs', 'clocks'].includes(key)) continue;
        if (!Array.isArray(entries) || entries.length > 50000 || entries.some(e => !e || typeof e !== 'object' || Array.isArray(e))) throw new Error('Invalid draft ' + key);
    }
    const result = structuredClone(draft);
    for (const key of ['banks', 'rails', 'differentialPairs', 'clocks'] as const) if (!result.model[key]?.length) delete result.model[key];
    return result;
}
