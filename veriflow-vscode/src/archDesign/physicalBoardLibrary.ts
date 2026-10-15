import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import * as path from 'node:path';
import { GlobalConfigStore } from '@veriflow/flow-core';
import { createPhysicalBoard, type PhysicalBoard, type PhysicalBoardModel, type PhysicalInterface } from '@veriflow/schematic-core/arch-design';
import { inspectBoardDraft, parseBoardDraft, validateInterfaceDefinition } from './boardEditorModel';

export type SavedPhysicalBoard = {
    id: string;
    name: string;
    model: PhysicalBoardModel;
    definitions: Record<string, PhysicalInterface>;
};
export type BoardInterfaceTemplate = { reference: string; name: string; definition: PhysicalInterface; user?: boolean };
const identifier = /^[A-Za-z0-9_][A-Za-z0-9_.-]*$/;
export async function readPhysicalBoardFile(file: string, interfaceRoot: string, sources?: (files: string[]) => void): Promise<Omit<SavedPhysicalBoard, 'id' | 'name'>> {
    const input = JSON.parse(await readFile(file, 'utf8'));
    const model = (input?.model ?? input) as PhysicalBoardModel;
    if (!Array.isArray(model?.interfaces)) throw new Error('Board is missing interfaces');
    const definitions: Record<string, PhysicalInterface> = Object.create(null), files = [file];
    for (const instance of model.interfaces) {
        const reference = instance?.definition;
        if (Object.prototype.hasOwnProperty.call(input.definitions ?? {}, reference)) {
            definitions[reference] = input.definitions[reference]; continue;
        }
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
            if (!item || typeof item.id !== 'string' || !identifier.test(item.id) || typeof item.name !== 'string' || !item.name.trim()
                || !item.definitions || typeof item.definitions !== 'object' || Array.isArray(item.definitions) || ids.has(item.id))
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
    private saveConfig(config: Record<string, unknown>): void {
        mkdirSync(path.dirname(this.configPath), { recursive: true });
        const temporary = this.configPath + '.' + randomUUID() + '.tmp';
        writeFileSync(temporary, JSON.stringify(config, null, 2), 'utf8');
        if (existsSync(this.configPath)) copyFileSync(this.configPath, this.configPath + '.bak');
        // Replacement is atomic: a failed write leaves the current configuration intact.
        renameSync(temporary, this.configPath);
    }
    get(id: string): SavedPhysicalBoard {
        const saved = this.list().find(board => board.id === id);
        if (!saved) throw new Error('User board not found: ' + id);
        const result = structuredClone(saved);
        for (const instance of result.model.interfaces) if (instance.definition.startsWith('library:interfaces/'))
            result.definitions[instance.definition] = JSON.parse(readFileSync(path.join(this.options.interfaceRoot, instance.definition.slice('library:interfaces/'.length)), 'utf8'));
        return result;
    }
    saveBoard(value: SavedPhysicalBoard, expected?: SavedPhysicalBoard): void {
        const board = parseBoardDraft(value);
        for (const instance of board.model.interfaces) if (/^library:interfaces\/[A-Za-z0-9_][A-Za-z0-9_.-]*\.json$/.test(instance.definition))
            board.definitions[instance.definition] = JSON.parse(readFileSync(path.join(this.options.interfaceRoot, instance.definition.slice('library:interfaces/'.length)), 'utf8'));
        const issues = inspectBoardDraft(board).issues.filter(i => i.severity === 'error');
        if (issues.length) throw new Error(issues.map(i => i.message).join('\n'));
        const config = this.config(), records = this.records(config), current = records.find(b => b.id === board.id);
        if (current && !expected) throw new Error('User board already exists: ' + board.id);
        if (expected && (!current || expected.id !== board.id || JSON.stringify(this.get(board.id)) !== JSON.stringify(expected)))
            throw new Error('Board changed outside this editor; reopen before saving');
        // Shared built-in interfaces are resolved from the installed catalog; custom definitions remain snapshots.
        board.definitions = Object.fromEntries(Object.entries(board.definitions).filter(([reference]) =>
            board.model.interfaces.some(i => i.definition === reference) && !reference.startsWith('library:interfaces/')));
        config.boards = current ? records.map(item => item.id === board.id ? board : item) : [...records, board];
        this.saveConfig(config);
    }
    deleteBoard(id: string, expected: SavedPhysicalBoard): void {
        const config = this.config(), records = this.records(config);
        if (JSON.stringify(this.get(id)) !== JSON.stringify(expected)) throw new Error('Board changed outside this editor; reopen before deleting');
        config.boards = records.filter(b => b.id !== id);
        this.saveConfig(config);
    }
    templates(): BoardInterfaceTemplate[] {
        const config = this.config();
        if (config.boardInterfaces !== undefined && !Array.isArray(config.boardInterfaces)) throw new Error('Invalid user interface library');
        const user = (config.boardInterfaces ?? []) as { id: string; name: string; definition: PhysicalInterface }[];
        const ids = new Set<string>();
        for (const item of user) {
            if (!item || typeof item.id !== 'string' || !identifier.test(item.id) || typeof item.name !== 'string' || !item.name.trim() || ids.has(item.id)) throw new Error('Invalid user interface template');
            validateInterfaceDefinition(item.definition); ids.add(item.id);
        }
        const builtin = readdirSync(this.options.interfaceRoot).filter(name => /\.(fixed|expansion)\.json$/.test(name)).sort().map(name => ({
            reference: 'library:interfaces/' + name, name: name.replace(/\.(fixed|expansion)\.json$/, ''),
            definition: JSON.parse(readFileSync(path.join(this.options.interfaceRoot, name), 'utf8')) as PhysicalInterface,
        }));
        return [...builtin, ...user.map(item => ({ reference: 'user-interfaces/' + item.id + '.json', name: item.name, definition: item.definition, user: true }))];
    }
    saveTemplate(id: string, name: string, definition: PhysicalInterface): void {
        if (!identifier.test(id) || !name.trim()) throw new Error('Enter a valid template ID and name');
        validateInterfaceDefinition(definition);
        this.templates();
        const config = this.config(), items = (config.boardInterfaces ?? []) as { id: string; name: string; definition: PhysicalInterface }[];
        config.boardInterfaces = [...items.filter(item => item.id !== id), { id, name: name.trim(), definition }];
        this.saveConfig(config);
    }
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
        this.saveConfig(config);
        return id;
    }
}
