import * as vscode from 'vscode';
import type { HdlDocument, HdlDiagnostic } from './core/hdl/model';
import type { WorkspaceHdlIndex } from './core/hdl/workspaceHdlIndex';

type HdlFeatureIndex = WorkspaceHdlIndex;

export type HdlCompilerDiagnostic = Readonly<{
    uri: vscode.Uri;
    diagnostic: vscode.Diagnostic;
}>;

export type HdlLanguageFeatureServices = Readonly<{
    getIndex(document: vscode.TextDocument, owner: object): Promise<HdlFeatureIndex | undefined>;
    compile(
        document: vscode.TextDocument,
        index: HdlFeatureIndex,
        parsed: HdlDocument,
        signal: AbortSignal
    ): Promise<readonly HdlCompilerDiagnostic[]>;
    releaseIndex(owner: object): void;
}>;

type DocumentState = {
    owner: object;
    syntax: Map<string, vscode.Diagnostic[]>;
    compiler: Map<string, vscode.Diagnostic[]>;
    timer?: ReturnType<typeof setTimeout>;
    parseController?: AbortController;
    compileController?: AbortController;
};

function isHdlDocument(document: vscode.TextDocument): boolean {
    return (document.languageId === 'verilog'
        || document.languageId === 'systemverilog')
        && /\.(?:v|sv)$/i.test(document.uri.path);
}

function uriKey(uri: vscode.Uri): string {
    return uri.toString();
}

function diagnosticsForSource(
    document: vscode.TextDocument,
    items: readonly HdlDiagnostic[]
): vscode.Diagnostic[] {
    const sourceUri = uriKey(document.uri);
    return items.filter(item => !item.span?.uri || item.span.uri === sourceUri).map(item => {
        const start = Math.min(Math.max(item.span?.start ?? 0, 0), document.getText().length);
        const end = Math.min(Math.max(item.span?.end ?? start, start), document.getText().length);
        const severity = item.severity === 'error'
            ? vscode.DiagnosticSeverity.Error
            : item.severity === 'warning'
                ? vscode.DiagnosticSeverity.Warning
                : vscode.DiagnosticSeverity.Information;
        const diagnostic = new vscode.Diagnostic(
            new vscode.Range(document.positionAt(start), document.positionAt(end)),
            item.message,
            severity
        );
        diagnostic.code = item.code;
        diagnostic.source = 'VeriFlow HDL';
        return diagnostic;
    });
}

export function registerHdlLanguageFeatures(
    services: HdlLanguageFeatureServices,
    options: { debounceMs?: number } = {}
): vscode.Disposable {
    const collection = vscode.languages.createDiagnosticCollection('veriflow-hdl');
    const states = new Map<string, DocumentState>();
    const debounceMs = options.debounceMs ?? 250;
    let disposed = false;

    const getState = (document: vscode.TextDocument): DocumentState => {
        const key = uriKey(document.uri);
        let state = states.get(key);
        if (!state) {
            state = { owner: {}, syntax: new Map(), compiler: new Map() };
            states.set(key, state);
        }
        return state;
    };

    const publish = (document: vscode.TextDocument, state: DocumentState): void => {
        const merged = [
            ...(state.syntax.get(uriKey(document.uri)) ?? []),
            ...(state.compiler.get(uriKey(document.uri)) ?? []),
        ];
        collection.set(document.uri, merged);
    };

    const parseCurrent = async (
        document: vscode.TextDocument,
        state: DocumentState,
        signal: AbortSignal,
        refresh: boolean
    ): Promise<{ index: HdlFeatureIndex; parsed: HdlDocument } | undefined> => {
        const version = document.version;
        const index = await services.getIndex(document, state.owner);
        if (!index || signal.aborted || document.isClosed || document.version !== version) return undefined;
        if (refresh) await index.refreshUri?.(document.uri.toString(), signal);
        if (signal.aborted || document.isClosed || document.version !== version) return undefined;
        const parsed = await index.parseOpenDocument(
            document.uri.toString(),
            version,
            document.getText(),
            signal,
            state.owner
        );
        if (signal.aborted || document.isClosed || document.version !== version) return undefined;
        return { index, parsed };
    };

    const analyzeSyntax = async (document: vscode.TextDocument, state: DocumentState): Promise<{
        index: HdlFeatureIndex;
        parsed: HdlDocument;
    } | undefined> => {
        state.parseController?.abort();
        const controller = new AbortController();
        state.parseController = controller;
        try {
            const result = await parseCurrent(document, state, controller.signal, false);
            if (!result || disposed || states.get(uriKey(document.uri)) !== state) return undefined;
            state.syntax = new Map([[uriKey(document.uri), diagnosticsForSource(document, result.parsed.diagnostics)]]);
            publish(document, state);
            return result;
        } catch {
            return undefined;
        }
    };

    const scheduleSyntax = (document: vscode.TextDocument): void => {
        if (disposed || !isHdlDocument(document) || document.isClosed) return;
        const state = getState(document);
        if (state.timer !== undefined) clearTimeout(state.timer);
        state.parseController?.abort();
        state.timer = setTimeout(() => {
            state.timer = undefined;
            void analyzeSyntax(document, state);
        }, debounceMs);
    };

    const onSave = async (document: vscode.TextDocument): Promise<void> => {
        if (disposed || !isHdlDocument(document) || document.isClosed) return;
        const state = getState(document);
        if (state.timer !== undefined) clearTimeout(state.timer);
        state.timer = undefined;
        state.compileController?.abort();
        const controller = new AbortController();
        state.compileController = controller;
        const version = document.version;
        try {
            const result = await parseCurrent(document, state, controller.signal, true);
            if (!result || disposed || document.version !== version) return;
            state.syntax = new Map([[uriKey(document.uri), diagnosticsForSource(document, result.parsed.diagnostics)]]);
            state.compiler = new Map();
            publish(document, state);
            const compilerDiagnostics = await services.compile(
                document,
                result.index,
                result.parsed,
                controller.signal
            );
            if (controller.signal.aborted || disposed || document.isClosed
                || document.version !== version || states.get(uriKey(document.uri)) !== state) return;
            const byUri = new Map<string, vscode.Diagnostic[]>();
            for (const item of compilerDiagnostics) {
                const key = uriKey(item.uri);
                const values = byUri.get(key) ?? [];
                values.push(item.diagnostic);
                byUri.set(key, values);
            }
            state.compiler = byUri;
            publish(document, state);
        } catch {
            // Failed or cancelled compiler runs must not replace parser diagnostics.
        }
    };

    const definitionProvider: vscode.DefinitionProvider = {
        async provideDefinition(document, position, token) {
            if (disposed || !isHdlDocument(document) || token.isCancellationRequested) return undefined;
            const state = getState(document);
            const controller = new AbortController();
            try {
                const result = await parseCurrent(document, state, controller.signal, false);
                if (!result || token.isCancellationRequested) return undefined;
                const offset = document.offsetAt(position);
                const instance = result.parsed.modules
                    .flatMap(module => module.instances)
                    .find(item => item.moduleNameSpan.start <= offset
                        && offset < item.moduleNameSpan.end
                        && (!item.moduleNameSpan.uri || item.moduleNameSpan.uri === document.uri.toString()));
                if (!instance) return undefined;
                const definitions = result.index.findDefinitions(instance.moduleName, 'module');
                const locations: vscode.Location[] = [];
                for (const definition of definitions) {
                    const resolved = await result.index.resolveDefinition(definition.key);
                    if (!resolved.module || token.isCancellationRequested) continue;
                    const target = vscode.Uri.parse(definition.uri);
                    const targetDocument = await vscode.workspace.openTextDocument(target);
                    locations.push(new vscode.Location(
                        target,
                        targetDocument.positionAt(resolved.module.nameSpan.start)
                    ));
                }
                return locations;
            } catch {
                return undefined;
            }
        },
    };

    const registrations = [
        vscode.languages.registerDefinitionProvider(
            [{ language: 'verilog' }, { language: 'systemverilog' }],
            definitionProvider
        ),
        vscode.workspace.onDidOpenTextDocument(scheduleSyntax),
        vscode.workspace.onDidChangeTextDocument(event => {
            if (event.contentChanges.length === 0 || !isHdlDocument(event.document)) return;
            const state = getState(event.document);
            state.compileController?.abort();
            state.compiler = new Map();
            publish(event.document, state);
            scheduleSyntax(event.document);
        }),
        vscode.workspace.onDidSaveTextDocument(document => { void onSave(document); }),
        vscode.workspace.onDidCloseTextDocument(document => {
            const key = uriKey(document.uri);
            const state = states.get(key);
            if (!state) return;
            if (state.timer !== undefined) clearTimeout(state.timer);
            state.parseController?.abort();
            state.compileController?.abort();
            states.delete(key);
            collection.delete(document.uri);
            services.releaseIndex(state.owner);
        }),
        collection,
    ];
    for (const document of vscode.workspace.textDocuments) scheduleSyntax(document);

    return new vscode.Disposable(() => {
        disposed = true;
        for (const state of states.values()) {
            if (state.timer !== undefined) clearTimeout(state.timer);
            state.parseController?.abort();
            state.compileController?.abort();
            services.releaseIndex(state.owner);
        }
        states.clear();
        registrations.forEach(registration => registration.dispose());
    });
}
