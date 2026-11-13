import { createPhysicalBoard, physicalPins, type PhysicalBoardModel } from './physicalPins';
export type SavedPhysicalBoard = {
    id: string;
    name: string;
    model: PhysicalBoardModel;
};
export type BoardIssue = {
    severity: 'error' | 'warning';
    message: string;
    target: string;
};
export function emptyBoard(): SavedPhysicalBoard { return { id: '', name: '', model: { kind: 'board', extension: '.xdc', pins: {}, interfaces: [] } }; }
export function parseBoardDraft(value: unknown): SavedPhysicalBoard {
    if (!value || typeof value !== 'object')
        throw new Error('Invalid board profile');
    const draft = value as SavedPhysicalBoard;
    if (typeof draft.id !== 'string' || typeof draft.name !== 'string')
        throw new Error('Invalid board identity');
    const model = draft.model;
    if (!model || typeof model !== 'object' || !model.pins || typeof model.pins !== 'object' || Array.isArray(model.pins) || Object.values(model.pins).some(t => typeof t !== 'string') || typeof model.extension !== 'string'
        || !['board', 'daughtercard'].includes(model.kind) || !Array.isArray(model.interfaces))
        throw new Error('Invalid board pin templates');
    for (const iface of model.interfaces) {
        if (!iface || typeof iface.id !== 'string' || !Array.isArray(iface.signals))
            throw new Error('Invalid interface draft');
        for (const signal of iface.signals)
            if (!signal || typeof signal.id !== 'string' || !['input', 'output', 'inout'].includes(signal.direction)
                || !Array.isArray(signal.pins) || signal.pins.length > 4096 || signal.pins.some(pin => typeof pin !== 'string'))
                throw new Error('Invalid signal draft');
    }
    return JSON.parse(JSON.stringify({ id: draft.id, name: draft.name, model }));
}
export function inspectBoardDraft(draft: SavedPhysicalBoard): {
    issues: BoardIssue[];
    summary: {
        interfaces: number;
        pins: number;
    };
} {
    const issues: BoardIssue[] = [], error = (message: string, target = 'interfaces') => { issues.push({ severity: 'error', message, target }); };
    if (!/^[A-Za-z0-9_][A-Za-z0-9_.-]*$/.test(draft.id))
        error('Invalid board identity', 'id');
    if (!draft.name.trim())
        error('Enter a name', 'name');
    try {
        createPhysicalBoard(draft.model);
    }
    catch (e) {
        error((e as Error).message);
    }
    const pins = physicalPins(draft.model);
    const pinNames = new Set(pins);
    for (const iface of draft.model.interfaces)
        for (const signal of iface.signals)
            if (signal.pins.some(p => !pinNames.has(p)))
                error('Select each pin for ' + iface.id + '.' + signal.id);
    return { issues, summary: { interfaces: draft.model.interfaces.length, pins: pins.length } };
}
