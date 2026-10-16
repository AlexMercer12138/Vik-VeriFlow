import * as assert from 'assert';
import Module = require('module');

type Document = { uri: string; languageId: string; version: number; isClosed: boolean; getText(): string; positionAt(n: number): number };
async function main(): Promise<void> {
    let provider: { provideDocumentFormattingEdits(d: Document, o: unknown, t: unknown): Promise<unknown[]> };
    class Uri {}
    let command: (uri?: Uri) => Promise<void>;
    let resolveFormat: (text: string) => void = () => {};
    let next: () => Promise<string> = async () => 'formatted';
    let editCount = 0, warnings = 0, disposals = 0;
    const document: Document = { uri: 'file:///project-a/top.v', languageId: 'verilog', version: 1, isClosed: false,
        getText: () => 'module m; endmodule', positionAt: n => n };
    const selectedDocument: Document = { ...document, uri: 'file:///project-a/selected.v' };
    let expectedDocument = document, selectedEdits = 0;
    const selectedUri = new Uri();
    let settings: Record<string, unknown> = {};
    const formatOptions: Array<Record<string, unknown>> = [];
    const disposable = () => ({ dispose() { disposals++; } });
    const stub = {
        Uri,
        Disposable: class { constructor(private cb: () => void) {} dispose(): void { this.cb(); } },
        Range: class { constructor(public start: number, public end: number) {} },
        TextEdit: { replace: (range: unknown, newText: string) => ({ range, newText }) },
        workspace: { async openTextDocument(uri: Uri) { assert.equal(uri, selectedUri); return selectedDocument; },
            getConfiguration(section: string, scope: Document) {
            assert.equal(section, 'veriflow.formatting');
            assert.equal(scope, expectedDocument, 'document scope retains language overrides and workspace folder');
            return { get: (key: string, fallback: unknown) => settings[key] ?? fallback };
        } },
        languages: { registerDocumentFormattingEditProvider(_selector: unknown, value: typeof provider) { provider = value; return disposable(); } },
        commands: { registerCommand(name: string, value: typeof command) { assert.equal(name, 'veriflow.formatHdl'); command = value; return disposable(); } },
        window: { activeTextEditor: { document, async edit(cb: (b: {replace(): void}) => void) { editCount++; cb({replace() {}}); return true; } },
            async showTextDocument(opened: Document) {
                assert.equal(opened, selectedDocument);
                return { document: opened, async edit(cb: (b: {replace(): void}) => void) { selectedEdits++; cb({replace() {}}); return true; } };
            },
            async showWarningMessage() { warnings++; } },
    };
    const loader = Module as typeof Module & {_load: (name: string, ...args: unknown[]) => unknown};
    const original = loader._load;
    loader._load = function(name, ...args) {
        if (name === 'vscode') return stub;
        if (name === '@veriflow/hdl-runtime') return { ...original.call(this, name, ...args) as object,
            formatHdl: (_source: string, options: Record<string, unknown>) => { formatOptions.push(options); return next(); } };
        return original.call(this, name, ...args);
    };
    let registration: {dispose(): void};
    try {
        const {registerHdlFormatting} = require('../hdlFormatting');
        registration = registerHdlFormatting({extensionPath: '/extension'});
    } finally { loader._load = original; }
    await command!(); assert.equal(editCount, 1);
    expectedDocument = selectedDocument;
    await command!(selectedUri);
    assert.equal(selectedEdits, 1, 'resource command formats the selected file');
    assert.equal(editCount, 1, 'resource command must not format the previously active editor');
    expectedDocument = document;
    assert.deepEqual(formatOptions.at(-1)?.alignmentColumns, [4, 12, 20, 44, 56]);
    settings = { alignment: 'columns', columns: [2, 10, 18, 36, 52] };
    await provider!.provideDocumentFormattingEdits(document, {}, {});
    assert.deepEqual(formatOptions.at(-1)?.alignmentColumns, [2, 10, 18, 36, 52]);
    await command!();
    assert.deepEqual(formatOptions.at(-1), formatOptions.at(-2), 'command and provider use the same current settings');
    document.uri = 'file:///project-b/top.sv'; document.languageId = 'systemverilog';
    settings = { alignment: 'adaptive', columns: [3, 12, 20, 44, 56] };
    await provider!.provideDocumentFormattingEdits(document, {}, {});
    assert.equal(formatOptions.at(-1)?.alignmentColumns, undefined);
    assert.equal(formatOptions.at(-1)?.indentSize, 3);
    settings = { alignment: 'columns', columns: [4, 12, 12, 44, 56] };
    await provider!.provideDocumentFormattingEdits(document, {}, {});
    assert.deepEqual(formatOptions.at(-1)?.alignmentColumns, [4, 12, 20, 44, 56]);
    assert.equal(warnings, 1, 'one warning for invalid columns, then format with defaults');
    settings.alignment = 'adaptive';
    await provider!.provideDocumentFormattingEdits(document, {}, {});
    assert.equal(formatOptions.at(-1)?.alignmentColumns, undefined, 'invalid columns must not switch an explicitly selected adaptive mode');
    assert.equal(formatOptions.at(-1)?.indentSize, 4);
    assert.equal(warnings, 2);
    settings = {}; warnings = 0; editCount = 1;
    next = () => new Promise(resolve => { resolveFormat = resolve; });
    const pending = command!(); document.version++; resolveFormat('new'); await pending;
    assert.equal(editCount, 1, 'stale result must not edit document');
    const cancelled = await provider!.provideDocumentFormattingEdits(document, {}, {isCancellationRequested: true});
    assert.deepEqual(cancelled, []);
    next = async () => { throw new Error('parse error'); };
    await command!(); assert.equal(warnings, 1); assert.equal(editCount, 1);
    document.languageId = 'plaintext'; await command!(); assert.equal(warnings, 1);
    registration!.dispose(); assert.equal(disposals, 2);
    console.log('HDL formatting command/provider lifecycle passed');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
