import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import path from 'node:path';
import { app, BrowserWindow, dialog, ipcMain, type IpcMainEvent } from 'electron';
import { ConstraintWorkbench, UserPhysicalBoardLibrary, loadConstraintSource, type ConstraintSourceOptions } from '@veriflow/hdl-runtime/physical';
import { applyArchDesignEdit, parseArchDesignText, serializeArchDesign } from '@veriflow/schematic-core/arch-design';
import { publishGeneratedFile } from '@veriflow/hdl-runtime/archDesign';
import { BOARD_EDITOR_HOST_MESSAGE_CHANNEL, BOARD_EDITOR_RENDERER_MESSAGE_CHANNEL } from './ipc';
export async function createBoardEditorWindow(configPath: string, sourceFile?: string, options: ConstraintSourceOptions = {}): Promise<BrowserWindow> {
    const window = new BrowserWindow({ width: 1440, height: 940, minWidth: 720, minHeight: 540, title: 'Pin constraints', backgroundColor: '#181b20', webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true } });
    window.webContents.on('will-navigate', e => e.preventDefault());
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    const recovery = path.join(app.getPath('userData'), 'constraint-workbench.json');
    const moduleChoices = new Map<string, string>();
    const source = async (file: string) => { const loaded = await loadConstraintSource(file, { ...options, module: moduleChoices.get(file) ?? options.module, chooseModule: async (names) => { const result = await dialog.showMessageBox(window, { message: 'Select RTL module', buttons: [...names, 'Cancel'], cancelId: names.length }); return names[result.response]; } }); moduleChoices.set(file, loaded.module); return loaded; };
    const session = new ConstraintWorkbench({ library: new UserPhysicalBoardLibrary({ configPath }), source,
        saveAd: async (previous, configuration) => { const parsed = parseArchDesignText(previous.text); if (parsed.status !== 'editable')
            throw new Error('AD is not editable'); const text = serializeArchDesign(applyArchDesignEdit(parsed.design, { type: 'setPhysical', physical: configuration })); await publishGeneratedFile(previous.path, text, {}, old => old === previous.text); return source(previous.path); },
        openFile: async (kind) => { const result = await dialog.showOpenDialog(window, { title: kind === 'board' ? 'Import board' : kind === 'source' ? 'Open HDL / AD file' : 'Load bindings', properties: ['openFile'], filters: [{ name: kind === 'source' ? 'HDL / AD' : 'Board / bindings', extensions: kind === 'source' ? ['ad', 'v', 'sv'] : ['json'] }] }); return result.canceled ? undefined : result.filePaths[0]; },
        saveFile: async (kind, suggestion) => { const result = await dialog.showSaveDialog(window, { title: kind === 'constraints' ? 'Export constraints' : kind === 'board' ? 'Export board' : 'Save bindings', defaultPath: suggestion, filters: [{ name: kind === 'constraints' ? 'Constraints' : 'JSON', extensions: [kind === 'constraints' ? path.extname(suggestion).slice(1) : 'json'] }] }); return result.canceled ? undefined : result.filePath; },
        confirmDelete: async (name) => (await dialog.showMessageBox(window, { type: 'warning', message: 'Delete board ' + name + '?', buttons: ['Cancel', 'Delete'], cancelId: 0, defaultId: 0 })).response === 1,
        persist: async (value) => { await mkdir(path.dirname(recovery), { recursive: true });const temporary=recovery+'.tmp'; await writeFile(temporary, JSON.stringify(value), 'utf8');await rename(temporary,recovery); }
    }, message => { if (!window.isDestroyed())
        window.webContents.send(BOARD_EDITOR_HOST_MESSAGE_CHANNEL, message); });
    try {
        session.restore(JSON.parse(await readFile(recovery, 'utf8')));
    }
    catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'ENOENT')
            console.warn('Could not restore constraint drafts');
    }
    if (sourceFile)
        await session.open(sourceFile);
    else
        await session.open();
    const listener = (event: IpcMainEvent, message: unknown) => { if (event.sender === window.webContents)
        void session.dispatch(message); };
    ipcMain.on(BOARD_EDITOR_RENDERER_MESSAGE_CHANNEL, listener);
    let readyToClose=false;
    window.on('close',event=>{if(readyToClose)return;event.preventDefault();void session.close().finally(()=>{readyToClose=true;if(!window.isDestroyed())window.close();});});
    window.on('closed', () => ipcMain.removeListener(BOARD_EDITOR_RENDERER_MESSAGE_CHANNEL, listener));
    await window.loadFile(path.join(__dirname, '..', 'assets', 'constraints', 'index.html'));
    return window;
}
