import * as assert from 'assert';
import Module = require('module');

type Document = { languageId: string; version: number; isClosed: boolean; getText(): string; positionAt(n: number): number };
async function main(): Promise<void> {
    let provider: { provideDocumentFormattingEdits(d: Document, o: unknown, t: unknown): Promise<unknown[]> };
    let command: () => Promise<void>;
    let resolveFormat: (text: string) => void = () => {};
    let next: () => Promise<string> = async () => 'formatted';
    let editCount = 0, warnings = 0, disposals = 0;
    const document: Document = { languageId: 'verilog', version: 1, isClosed: false,
        getText: () => 'module m; endmodule', positionAt: n => n };
    const disposable = () => ({ dispose() { disposals++; } });
    const stub = {
        Disposable: class { constructor(private cb: () => void) {} dispose(): void { this.cb(); } },
        Range: class { constructor(public start: number, public end: number) {} },
        TextEdit: { replace: (range: unknown, newText: string) => ({ range, newText }) },
        languages: { registerDocumentFormattingEditProvider(_selector: unknown, value: typeof provider) { provider = value; return disposable(); } },
        commands: { registerCommand(name: string, value: typeof command) { assert.equal(name, 'veriflow.formatHdl'); command = value; return disposable(); } },
        window: { activeTextEditor: { document, async edit(cb: (b: {replace(): void}) => void) { editCount++; cb({replace() {}}); return true; } },
            async showWarningMessage() { warnings++; } },
    };
    const loader = Module as typeof Module & {_load: (name: string, ...args: unknown[]) => unknown};
    const original = loader._load;
    loader._load = function(name, ...args) {
        if (name === 'vscode') return stub;
        if (name === '@veriflow/hdl-runtime') return {formatHdl: () => next()};
        return original.call(this, name, ...args);
    };
    let registration: {dispose(): void};
    try {
        const {registerHdlFormatting} = require('../hdlFormatting');
        registration = registerHdlFormatting({extensionPath: '/extension'});
    } finally { loader._load = original; }
    await command!(); assert.equal(editCount, 1);
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
