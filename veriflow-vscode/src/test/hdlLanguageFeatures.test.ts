import * as assert from 'node:assert/strict';
import Module = require('module');
import type { HdlDocument } from '../core/hdl/model';
import type { WorkspaceHdlIndex } from '../core/hdl/workspaceHdlIndex';

async function main(): Promise<void> {
    let definitionProvider: { provideDefinition(document: any, position: any, token: any): Promise<any> } | undefined;
    let changeListener: ((event: any) => void) | undefined;
    let saveListener: ((document: any) => void) | undefined;
    let openListener: ((document: any) => void) | undefined;
    let closeListener: ((document: any) => void) | undefined;
    let disposed = 0;
    const diagnostics = new Map<string, any[]>();
    const disposable = () => ({ dispose() { disposed++; } });
    class Position { constructor(public line: number, public character: number) {} }
    class Range { constructor(public start: Position, public end: Position) {} }
    class Diagnostic {
        code?: string;
        source?: string;
        constructor(public range: Range, public message: string, public severity: number) {}
    }
    class Location { constructor(public uri: Uri, public range: Position) {} }
    class Uri {
        readonly path: string;
        constructor(private readonly value: string) { this.path = new URL(value).pathname; }
        toString(): string { return this.value; }
        static parse(value: string): Uri { return new Uri(value); }
    }
    const sourceText = 'module top; child u_child(); endmodule';
    const document = {
        uri: Uri.parse('file:///workspace/top.sv'), languageId: 'systemverilog',
        version: 1, isClosed: false, getText: () => sourceText,
        positionAt(offset: number) { return new Position(0, offset); },
        offsetAt(position: Position) { return position.character; },
    };
    const targetDocument = {
        ...document,
        uri: Uri.parse('file:///workspace/child.sv'),
        positionAt(offset: number) { return new Position(3, offset); },
    };
    const parsed = {
        uri: document.uri.toString(), languageId: 'systemverilog', version: 1,
        textHash: 'hash', lineEnding: '\n', preprocessingFingerprint: 'none',
        modules: [{
            name: 'top',
            instances: [{ moduleName: 'child', moduleNameSpan: { start: 14, end: 19, uri: document.uri.toString() } }],
        }],
        interfaces: [], packages: [], directives: [], includes: [],
        diagnostics: [{ severity: 'error', code: 'syntax-error', message: 'unexpected token', span: { start: 10, end: 15, uri: document.uri.toString() } }],
    } as unknown as HdlDocument;
    const targetDefinition = { key: 'module:child', kind: 'module', name: 'child', uri: targetDocument.uri.toString(), declarationStart: 0 };
    const index = {
        async parseOpenDocument() { return parsed; },
        findDefinitions(name: string) { return name === 'child' ? [targetDefinition] : []; },
        async resolveDefinition() { return { summary: targetDefinition, module: { nameSpan: { start: 6 } } }; },
    } as unknown as WorkspaceHdlIndex;
    const compilerDiagnostic = new Diagnostic(new Range(new Position(0, 20), new Position(0, 21)), 'Unknown module', 0);
    let compileCalls = 0;
    const stub = {
        Uri, Position, Range, Diagnostic, Location,
        DiagnosticSeverity: { Error: 0, Warning: 1, Information: 2 },
        Disposable: class { constructor(private cb: () => void) {} dispose(): void { this.cb(); } },
        languages: {
            createDiagnosticCollection() { return {
                set(uri: Uri, values: any[]) { diagnostics.set(uri.toString(), values); },
                delete(uri: Uri) { diagnostics.delete(uri.toString()); },
                dispose() { disposed++; },
            }; },
            registerDefinitionProvider(_selector: unknown, provider: typeof definitionProvider) { definitionProvider = provider; return disposable(); },
        },
        workspace: {
            textDocuments: [document],
            onDidChangeTextDocument(listener: typeof changeListener) { changeListener = listener; return disposable(); },
            onDidSaveTextDocument(listener: typeof saveListener) { saveListener = listener; return disposable(); },
            onDidOpenTextDocument(listener: typeof openListener) { openListener = listener; return disposable(); },
            onDidCloseTextDocument(listener: typeof closeListener) { closeListener = listener; return disposable(); },
            async openTextDocument(uri: Uri) { assert.equal(uri.toString(), targetDocument.uri.toString()); return targetDocument; },
        },
    };
    const loader = Module as typeof Module & { _load: (name: string, ...args: unknown[]) => unknown };
    const original = loader._load;
    loader._load = function(name, ...args) { return name === 'vscode' ? stub : original.call(this, name, ...args); };
    let registration: { dispose(): void };
    try {
        const { registerHdlLanguageFeatures } = require('../hdlLanguageFeatures');
        registration = registerHdlLanguageFeatures({
            getIndex: async () => index,
            async compile() { compileCalls++; return [{ uri: document.uri, diagnostic: compilerDiagnostic }]; },
            releaseIndex() {},
        }, { debounceMs: 0 });
    } finally { loader._load = original; }

    openListener!(document);
    await new Promise(resolve => setTimeout(resolve, 5));
    const uri = document.uri.toString();
    assert.equal(diagnostics.get(uri)?.length, 1, 'parser diagnostics are published on open');
    assert.equal(diagnostics.get(uri)?.[0].message, 'unexpected token');
    const locations = await definitionProvider!.provideDefinition(document, new Position(0, 16), { isCancellationRequested: false } as any);
    assert.equal(locations.length, 1);
    assert.equal(locations[0].uri.toString(), targetDocument.uri.toString());
    assert.equal(locations[0].range.line, 3);
    saveListener!(document);
    await new Promise(resolve => setTimeout(resolve, 5));
    assert.equal(compileCalls, 1, 'Icarus diagnostics are requested after save');
    assert.equal(diagnostics.get(uri)?.length, 2, 'syntax and compiler diagnostics are combined');
    changeListener!({ document, contentChanges: [{ text: 'changed' }] });
    assert.equal(diagnostics.get(uri)?.length, 1, 'stale compiler diagnostics clear after edits');
    closeListener!(document);
    assert.equal(diagnostics.has(uri), false);
    registration!.dispose();
    assert.ok(disposed >= 5);
    console.log('HDL live diagnostics, compile-on-save, definition navigation, and disposal passed');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
