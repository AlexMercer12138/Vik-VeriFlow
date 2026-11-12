import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';

import { BOARD_EDITOR_HOST_MESSAGE_CHANNEL, BOARD_EDITOR_RENDERER_MESSAGE_CHANNEL, HOST_MESSAGE_CHANNEL, RENDERER_MESSAGE_CHANNEL, SCHEMATIC_EDITOR_HOST_MESSAGE_CHANNEL, SCHEMATIC_EDITOR_RENDERER_MESSAGE_CHANNEL } from './ipc';

let webviewState: unknown;
const boardEditorWindow = process.argv.includes('--board-library');
const schematicEditorWindow = process.argv.includes('--veriflow-schematic-editor');
const rendererChannel = schematicEditorWindow ? SCHEMATIC_EDITOR_RENDERER_MESSAGE_CHANNEL
    : boardEditorWindow ? BOARD_EDITOR_RENDERER_MESSAGE_CHANNEL : RENDERER_MESSAGE_CHANNEL;
const hostChannel = schematicEditorWindow ? SCHEMATIC_EDITOR_HOST_MESSAGE_CHANNEL
    : boardEditorWindow ? BOARD_EDITOR_HOST_MESSAGE_CHANNEL : HOST_MESSAGE_CHANNEL;

contextBridge.exposeInMainWorld('__veriflowHost', Object.freeze({
    postMessage(message: unknown): void {
        ipcRenderer.send(rendererChannel, message);
    },
    onMessage(listener: (message: unknown) => void): () => void {
        const handler = (_event: IpcRendererEvent, message: unknown): void => listener(message);
        ipcRenderer.on(hostChannel, handler);
        return () => {
            ipcRenderer.removeListener(hostChannel, handler);
        };
    },
    getState(): unknown { return webviewState; },
    setState(state: unknown): void { webviewState = state; },
}));

contextBridge.exposeInMainWorld('__waveformMemoryTransport', Object.freeze({
    send(message: unknown): void {
        ipcRenderer.send(RENDERER_MESSAGE_CHANNEL, message);
    },
    onMessage(listener: (message: unknown) => void): () => void {
        if (typeof listener !== 'function') return () => undefined;
        const handler = (_event: IpcRendererEvent, message: unknown): void => listener(message);
        ipcRenderer.on(HOST_MESSAGE_CHANNEL, handler);
        return () => ipcRenderer.removeListener(HOST_MESSAGE_CHANNEL, handler);
    },
}));

contextBridge.exposeInMainWorld('__boardEditorHost', Object.freeze({
    postMessage(message: unknown): void { ipcRenderer.send(BOARD_EDITOR_RENDERER_MESSAGE_CHANNEL, message); },
    onMessage(listener: (message: unknown) => void): () => void {
        if (typeof listener !== 'function') return () => undefined;
        const handler = (_event: IpcRendererEvent, message: unknown): void => listener(message);
        ipcRenderer.on(BOARD_EDITOR_HOST_MESSAGE_CHANNEL, handler);
        return () => ipcRenderer.removeListener(BOARD_EDITOR_HOST_MESSAGE_CHANNEL, handler);
    },
}));
