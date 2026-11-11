import assert from 'node:assert/strict';
import test from 'node:test';

import { createWebviewTransport } from '../src/host';

type Listener = (event: { data: unknown }) => void;

function createWindow() {
    const listeners = new Set<Listener>();
    const posted: unknown[] = [];
    return {
        listeners,
        posted,
        addEventListener(_type: 'message', listener: Listener) { listeners.add(listener); },
        removeEventListener(_type: 'message', listener: Listener) { listeners.delete(listener); },
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
    transport.setState({ selected: 'clk' });
    transport.postMessage({ type: 'ready' });
    assert.deepEqual(dispatched, {
        type: 'veriflow:webview-message',
        detail: { type: 'ready' },
    });
    assert.deepEqual(transport.getState(), { selected: 'clk' });
});
