export interface WebviewTransport<Outgoing, Incoming, State = unknown> {
    postMessage(message: Outgoing): void;
    onMessage(listener: (message: Incoming) => void): () => void;
    getState(): State | undefined;
    setState(state: State): void;
}

interface VsCodeApi<State> {
    postMessage(message: unknown): void;
    getState(): State | undefined;
    setState(state: State): void;
}

interface ElectronHost {
    postMessage(message: unknown): void;
    onMessage(listener: (message: unknown) => void): () => void;
    getState?(): unknown;
    setState?(state: unknown): void;
}

interface HostWindow extends Window {
    acquireVsCodeApi?: <State>() => VsCodeApi<State>;
    __veriflowHost?: ElectronHost;
}

function dispatchDetail(target: Window, type: string, detail: unknown): void {
    const CustomEventConstructor = (target as Window & { CustomEvent?: typeof CustomEvent }).CustomEvent
        ?? globalThis.CustomEvent;
    const event = CustomEventConstructor
        ? new CustomEventConstructor(type, { detail })
        : { type, detail } as unknown as Event;
    target.dispatchEvent(event);
}

export function createWebviewTransport<Outgoing, Incoming, State = unknown>(
    target: Window = window,
): WebviewTransport<Outgoing, Incoming, State> {
    const hostWindow = target as HostWindow;
    if (hostWindow.acquireVsCodeApi) {
        const api = hostWindow.acquireVsCodeApi<State>();
        return {
            postMessage: message => api.postMessage(message),
            onMessage(listener) {
                const handler = (event: MessageEvent<Incoming>): void => listener(event.data);
                target.addEventListener('message', handler);
                return () => target.removeEventListener('message', handler);
            },
            getState: () => api.getState(),
            setState: state => { api.setState(state); },
        };
    }

    if (hostWindow.__veriflowHost) {
        const host = hostWindow.__veriflowHost;
        return {
            postMessage: message => host.postMessage(message),
            onMessage: listener => host.onMessage(listener as (message: unknown) => void),
            getState: () => host.getState?.() as State | undefined,
            setState: state => host.setState?.(state),
        };
    }

    let state: State | undefined;
    return {
        postMessage: message => dispatchDetail(target, 'veriflow:webview-message', message),
        onMessage(listener) {
            const handleWindowMessage = (event: MessageEvent<Incoming>): void => {
                listener(event.data);
            };
            const handlePreviewMessage = (event: Event): void => {
                listener((event as CustomEvent<Incoming>).detail);
            };
            target.addEventListener('message', handleWindowMessage);
            target.addEventListener('veriflow:webview-host-message', handlePreviewMessage);
            return () => {
                target.removeEventListener('message', handleWindowMessage);
                target.removeEventListener('veriflow:webview-host-message', handlePreviewMessage);
            };
        },
        getState: () => state,
        setState: value => { state = value; },
    };
}
