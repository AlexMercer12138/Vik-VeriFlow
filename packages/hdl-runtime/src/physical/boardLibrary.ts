import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import * as path from 'node:path';
import { GlobalConfigStore } from '@veriflow/flow-core';
import { createPhysicalBoard, parseBoardDraft, inspectBoardDraft, type PhysicalBoard, type PhysicalBoardModel, type SavedPhysicalBoard } from '@veriflow/schematic-core/arch-design';
export type { SavedPhysicalBoard } from '@veriflow/schematic-core/arch-design';
const identifier = /^[A-Za-z0-9_][A-Za-z0-9_.-]*$/;
export function physicalBoardFile(board: SavedPhysicalBoard): Record<string, unknown> {
    return { id: board.id, name: board.name, ...board.model };
}
export async function readPhysicalBoardFile(file: string, onInput?: (file: string, text: string) => void): Promise<SavedPhysicalBoard> {
    if (path.extname(file).toLowerCase() !== '.json')
        throw new Error('Import board accepts board JSON files only');
    const text = await readFile(file, 'utf8');
    onInput?.(file, text);
    const value = JSON.parse(text);
    if (!value || typeof value !== 'object' || Array.isArray(value))
        throw new Error('Invalid board file');
    const { id, name, ...model } = value;
    if (typeof id !== 'string' || !identifier.test(id) || typeof name !== 'string' || !name.trim())
        throw new Error('Invalid board identity');
    return parseBoardDraft({ id, name, model: createPhysicalBoard(model).model });
}
export function newPhysicalBoard(name: string, kind: PhysicalBoardModel['kind'], extension: string): SavedPhysicalBoard {
    return { id: randomUUID(), name: name.trim(), model: createPhysicalBoard({ kind, extension, pins: {}, interfaces: [] }).model };
}
export class UserPhysicalBoardLibrary {
    private readonly store: GlobalConfigStore;
    private readonly snapshots = new WeakMap<object, string | undefined>();
    readonly configPath: string;
    constructor(options: {
        configPath?: string;
    } = {}) { this.store = new GlobalConfigStore(options); this.configPath = this.store.configPath; }
    private currentText(): string | undefined {
        try {
            return readFileSync(this.configPath, 'utf8');
        }
        catch (e) {
            if ((e as NodeJS.ErrnoException).code !== 'ENOENT')
                throw e;
        }
    }
    private config(): Record<string, unknown> {
        const text = this.currentText();
        if (text !== undefined) {
            const value = JSON.parse(text);
            if (!value || typeof value !== 'object' || Array.isArray(value))
                throw new Error('User config must be an object');
        }
        const config = this.store.load();
        if (this.currentText() !== text)
            throw new Error('User configuration changed while loading; retry');
        this.snapshots.set(config, text);
        return config;
    }
    private records(config: Record<string, unknown>): SavedPhysicalBoard[] {
        if (config.boards === undefined)
            return [];
        if (!Array.isArray(config.boards))
            throw new Error('User config boards must be an array');
        const ids = new Set<string>();
        return config.boards.map(item => {
            if (!item || typeof item.id !== 'string' || !identifier.test(item.id) || typeof item.name !== 'string' || !item.name.trim()
                || !item.model || typeof item.model !== 'object' || ids.has(item.id))
                throw new Error('Invalid or duplicate board');
            ids.add(item.id);
            return item as SavedPhysicalBoard;
        });
    }
    list(): SavedPhysicalBoard[] { return structuredClone(this.records(this.config())); }
    get(id: string): SavedPhysicalBoard {
        const saved = this.list().find(b => b.id === id);
        if (!saved)
            throw new Error('User board not found: ' + id);
        return { id: saved.id, name: saved.name, model: createPhysicalBoard(saved.model).model };
    }
    load(id: string, onInput?: (file: string, text: string) => void): PhysicalBoard {
        const config = this.config(), text = this.snapshots.get(config);
        if (text !== undefined)
            onInput?.(this.configPath, text);
        const saved = this.records(config).find(b => b.id === id);
        if (!saved)
            throw new Error('User board not found: ' + id);
        return createPhysicalBoard(saved.model);
    }
    private saveConfig(config: Record<string, unknown>): void {
        mkdirSync(path.dirname(this.configPath), { recursive: true });
        const temporary = this.configPath + '.' + randomUUID() + '.tmp';
        writeFileSync(temporary, JSON.stringify(config, null, 2), 'utf8');
        try {
            if (this.currentText() !== this.snapshots.get(config))
                throw new Error('User configuration changed before saving; retry');
            if (existsSync(this.configPath))
                copyFileSync(this.configPath, this.configPath + '.bak');
            renameSync(temporary, this.configPath);
        }
        finally {
            if (existsSync(temporary))
                unlinkSync(temporary);
        }
    }
    saveBoard(value: SavedPhysicalBoard, expected?: SavedPhysicalBoard): void {
        const board = parseBoardDraft(value), issues = inspectBoardDraft(board).issues.filter(i => i.severity === 'error');
        if (issues.length)
            throw new Error(issues.map(i => i.message).join('\n'));
        const config = this.config(), records = this.records(config), current = records.find(b => b.id === board.id);
        if (current && !expected)
            throw new Error('User board already exists: ' + board.id);
        if (expected && (!current || JSON.stringify(current) !== JSON.stringify(expected)))
            throw new Error('Board changed outside this editor; reopen before saving');
        config.boards = current ? records.map(b => b.id === board.id ? board : b) : [...records, board];
        this.saveConfig(config);
    }
    deleteBoard(id: string, expected: SavedPhysicalBoard): void {
        const config = this.config(), records = this.records(config), current = records.find(b => b.id === id);
        if (!current || JSON.stringify(current) !== JSON.stringify(expected))
            throw new Error('Board changed outside this editor; reopen before deleting');
        config.boards = records.filter(b => b.id !== id);
        this.saveConfig(config);
    }
    async importBoard(file: string, name?: string, requestedId?: string, dryRun = false): Promise<string> {
        const value = await readPhysicalBoardFile(file);
        if (name)
            value.name = name.trim();
        if (requestedId)
            value.id = requestedId;
        const issues = inspectBoardDraft(value).issues.filter(i => i.severity === 'error');
        if (issues.length)
            throw new Error(issues.map(i => i.message).join('\n'));
        if (this.list().some(b => b.id === value.id))
            throw new Error('User board already exists: ' + value.name);
        if (!dryRun)
            this.saveBoard(value);
        return value.id;
    }
}
