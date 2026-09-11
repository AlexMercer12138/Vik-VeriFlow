import * as vscode from 'vscode';
import * as path from 'path';
import { formatHdl } from '@veriflow/hdl-runtime';

export function registerHdlFormatting(context: vscode.ExtensionContext): vscode.Disposable {
    let disposed = false;
    const options = {
        runtimeWasmPath: path.join(context.extensionPath, 'media', 'parsers', 'web-tree-sitter.wasm'),
        languageWasmPath: path.join(context.extensionPath, 'media', 'parsers', 'tree-sitter-systemverilog.wasm'),
    };
    const isHdl = (document: vscode.TextDocument): boolean =>
        document.languageId === 'verilog' || document.languageId === 'systemverilog';
    async function edits(document: vscode.TextDocument, token?: vscode.CancellationToken): Promise<vscode.TextEdit[]> {
        if (disposed || !isHdl(document) || token?.isCancellationRequested) return [];
        const version = document.version;
        const source = document.getText();
        try {
            const formatted = await formatHdl(source, options);
            if (disposed || token?.isCancellationRequested || document.isClosed
                || document.version !== version || formatted === source) return [];
            return [vscode.TextEdit.replace(new vscode.Range(document.positionAt(0), document.positionAt(source.length)), formatted)];
        } catch (error) {
            if (!disposed && !token?.isCancellationRequested) {
                await vscode.window.showWarningMessage(`Unable to format HDL: ${error instanceof Error ? error.message : String(error)}`);
            }
            return [];
        }
    }
    const provider = vscode.languages.registerDocumentFormattingEditProvider(
        [{ language: 'verilog' }, { language: 'systemverilog' }],
        { provideDocumentFormattingEdits: (document, _options, token) => edits(document, token) }
    );
    const command = vscode.commands.registerCommand('veriflow.formatHdl', async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor || !isHdl(editor.document)) return;
        const version = editor.document.version;
        const changes = await edits(editor.document);
        if (disposed || editor.document.isClosed || editor.document.version !== version || !changes.length) return;
        const applied = await editor.edit(builder => {
            for (const change of changes) builder.replace(change.range, change.newText);
        });
        if (!applied && !disposed) await vscode.window.showWarningMessage('HDL formatting could not be applied; try again.');
    });
    return new vscode.Disposable(() => { disposed = true; provider.dispose(); command.dispose(); });
}
