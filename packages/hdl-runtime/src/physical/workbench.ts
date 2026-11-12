import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { bindPhysicalSignal, generateConstraints, inspectBoardDraft, parseBoardDraft, parsePhysicalConfiguration, physicalSignalMembers, type PhysicalBoard, type PhysicalConfiguration, type PhysicalPort, type SavedPhysicalBoard } from '@veriflow/schematic-core/arch-design';
import { checkArtifactPlan, publishArtifactPlan, publishGeneratedFile, type ArtifactPlan } from '../archDesign';
import { constraintArtifacts } from './constraintArtifacts';
import { resolvePhysicalConfiguration } from './resolveBoard';
import { newPhysicalBoard, physicalBoardFile, readPhysicalBoardFile, UserPhysicalBoardLibrary } from './boardLibrary';
export type ConstraintSource = {
    path: string;
    text: string;
    module: string;
    ports: readonly PhysicalPort[];
    isAd: boolean;
    configuration?: PhysicalConfiguration;
    configurationPath: string;
    configurationText?: string;
    output?: string;
    outputStem?: string;
    inputs: ArtifactPlan['inputs'];
};
export type ConstraintWorkbenchServices = {
    library: UserPhysicalBoardLibrary;
    source(file: string): Promise<ConstraintSource>;
    saveAd(source: ConstraintSource, config: PhysicalConfiguration): Promise<ConstraintSource>;
    openFile(kind: 'board' | 'source' | 'bindings'): Promise<string | undefined>;
    saveFile(kind: 'board' | 'constraints' | 'bindings', suggestion: string): Promise<string | undefined>;
    confirmDelete(name: string): Promise<boolean>;
    persist?(snapshot: unknown): Promise<void>;
};
type Draft = {
    value: SavedPhysicalBoard;
    expected?: SavedPhysicalBoard;
    undo: SavedPhysicalBoard[];
    redo: SavedPhysicalBoard[];
};
type BindingDraft = {
    source: ConstraintSource;
    config: PhysicalConfiguration;
    active: string[];
    saved: string;
};
const key = (card: string | undefined, iface: string, signal: string) => JSON.stringify([card ?? '', iface, signal]);
/** Shared state machine. Hosts only provide document, dialog, and recovery storage operations. */
export class ConstraintWorkbench {
    page: 'library' | 'bindings' = 'library';
    private drafts = new Map<string, Draft>();
    private bindings = new Map<string, BindingDraft>();
    private currentBoard?: string;
    private currentSource?: string;
    private readonly publishedBoards = new Map<string, string>();
    private error = '';
    private notice = '';
    private revision = 0;
    private tail = Promise.resolve();
    constructor(readonly services: ConstraintWorkbenchServices, private readonly send: (message: unknown) => void) { }
    restore(value: unknown): void {
        try {
            const record = value as {
                drafts?: Draft[];
                bindings?: BindingDraft[];
                board?: string;
                source?: string;
                page?: string;
            };
            for (const draft of record?.drafts ?? []) {
                try {
                    const parsed = parseBoardDraft(draft.value);
                    if (!['board', 'daughtercard'].includes(parsed.model.kind)) continue;
                    this.drafts.set(parsed.id, { value: parsed, expected: draft.expected, undo: [], redo: [] });
                } catch { /* Ignore obsolete unpublished recovery drafts. */ }
            }
            for (const draft of record?.bindings ?? []) {
                if (!draft.source || typeof draft.source.path !== 'string' || !Array.isArray(draft.source.ports))
                    continue;
                const config = draft.config.board ? parsePhysicalConfiguration(draft.config) : { board: '', bindings: [] };
                this.bindings.set(draft.source.path, { ...draft, config, active: Array.isArray(draft.active) ? draft.active : [] });
            }
            this.currentBoard = record?.board && this.drafts.has(record.board) ? record.board : undefined;
            this.currentSource = record?.source;
            this.page = record?.page === 'bindings' ? 'bindings' : 'library';
        }
        catch { /* A malformed recovery snapshot must not block the workbench. */ }
    }
    snapshot(): unknown { return { drafts: [...this.drafts.values()].map(d => ({ value: d.value, expected: d.expected })), bindings: [...this.bindings.values()], board: this.currentBoard, source: this.currentSource, page: this.page }; }
    open(file?: string): Promise<void> {
        const operation=this.tail.then(()=>this.openContext(file));
        this.tail=operation.catch(()=>undefined);
        return operation;
    }
    private async openContext(file?: string): Promise<void> {
        this.services.library.cleanInvalidBoards();
        if (file) {
            file = path.resolve(file);
            if (!this.bindings.has(file)) {
                const source = await this.services.source(file), config = source.configuration ? parsePhysicalConfiguration(source.configuration) : { board: '', bindings: [] };
                this.bindings.set(file, { source, config, active: [], saved: JSON.stringify(config) });
            }
            else await this.refreshSource(this.bindings.get(file)!);
            this.currentSource = file;
            this.page = 'bindings';
        }
        else
            this.page = 'library';
        await this.services.persist?.(this.snapshot());
        await this.publish();
    }
    dispatch(message: unknown): Promise<void> {
        this.tail = this.tail.then(async () => {
            const command = message as Record<string, any>;
            if (!command || typeof command.type !== 'string')
                return;
            this.error = '';
            this.notice = '';
            if (command.type === 'ready') {
                this.services.library.cleanInvalidBoards();
                if (this.binding) await this.refreshSource(this.binding);
            }
            if (command.type !== 'ready')
                await this.command(command);
            await this.services.persist?.(this.snapshot());
            await this.publish(command.type, command.editId);
        }).catch(async (e) => { this.error = e instanceof Error ? e.message : String(e); await this.publish(); });
        return this.tail;
    }
    private get draft(): Draft | undefined { return this.currentBoard ? this.drafts.get(this.currentBoard) : undefined; }
    private get binding(): BindingDraft | undefined { return this.currentSource ? this.bindings.get(this.currentSource) : undefined; }
    private async refreshSource(state: BindingDraft): Promise<void> {
        const next = await this.services.source(state.source.path);
        state.source = { ...next, configurationPath: state.source.configurationPath, configurationText: state.source.configurationText };
    }
    private async board(config: BindingDraft, inputs: ArtifactPlan['inputs'] = []): Promise<PhysicalBoard | undefined> {
        return config.config.board ? resolvePhysicalConfiguration(config.source.configurationPath, config.config, { library: this.services.library, onInput: (file, text) => inputs.push({ path: file, text }) }) : undefined;
    }
    private selectBoard(id: string): void {
        if (!this.drafts.has(id)) {
            const saved = this.services.library.get(id);
            this.drafts.set(id, { value: saved, expected: structuredClone(saved), undo: [], redo: [] });
        }
        this.currentBoard = id;
    }
    private replace(value: unknown): void {
        const draft = this.draft;
        if (!draft)
            throw new Error('Select a board');
        const next = parseBoardDraft(value);
        if (next.id !== draft.value.id)
            throw new Error('Board identity cannot be edited');
        if (JSON.stringify(next) === JSON.stringify(draft.value))
            return;
        draft.undo.push(structuredClone(draft.value));
        if (draft.undo.length > 100)
            draft.undo.shift();
        draft.redo = [];
        draft.value = next;
    }
    private async command(c: Record<string, any>): Promise<void> {
        const library = this.services.library;
        if (c.type === 'page') {
            if (c.page === 'bindings' && this.page !== 'bindings' && this.binding) await this.refreshSource(this.binding);
            this.page = c.page === 'bindings' ? 'bindings' : 'library';
            return;
        }
        if (c.type === 'board-open') {
            this.selectBoard(String(c.id));
            this.page = 'library';
            return;
        }
        if (c.type === 'board-new') {
            if(typeof c.name!=='string'||!c.name.trim())throw new Error('Enter a board name');
            const value = newPhysicalBoard(String(c.name ?? ''), c.kind, c.extension);
            this.drafts.set(value.id, { value, undo: [], redo: [] });
            this.currentBoard = value.id;
            this.page = 'library';
            return;
        }
        if (c.type === 'board-change') {
            this.replace(c.draft);
            return;
        }
        if (c.type === 'board-import') {
            const file = await this.services.openFile('board');
            if (!file)
                return;
            const value = await readPhysicalBoardFile(file), current = library.list().find(b => b.id === value.id);
            if (current && JSON.stringify(current) !== JSON.stringify(value))
                throw new Error('A different board with this identity already exists. Duplicate it before importing changes.');
            if (current)
                this.selectBoard(current.id);
            else {
                this.drafts.set(value.id, { value, undo: [], redo: [] });
                this.currentBoard = value.id;
            }
            this.page = 'library';
            return;
        }
        if (c.type.startsWith('board-')) {
            const d = this.draft;
            if (!d)
                throw new Error('Select a board');
            if (c.type === 'board-save') {
                library.saveBoard(d.value, d.expected);
                d.value = library.get(d.value.id);
                d.expected = structuredClone(d.value);
                this.notice = 'Board saved';
            }
            if (c.type === 'board-copy') {
                const value = { ...structuredClone(d.value), id: randomUUID(), name: d.value.name + ' copy' };
                this.drafts.set(value.id, { value, undo: [], redo: [] });
                this.currentBoard = value.id;
            }
            if (c.type === 'board-discard') {
                if (d.expected) {
                    d.value = library.get(d.expected.id);
                    d.expected = structuredClone(d.value);
                }
                else
                    d.value = { id: d.value.id, name: d.value.name, model: { kind: d.value.model.kind, extension: d.value.model.extension, pins: {}, interfaces: [] } };
                d.undo = [];
                d.redo = [];
            }
            if (c.type === 'board-undo' || c.type === 'board-redo') {
                const from = c.type === 'board-undo' ? d.undo : d.redo, to = c.type === 'board-undo' ? d.redo : d.undo, next = from.pop();
                if (next) {
                    to.push(d.value);
                    d.value = next;
                }
            }
            if (c.type === 'board-export') {
                const issues = inspectBoardDraft(d.value).issues.filter(i => i.severity === 'error');
                if (issues.length)
                    throw new Error(issues.map(i => i.message).join('\n'));
                const file = await this.services.saveFile('board', d.value.name + '.board.json');
                if (file)
                    await publishGeneratedFile(file, JSON.stringify(physicalBoardFile(d.value), null, 2) + '\n', {}, () => true);
            }
            if (c.type === 'board-delete') {
                if (!d.expected) {
                    this.drafts.delete(d.value.id);
                    this.currentBoard = undefined;
                    return;
                }
                if (await this.services.confirmDelete(d.value.name)) {
                    library.deleteBoard(d.value.id, d.expected);
                    this.drafts.delete(d.value.id);
                    this.currentBoard = undefined;
                }
            }
            if (c.type === 'board-use') {
                if (!this.binding)
                    throw new Error('Open a HDL or AD file first');
                if (d.value.model.kind !== 'board')
                    throw new Error('Add this daughtercard from the binding page');
                if (!d.expected || JSON.stringify(d.expected) !== JSON.stringify(d.value))
                    throw new Error('Save this board before using it');
                await this.changeBoard('user:' + d.value.id);
                this.page = 'bindings';
            }
            return;
        }
        if (c.type === 'source-open') {
            const file = await this.services.openFile('source');
            if (file)
                await this.openContext(file);
            return;
        }
        const state = this.binding;
        if (c.type === 'source-refresh' && !state) return;
        if (!state)
            throw new Error('Open a HDL or AD file first');
        if(c.sourcePath!==undefined&&c.sourcePath!==state.source.path)throw new Error('The current file changed; retry in its binding page');
        if (c.type === 'choose-board') {
            await this.changeBoard(String(c.board));
            return;
        }
        if (c.type === 'source-refresh') {
            await this.refreshSource(state);
            this.notice = 'Source refreshed; existing bindings retained';
            return;
        }
        if (c.type === 'bindings-load') {
            if (state.source.isAd)
                throw new Error('AD bindings are saved in the document');
            const file = await this.services.openFile('bindings');
            if (file) {
                const text = await readFile(file, 'utf8');
                state.config = parsePhysicalConfiguration(JSON.parse(text));
                state.source.configurationPath = file;
                state.source.configurationText = text;
                state.saved = JSON.stringify(state.config);
                state.active = [];
            }
            return;
        }
        if (c.type === 'add-card') {
            if (!state.config.board)
                throw new Error('Choose a main board first');
            const value = library.get(String(c.id));
            if (value.model.kind !== 'daughtercard')
                throw new Error('Choose a daughtercard');
            state.config = parsePhysicalConfiguration({ ...state.config, cards: [...state.config.cards ?? [], { id: randomUUID(), board: 'user:' + value.id }] });
            return;
        }
        if (c.type === 'remove-card') {
            state.config = { ...state.config, cards: state.config.cards?.filter(card => card.id !== c.card), bindings: state.config.bindings.filter(b => b.source.card !== c.card) };
            return;
        }
        if (c.type === 'select') {
            const changes = c.changes ?? [c];
            if (!Array.isArray(changes) || changes.length > 50000) throw new Error('Invalid signal selection');
            const board = await this.board(state), active = new Set(state.active), removed = new Set<string>();
            for (const change of changes) {
                const iface = (change.card ? board?.cards?.[change.card] : board?.model)?.interfaces.find(i => i.id === change.interface);
                if (!iface?.signals.some(signal => signal.id === change.signal) || typeof change.checked !== 'boolean') throw new Error('Unknown interface signal');
                const k = key(change.card, change.interface, change.signal);
                if (change.checked) active.add(k);
                else {
                    active.delete(k);
                    for (const member of physicalSignalMembers(iface, change.signal)) removed.add(key(change.card, change.interface, member));
                }
            }
            state.active = [...active];
            if (removed.size) state.config = { ...state.config, bindings: state.config.bindings.filter(b => !removed.has(key(b.source.card, b.source.interface, b.source.member))) };
            return;
        }
        if (c.type === 'bind') {
            const board = await this.board(state);
            if (!board)
                throw new Error('Choose a board');
            const iface = (c.card ? board.cards?.[c.card] : board.model)?.interfaces.find(i => i.id === c.interface);
            if (!iface)
                throw new Error('Unknown interface');
            const members = physicalSignalMembers(iface, c.signal), previous = state.config.bindings.filter(b => b.source.card === c.card && b.source.interface === c.interface && members.includes(b.source.member));
            const keep = state.config.bindings.filter(b => !previous.includes(b));
            const selection = c.ports ?? c.port;
            const next = selection && (!Array.isArray(selection) || selection.length) ? bindPhysicalSignal(board, state.source.ports, c.interface, c.signal, selection, c.card).map(b => ({ ...b, ...(previous.find(p => p.source.member === b.source.member)?.pin ? { pin: previous.find(p => p.source.member === b.source.member)!.pin } : {}) })) : [];
            if (next.some(b => keep.some(k => k.port.name === b.port.name && k.port.bit === b.port.bit)))
                throw new Error('This port is already assigned');
            state.config = { ...state.config, bindings: [...keep, ...next] };
            if (next.length && !state.active.includes(key(c.card, c.interface, c.signal)))
                state.active.push(key(c.card, c.interface, c.signal));
            return;
        }
        if (c.type === 'pin') {
            if (typeof c.pin !== 'string' || /[\r\n\0]/.test(c.pin))
                throw new Error('Invalid FPGA pin');
            state.config = parsePhysicalConfiguration({ ...state.config, bindings: state.config.bindings.map(b => b.source.card === c.card && b.source.interface === c.interface && b.source.member === c.member ? { ...b, pin: c.pin } : b) });
            return;
        }
        if (c.type === 'bindings-save') {
            await this.saveBindings(state, !!c.saveAs);
            this.notice = 'Bindings saved';
            return;
        }
        if (c.type === 'export') {
            const fresh = await this.services.source(state.source.path);
            if (fresh.text !== state.source.text || !sameInputs(fresh.inputs, state.source.inputs))
                throw new Error('Source changed. Refresh before exporting');
            const inputs = [...fresh.inputs], board = await this.board(state, inputs);
            if (!board)
                throw new Error('Choose a board');
            if (this.publishedBoards.get(state.source.path) !== JSON.stringify(board))
                throw new Error('Board templates changed. Review the refreshed preview before exporting');
            const generated = generateConstraints(board, state.config, state.source.ports);
            if (generated.text === undefined)
                throw new Error(generated.diagnostics.map(d => d.message).join('\n'));
            if (!state.config.bindings.length)
                throw new Error('Assign signals first');
            const missing = this.missingSelected(state, board);
            if (missing.length)
                throw new Error('Assign selected signal: ' + missing.join(', '));
            const output = await this.services.saveFile('constraints', this.outputPath(state, board.model.extension));
            if (!output)
                return;
            if (path.extname(output) !== board.model.extension)
                throw new Error('Output must use ' + board.model.extension);
            const artifacts = await constraintArtifacts(state.source.path, output, generated.text);
            await checkArtifactPlan({ inputs, diagnostics: [], artifacts });
            await this.saveBindings(state);
            const current = await this.services.source(state.source.path);
            if (current.text !== state.source.text)
                throw new Error('Source changed during export');
            await publishArtifactPlan({ inputs: [...current.inputs, ...inputs.filter(i => i.path !== state.source.path), ...(!state.source.isAd && state.source.configurationText !== undefined ? [{ path: state.source.configurationPath, text: state.source.configurationText }] : [])], diagnostics: [], artifacts });
            this.notice = 'Constraints exported';
            return;
        }
    }
    private async changeBoard(reference: string): Promise<void> { const b = this.binding!; const next = { board: reference, bindings: [] }; const board = await resolvePhysicalConfiguration(b.source.configurationPath, next, { library: this.services.library }); if (board.model.kind !== 'board')
        throw new Error('Choose a main board'); b.config = next; b.active = []; }
    private outputPath(b: BindingDraft, extension: string): string { return b.source.output ?? (b.source.outputStem ?? b.source.path.slice(0, -path.extname(b.source.path).length)) + extension; }
    private missingSelected(b: BindingDraft, board: PhysicalBoard): string[] { return [{ model: board.model, card: undefined as string | undefined }, ...Object.entries(board.cards ?? {}).map(([card, model]) => ({ card, model }))].flatMap(({ model, card }) => model.interfaces.flatMap(iface => iface.signals.filter(signal => b.active.includes(key(card, iface.id, signal.id)) && physicalSignalMembers(iface, signal.id).some(member => !b.config.bindings.some(v => v.source.card === card && v.source.interface === iface.id && v.source.member === member))).map(signal => iface.id + '.' + signal.id))); }
    private async saveBindings(b: BindingDraft, saveAs = false): Promise<void> {
        if (!b.config.board)
            throw new Error('Choose a board');
        const fresh = await this.services.source(b.source.path);
        if (fresh.text !== b.source.text || !sameInputs(fresh.inputs,b.source.inputs))
            throw new Error('Source changed. Refresh before saving');
        if (b.source.isAd)
            b.source = await this.services.saveAd(b.source, b.config);
        else {
            const file = saveAs ? await this.services.saveFile('bindings', b.source.configurationPath) : b.source.configurationPath;
            if (!file)
                return;
            const rebase = (ref: string) => ref.startsWith('user:') ? ref : path.relative(path.dirname(file), path.resolve(path.dirname(b.source.configurationPath), ref)).replace(/\\/g, '/');
            const config = { ...b.config, board: rebase(b.config.board), ...(b.config.cards ? { cards: b.config.cards.map(c => ({ ...c, board: rebase(c.board) })) } : {}) };
            const text = JSON.stringify(config, null, 2) + '\n';
            await publishGeneratedFile(file, text, {}, old => file === b.source.configurationPath && old === b.source.configurationText);
            b.config = config;
            b.source = { ...b.source, configurationPath: file, configurationText: text };
        }
        b.saved = JSON.stringify(b.config);
    }
    close():Promise<void>{return this.tail;}
    async publish(reason?: string, editId?: number): Promise<void> {
        const boards = this.services.library.list();
        if (this.currentBoard && !this.drafts.has(this.currentBoard) && !boards.some(board => board.id === this.currentBoard))
            this.currentBoard = undefined;
        if (!this.currentBoard && boards.length) {
            this.selectBoard(boards[0].id);
        }
        const b = this.binding;
        let board: PhysicalBoard | undefined, diagnostics: {
            severity: string;
            message: string;
        }[] = [], preview = '';
        try {
            if (b) {
                board = await this.board(b);
                if (board) {
                    const generated = generateConstraints(board, b.config, b.source.ports);
                    preview = generated.text ?? '';
                    diagnostics = generated.diagnostics;
                }
            }
        }
        catch (e) {
            diagnostics.push({ severity: 'error', message: (e as Error).message });
        }
        const interfaces = board ? [...board.model.interfaces.map(i => ({ ...i, card: undefined as string | undefined })), ...Object.entries(board.cards ?? {}).flatMap(([card, model]) => model.interfaces.map(i => ({ ...i, card })))] : [];
        if (b)
            for (const iface of interfaces)
                for (const signal of iface.signals) {
                    const members = physicalSignalMembers(iface, signal.id);
                    if (b.config.bindings.some(v => v.source.card === iface.card && v.source.interface === iface.id && members.includes(v.source.member)) && !b.active.includes(key(iface.card, iface.id, signal.id)))
                        b.active.push(key(iface.card, iface.id, signal.id));
                    if (b.active.includes(key(iface.card, iface.id, signal.id)) && members.some(member => !b.config.bindings.some(v => v.source.card === iface.card && v.source.interface === iface.id && v.source.member === member)))
                        diagnostics.push({ severity: 'error', message: 'Assign selected signal: ' + iface.id + '.' + signal.id });
                }
        if (b && board)
            this.publishedBoards.set(b.source.path, JSON.stringify(board));
        const d = this.draft;
        const choices = [...boards, ...[...this.drafts.values()].filter(d => !boards.some(b => b.id === d.value.id)).map(d => d.value)].map(v => { const draft = this.drafts.get(v.id), value = draft?.value ?? v; return { id: v.id, name: value.name, kind: value.model.kind, pins: Object.keys(value.model.pins ?? {}).length, saved: boards.some(b => b.id === v.id), dirty: !!draft && JSON.stringify(draft.value) !== JSON.stringify(draft.expected) }; });
        this.send({ type: 'state', revision: ++this.revision, reason, editId, page: this.page, boards: choices, draft: d?.value, dirty: !!d && JSON.stringify(d.value) !== JSON.stringify(d.expected), canUndo: !!d?.undo.length, canRedo: !!d?.redo.length, issues: d ? inspectBoardDraft(d.value).issues : [], source: b ? { path: b.source.path, module: b.source.module, isAd: b.source.isAd } : undefined, configuration: b?.config, bindingsDirty: !!b && b.saved !== JSON.stringify(b.config), ports: b?.source.ports ?? [], active: b?.active ?? [], interfaces, models: board ? { '': board.model, ...board.cards } : undefined, diagnostics, preview, output: b ? this.outputPath(b, board?.model.extension ?? '.xdc') : '', canExport: !!b && !!board && !!b.config.bindings.length && !diagnostics.some(d => d.severity === 'error'), error: this.error, notice: this.notice });
    }
}
function sameInputs(a: ArtifactPlan['inputs'], b: ArtifactPlan['inputs']): boolean { return a.length === b.length && a.every(input => b.some(other => other.path === input.path && other.text === input.text)); }
