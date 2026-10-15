import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import * as path from 'node:path';
import { GlobalConfigStore } from '@veriflow/flow-core';
import { createPhysicalBoard, type PhysicalBoard, type PhysicalBoardModel, type PhysicalInterface } from '@veriflow/schematic-core/arch-design';

export type SavedPhysicalBoard = {
    id: string;
    name: string;
    model: PhysicalBoardModel;
    definitions: Record<string, PhysicalInterface>;
};
const identifier = /^[A-Za-z0-9_][A-Za-z0-9_.-]*$/;
export function verifiedPhysicalBoard(model: unknown, definitions: Record<string, unknown>): PhysicalBoard {
    const board = createPhysicalBoard(model, definitions);
    // Include resolved definitions, so moving files preserves the verified hardware identity.
    const hardware = { ...board.model, interfaces: board.model.interfaces.map(instance => ({ ...instance, definition: definitions[instance.definition] })) };
    const canonical = JSON.stringify(hardware, (_key, item) => item && typeof item === 'object' && !Array.isArray(item)
        ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
    if (createHash('sha256').update(canonical).digest('hex') === '152e79899337f2d5e1566e4953f8ec835410dd225daed97e82d1519a71314f94') board.profile = 'atk-au15p';
    return board;
}
export async function readPhysicalBoardFile(file: string, interfaceRoot: string, sources?: (files: string[]) => void): Promise<Omit<SavedPhysicalBoard, 'id' | 'name'>> {
    const model = JSON.parse(await readFile(file, 'utf8')) as PhysicalBoardModel;
    if (!Array.isArray(model?.interfaces)) throw new Error('Board is missing interfaces');
    const definitions: Record<string, PhysicalInterface> = Object.create(null), files = [file];
    for (const instance of model.interfaces) {
        const reference = instance?.definition;
        let target: string;
        if (typeof reference === 'string' && /^library:interfaces\/[A-Za-z0-9_][A-Za-z0-9_.-]*\.json$/.test(reference))
            target = path.join(interfaceRoot, reference.slice('library:interfaces/'.length));
        else if (typeof reference === 'string' && /^(?![A-Za-z][A-Za-z0-9+.-]*:)(?![/\\])(?!.*[\r\n\0]).+$/.test(reference))
            target = path.resolve(path.dirname(file), reference);
        else throw new Error('Interface definition must use a relative path or library:interfaces/<file>.json');
        files.push(target); sources?.(files);
        definitions[reference] = JSON.parse(await readFile(target, 'utf8'));
    }
    verifiedPhysicalBoard(model, definitions);
    return { model, definitions };
}
export class UserPhysicalBoardLibrary {
    private readonly store: GlobalConfigStore;
    readonly configPath: string;
    constructor(private readonly options: { interfaceRoot: string; configPath?: string }) {
        this.store = new GlobalConfigStore({ configPath: options.configPath });
        this.configPath = this.store.configPath;
    }
    private config(): Record<string, unknown> {
        // GlobalConfigStore falls back on malformed JSON; importing must preserve a broken file for repair.
        try {
            const value = JSON.parse(readFileSync(this.configPath, 'utf8'));
            if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('User config must be a JSON object');
        } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
        return this.store.load();
    }
    private records(config: Record<string, unknown>): SavedPhysicalBoard[] {
        if (config.boards === undefined) return [];
        if (!Array.isArray(config.boards)) throw new Error('User config boards must be an array');
        const ids = new Set<string>();
        for (const item of config.boards) {
            if (!item || typeof item.id !== 'string' || !identifier.test(item.id) || typeof item.name !== 'string' || !item.name.trim() || !item.definitions || ids.has(item.id))
                throw new Error('Invalid or duplicate saved board');
            verifiedPhysicalBoard(item.model, item.definitions); ids.add(item.id);
        }
        return config.boards as SavedPhysicalBoard[];
    }
    list(): SavedPhysicalBoard[] { return this.records(this.config()); }
    load(id: string): PhysicalBoard {
        const saved = this.list().find(board => board.id === id);
        if (!saved) throw new Error('User board not found: ' + id);
        return verifiedPhysicalBoard(saved.model, saved.definitions);
    }
    ensureFile(): void { this.store.save(this.config()); }
    async importBoard(file: string, name?: string, requestedId?: string): Promise<string> {
        const data = await readPhysicalBoardFile(file, this.options.interfaceRoot);
        const config = this.config(), records = this.records(config);
        const stem = path.basename(file, '.json'), base = stem === 'board' ? path.basename(path.dirname(file)) : stem;
        const candidate = base.replace(/[^A-Za-z0-9_.-]/g, '_') || 'board';
        let id = requestedId ?? candidate;
        if (!identifier.test(id)) throw new Error('Invalid saved board ID');
        if (requestedId && records.some(r => r.id === id)) throw new Error('User board already exists: ' + id);
        for (let i = 2; records.some(r => r.id === id); i++) id = `${candidate}-${i}`;
        config.boards = [...records, { id, name: name?.trim() || base, ...data }];
        this.store.save(config);
        return id;
    }
}
