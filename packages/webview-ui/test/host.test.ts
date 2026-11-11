import assert from 'node:assert/strict';
import test from 'node:test';

import { createWebviewTransport } from '../src/host';

type Listener = (event: { data: unknown }) => void;
type CustomListener = (event: { detail: unknown }) => void;

function createWindow() {
    const listeners = new Set<Listener>();
    const customListeners = new Set<CustomListener>();
    const posted: unknown[] = [];
    return {
        listeners,
        customListeners,
        posted,
        addEventListener(type: string, listener: Listener | CustomListener) {
            if (type === 'message') listeners.add(listener as Listener);
            else if (type === 'veriflow:webview-host-message') customListeners.add(listener as CustomListener);
        },
        removeEventListener(type: string, listener: Listener | CustomListener) {
            if (type === 'message') listeners.delete(listener as Listener);
            else if (type === 'veriflow:webview-host-message') customListeners.delete(listener as CustomListener);
        },
        postMessage(message: unknown) { posted.push(message); },
    };
}

test('uses the VS Code API and window messages', () => {
    const win = createWindow();
    const sent: unknown[] = [];
    let saved: unknown;
    Object.assign(win, {
        acquireVsCodeApi: () => ({
            postMessage: (message: unknown) => sent.push(message),
            getState: () => ({ selected: 'uart_tx' }),
            setState: (state: unknown) => { saved = state; },
        }),
    });
    const transport = createWebviewTransport(win as unknown as Window);
    const received: unknown[] = [];
    transport.onMessage(message => received.push(message));
    transport.postMessage({ type: 'ready' });
    for (const listener of win.listeners) listener({ data: { type: 'initialize' } });
    transport.setState({ selected: 'uart_rx' });
    assert.deepEqual(sent, [{ type: 'ready' }]);
    assert.deepEqual(received, [{ type: 'initialize' }]);
    assert.deepEqual(transport.getState(), { selected: 'uart_tx' });
    assert.deepEqual(saved, { selected: 'uart_rx' });
});

test('uses the Electron preload transport and disposes listeners', () => {
    const win = createWindow();
    const sent: unknown[] = [];
    const received: unknown[] = [];
    let listener: ((message: unknown) => void) | undefined;
    Object.assign(win, {
        __veriflowHost: {
            postMessage: (message: unknown) => sent.push(message),
            onMessage: (callback: (message: unknown) => void) => {
                listener = callback;
                return () => { listener = undefined; };
            },
            getState: () => ({ zoom: 2 }),
            setState: (_state: unknown) => undefined,
        },
    });
    const transport = createWebviewTransport(win as unknown as Window);
    const dispose = transport.onMessage(message => received.push(message));
    transport.postMessage({ type: 'ready' });
    listener?.({ type: 'initialize' });
    dispose();
    assert.deepEqual(sent, [{ type: 'ready' }]);
    assert.deepEqual(received, [{ type: 'initialize' }]);
    assert.deepEqual(transport.getState(), { zoom: 2 });
    assert.equal(listener, undefined);
});

test('uses the preview event and local state when no host bridge exists', () => {
    const win = createWindow() as ReturnType<typeof createWindow> & {
        dispatchEvent(event: { type: string; detail: unknown }): void;
    };
    let dispatched: { type: string; detail: unknown } | undefined;
    Object.assign(win, {
        dispatchEvent: (event: Event) => {
            dispatched = { type: event.type, detail: (event as CustomEvent).detail };
        },
    });
    const transport = createWebviewTransport(win as unknown as Window);
    const received: unknown[] = [];
    transport.onMessage(message => received.push(message));
    transport.setState({ selected: 'clk' });
    transport.postMessage({ type: 'ready' });
    for (const listener of win.listeners) listener({ data: { type: 'initialize' } });
    for (const listener of win.customListeners) listener({ detail: { type: 'preview' } });
    assert.deepEqual(dispatched, {
        type: 'veriflow:webview-message',
        detail: { type: 'ready' },
    });
    assert.deepEqual(transport.getState(), { selected: 'clk' });
    assert.deepEqual(received, [{ type: 'initialize' }, { type: 'preview' }]);
});
