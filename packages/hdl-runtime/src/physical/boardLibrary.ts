import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import * as path from 'node:path';
import { GlobalConfigStore } from '@veriflow/flow-core';
import { createPhysicalBoard, importPhysicalConstraints, parseBoardDraft, inspectBoardDraft, type PhysicalBoard, type PhysicalBoardModel, type SavedPhysicalBoard } from '@veriflow/schematic-core/arch-design';
export type { SavedPhysicalBoard } from '@veriflow/schematic-core/arch-design';
const identifier = /^[A-Za-z0-9_][A-Za-z0-9_.-]*$/;
export async function readPhysicalBoardFile(file: string, onInput?: (file: string, text: string) => void): Promise<{
    model: PhysicalBoardModel;
}> {
    const text = await readFile(file, 'utf8');
    onInput?.(file, text);
    if (path.extname(file).toLowerCase() !== '.json')
        return { model: importPhysicalConstraints(text, path.extname(file)) };
    const input = JSON.parse(text);
    return { model: createPhysicalBoard(input?.model ?? input).model };
}
export class UserPhysicalBoardLibrary {
    private readonly store: GlobalConfigStore;
    private readonly snapshots = new WeakMap<object, string | undefined>();
    readonly configPath: string;
    constructor(options: {
        configPath?: string;
    } = {}) { this.store = new GlobalConfigStore(options); this.configPath = this.store.configPath; }
    private currentText(): string | undefined { try {
        return readFileSync(this.configPath, 'utf8');
    }
    catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'ENOENT')
            throw e;
    } }
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
            // Unpublished old records remain recoverable in the config but cannot be used as raw constraint profiles.
            ids.add(item.id);
            return item as SavedPhysicalBoard;
        });
    }
    list(): SavedPhysicalBoard[] { return structuredClone(this.records(this.config())); }
    get(id: string): SavedPhysicalBoard {
        const saved = this.list().find(b => b.id === id);
        if (!saved) throw new Error('User board not found: ' + id);
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
    async importBoard(file: string, name?: string, requestedId?: string, dryRun = false, kind?: PhysicalBoardModel['kind']): Promise<string> {
        const data = await readPhysicalBoardFile(file);
        if (kind)
            data.model.kind = kind;
        const config = this.config(), records = this.records(config), base = path.basename(file, path.extname(file)).replace(/[^A-Za-z0-9_.-]/g, '_') || 'board';
        let id = requestedId ?? base;
        if (!identifier.test(id))
            throw new Error('Invalid board ID');
        if (requestedId && records.some(b => b.id === id))
            throw new Error('User board already exists: ' + id);
        for (let i = 2; records.some(b => b.id === id); i++)
            id = base + '-' + i;
        config.boards = [...records, { id, name: name?.trim() || base, ...data }];
        if (!dryRun)
            this.saveConfig(config);
        return id;
    }
}
