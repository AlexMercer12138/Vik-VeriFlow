import path from 'node:path';

import {
    app,
    BrowserWindow,
    ipcMain,
    type IpcMainEvent,
} from 'electron';
import { WaveformWorkerClient } from '@veriflow/waveform-runtime/waveformWorkerClient';

import { HOST_MESSAGE_CHANNEL, RENDERER_MESSAGE_CHANNEL } from './ipc';
import {
    WaveformRouter,
    type WaveformRouterTransport,
} from './router';
import { createBoardEditorWindow } from './boardEditor';

function waveformArgument(argv: string[]): string {
    const index = argv.indexOf('--waveform');
    const source = index >= 0 ? argv[index + 1] : undefined;
    if (!source) throw new Error('missing required --waveform path');
    return path.resolve(source);
}

function electronTransport(window: BrowserWindow): WaveformRouterTransport {
    return {
        send(message): void {
            if (!window.webContents.isDestroyed()) {
                window.webContents.send(HOST_MESSAGE_CHANNEL, message);
            }
        },
        onMessage(listener): () => void {
            const handler = (event: IpcMainEvent, message: unknown): void => {
                if (event.sender === window.webContents) listener(message);
            };
            ipcMain.on(RENDERER_MESSAGE_CHANNEL, handler);
            return () => ipcMain.removeListener(RENDERER_MESSAGE_CHANNEL, handler);
        },
    };
}

export async function createWaveformWindow(source: string): Promise<BrowserWindow> {
    const window = new BrowserWindow({
        width: 1280,
        height: 800,
        minWidth: 720,
        minHeight: 480,
        title: 'VeriFlow Waveform',
        backgroundColor: '#111318',
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
        },
    });
    window.webContents.on('will-navigate', event => event.preventDefault());
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    const worker = new WaveformWorkerClient({
        cacheRoot: path.join(app.getPath('userData'), 'waveform-cache'),
    });
    const router = new WaveformRouter({
        source: path.resolve(source),
        transport: electronTransport(window),
        worker,
    });

    let readyToClose = false;
    let disposal: Promise<void> | undefined;
    window.on('close', event => {
        if (readyToClose) return;
        event.preventDefault();
        disposal ??= router.dispose().finally(() => {
            readyToClose = true;
            if (!window.isDestroyed()) window.close();
        });
    });

    await window.loadFile(path.join(__dirname, '..', 'assets', 'waveform', 'index.html'));
    return window;
}

async function run(): Promise<void> {
    const boardIndex = process.argv.indexOf('--board-library');
    if (boardIndex >= 0) {
        const configPath = process.argv[boardIndex + 1];
        if (!configPath) throw new Error('missing required --board-library config path');
        await app.whenReady();
        const arg = (name:string) => {const index=process.argv.indexOf('--'+name);return index<0?undefined:process.argv[index+1];};
        await createBoardEditorWindow(path.resolve(configPath),arg('source'),{module:arg('module'),project:arg('project'),lib:arg('lib')?.split(','),config:arg('config')});
        app.on('window-all-closed', () => app.quit());
        return;
    }
    const source = waveformArgument(process.argv);
    await app.whenReady();
    await createWaveformWindow(source);
    app.on('window-all-closed', () => app.quit());
}

void run().catch(error => {
    console.error(error instanceof Error ? error.message : String(error));
    app.exit(1);
});
