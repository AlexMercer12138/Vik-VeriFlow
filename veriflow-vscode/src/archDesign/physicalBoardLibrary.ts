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
    createPhysicalBoard(model, definitions);
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
            this.resolve(item); ids.add(item.id);
        }
        return config.boards as SavedPhysicalBoard[];
    }
    private resolve(saved: SavedPhysicalBoard): PhysicalBoard {
        const definitions = { ...saved.definitions };
        for (const instance of saved.model.interfaces) {
            if (!/^library:interfaces\/[A-Za-z0-9_][A-Za-z0-9_.-]*\.json$/.test(instance.definition)) continue;
            definitions[instance.definition] = JSON.parse(readFileSync(path.join(this.options.interfaceRoot, instance.definition.slice('library:interfaces/'.length)), 'utf8'));
        }
        return createPhysicalBoard(saved.model, definitions);
    }
    list(): SavedPhysicalBoard[] { return this.records(this.config()); }
    load(id: string): PhysicalBoard {
        const saved = this.list().find(board => board.id === id);
        if (!saved) throw new Error('User board not found: ' + id);
        return this.resolve(saved);
    }
    ensureFile(): void { this.store.save(this.config()); }
    async importBoard(file: string, name?: string, requestedId?: string): Promise<string> {
        const data = await readPhysicalBoardFile(file, this.options.interfaceRoot);
        data.definitions = Object.fromEntries(Object.entries(data.definitions).filter(([reference]) => !reference.startsWith('library:interfaces/')));
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
