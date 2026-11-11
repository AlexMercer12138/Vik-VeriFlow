type WaveformMessage = { type: string; [key: string]: unknown };

interface WaveformTransport {
    readonly kind: 'memory' | 'vscode' | 'qt';
    send(message: WaveformMessage): void;
    onMessage(listener: (message: WaveformMessage) => void): () => void;
    getState(): unknown;
    setState(value: unknown): void;
    dispose(): void;
    dispatch(message: WaveformMessage, mirrorToWindow?: boolean): void;
}

interface WaveformTransportEnvironment {
    document?: unknown;
    dispatchEvent?: (event: Event) => void;
    MessageEvent?: typeof MessageEvent;
    addEventListener?: (type: 'message', listener: (event: MessageEvent) => void) => void;
    acquireVsCodeApi?: () => {
        postMessage(message: WaveformMessage): void;
        getState?(): unknown;
        setState?(value: unknown): void;
    };
    __waveformMemoryTransport?: {
        send(message: WaveformMessage): void;
        onMessage?(listener: (message: WaveformMessage) => void): () => void;
    };
    qt?: { webChannelTransport: unknown };
    QWebChannel?: new (transport: unknown, ready: (channel: {
        objects: {
            waveformBridge: {
                send(payload: string): void;
                message: { connect(listener: (payload: string) => void): void };
            };
        };
    }) => void) => unknown;
    waveformTransport?: WaveformTransport;
}

function createWaveformTransport(environment: WaveformTransportEnvironment): WaveformTransport {

    const listeners = new Set<(message: WaveformMessage) => void>();
    const pending: WaveformMessage[] = [];
    let kind: WaveformTransport['kind'] = 'memory';
    let sendToHost = (message: WaveformMessage): void => { pending.push(message); };
    let getState = (): unknown => null;
    let setState = (_value: unknown): void => undefined;
    let removeHostListener = (): void => undefined;

    function dispatch(message: WaveformMessage, mirrorToWindow = true): void {
        listeners.forEach(listener => listener(message));
        if (
            mirrorToWindow
            && typeof environment.dispatchEvent === 'function'
            && typeof environment.MessageEvent === 'function'
        ) {
        environment.dispatchEvent(new environment.MessageEvent('message', { data: message }));
        }
    }

    const memory = environment.__waveformMemoryTransport;
    if (memory && typeof memory.send === 'function') {
        kind = 'memory';
        sendToHost = message => memory.send(message);
        if (typeof memory.onMessage === 'function') {
            removeHostListener = memory.onMessage(message => dispatch(message));
        }
    } else if (typeof environment.acquireVsCodeApi === 'function') {
        kind = 'vscode';
        const vscode = environment.acquireVsCodeApi();
        sendToHost = message => vscode.postMessage(message);
        getState = () => vscode.getState?.() ?? null;
        setState = value => vscode.setState?.(value);
        environment.addEventListener?.('message', event => dispatch(event.data as WaveformMessage, false));
    } else if (environment.qt && typeof environment.QWebChannel === 'function') {
        kind = 'qt';
        new environment.QWebChannel(environment.qt.webChannelTransport, channel => {
            const bridge = channel.objects.waveformBridge;
            bridge.message.connect(payload => {
                try {
                    dispatch(JSON.parse(payload) as WaveformMessage);
            } catch (error) {
                    dispatch({ type: 'bridgeError', message: String(error) });
                }
            });
            sendToHost = message => bridge.send(JSON.stringify(message));
            pending.splice(0).forEach(sendToHost);
        });
    }

    return {
        kind,
        send(message: WaveformMessage): void {
            sendToHost(message);
        },
        onMessage(listener: (message: WaveformMessage) => void): () => void {
            listeners.add(listener);
            return () => listeners.delete(listener);
        },
        getState(): unknown {
            return getState();
        },
        setState(value: unknown): void {
            setState(value);
        },
        dispose(): void {
            removeHostListener?.();
            listeners.clear();
            pending.length = 0;
        },
        dispatch,
    };
}

const browserGlobal = globalThis as typeof globalThis & {
    document?: unknown;
    waveformTransport?: WaveformTransport;
};

if (typeof browserGlobal.document === 'object') {
    browserGlobal.waveformTransport = createWaveformTransport(browserGlobal as WaveformTransportEnvironment);
}

export = { createWaveformTransport };
