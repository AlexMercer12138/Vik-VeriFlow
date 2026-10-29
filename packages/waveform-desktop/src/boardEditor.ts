import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { BrowserWindow, dialog, ipcMain, type IpcMainEvent } from 'electron';
import { emptyBoard, inspectBoardDraft, parseBoardDraft, physicalPins, type SavedPhysicalBoard } from '@veriflow/schematic-core/arch-design';
import { readPhysicalBoardFile, UserPhysicalBoardLibrary } from '@veriflow/hdl-runtime/physical';

const RENDERER_MESSAGE_CHANNEL = 'veriflow:board-editor-renderer-message';
const HOST_MESSAGE_CHANNEL = 'veriflow:board-editor-host-message';

function uniqueId(library: UserPhysicalBoardLibrary, base: string): string {
    const ids = new Set(library.list().map(board => board.id));
    const candidate = base.replace(/[^A-Za-z0-9_.-]/g, '_').replace(/^[^A-Za-z0-9_]+/, '') || 'board';
    let id = candidate;
    for (let suffix = 2; ids.has(id); suffix++) id = `${candidate}-${suffix}`;
    return id;
}

export async function createBoardEditorWindow(configPath: string): Promise<BrowserWindow> {
    const window = new BrowserWindow({
        width: 1100,
        height: 820,
        minWidth: 720,
        minHeight: 540,
        title: 'VeriFlow Board Editor',
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
        },
    });
    window.webContents.on('will-navigate', event => event.preventDefault());
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

    const library = new UserPhysicalBoardLibrary({ configPath });
    let draft = emptyBoard(), expected: SavedPhysicalBoard | undefined, error = '', tail = Promise.resolve();
    const send = (message: unknown): void => {
        if (!window.webContents.isDestroyed()) window.webContents.send(HOST_MESSAGE_CHANNEL, message);
    };
    const publish = (): void => {
        send({ type: 'state', draft, saved: !!expected, boards: library.list().map(({ id, name }) => ({ id, name })),
            ...inspectBoardDraft(draft), pins: physicalPins(draft.model), error });
        window.setTitle('Board · ' + (draft.name || 'New'));
    };
    const importBoard = async (): Promise<void> => {
        const result = await dialog.showOpenDialog(window, {
            title: 'Import board',
            properties: ['openFile'],
            filters: [
                { name: 'Board constraints', extensions: ['xdc', 'qsf', 'lpf', 'pcf', 'sdc', 'txt'] },
                { name: 'Board profile', extensions: ['json'] },
            ],
        });
        if (result.canceled || !result.filePaths[0]) return;
        const file = result.filePaths[0], data = await readPhysicalBoardFile(file);
        const input = path.extname(file).toLowerCase() === '.json' ? JSON.parse(await readFile(file, 'utf8')) : {};
        const stem = path.basename(file, path.extname(file)), base = stem === 'board' ? path.basename(path.dirname(file)) : stem;
        draft = parseBoardDraft({ ...data, id: uniqueId(library, typeof input.id === 'string' ? input.id : base),
            name: typeof input.name === 'string' ? input.name : base });
        expected = undefined;
    };
    const handle = async (message: any): Promise<void> => {
        if (!message || typeof message.type !== 'string') return;
        error = '';
        switch (message.type) {
            case 'ready':
                break;
            case 'change':
                draft = parseBoardDraft(message.draft);
                send({ type: 'validation', ...inspectBoardDraft(draft), pins: physicalPins(draft.model) });
                return;
            case 'new':
                draft = emptyBoard(); expected = undefined;
                break;
            case 'open':
                if (typeof message.id !== 'string') throw new Error('Invalid board ID');
                draft = library.get(message.id); expected = structuredClone(draft);
                break;
            case 'import':
                await importBoard();
                break;
            case 'copy':
                draft = { ...structuredClone(draft), id: uniqueId(library, draft.id + '-copy'), name: draft.name + ' copy' };
                expected = undefined;
                break;
            case 'save':
                library.saveBoard(draft, expected);
                draft = library.get(draft.id); expected = structuredClone(draft);
                break;
            case 'export': {
                const result = await dialog.showSaveDialog(window, {
                    title: 'Export board profile', defaultPath: path.join(path.dirname(configPath), `${draft.id || 'board'}.json`),
                    filters: [{ name: 'Board profile', extensions: ['json'] }],
                });
                if (!result.canceled && result.filePath)
                    await writeFile(result.filePath, JSON.stringify(draft, null, 2) + '\n', 'utf8');
                return;
            }
            case 'delete': {
                if (!expected) throw new Error('This board has not been saved');
                const result = await dialog.showMessageBox(window, { type: 'warning', buttons: ['Cancel', 'Delete'], defaultId: 0,
                    cancelId: 0, message: `Delete board ${expected.name}?` });
                if (result.response !== 1) return;
                library.deleteBoard(expected.id, expected);
                draft = emptyBoard(); expected = undefined;
                break;
            }
            default:
                return;
        }
        publish();
    };
    const listener = (event: IpcMainEvent, message: unknown): void => {
        if (event.sender !== window.webContents) return;
        tail = tail.then(() => handle(message)).catch(e => { error = e instanceof Error ? e.message : String(e); send({ type: 'error', message: error }); });
    };
    ipcMain.on(RENDERER_MESSAGE_CHANNEL, listener);
    window.on('closed', () => ipcMain.removeListener(RENDERER_MESSAGE_CHANNEL, listener));

    await window.loadFile(path.join(__dirname, '..', 'assets', 'constraints', 'index.html'));
    return window;
}
