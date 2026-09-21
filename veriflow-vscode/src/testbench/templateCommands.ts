import * as vscode from 'vscode';
import { getActiveCanvas } from '../workbench/moduleTargets';
import { resolveHdlTemplates } from './templateConfiguration';

export function registerHdlTemplateCommands(): vscode.Disposable {
    async function insert(id?: string): Promise<void> {
        const editor = vscode.window.activeTextEditor;
        if (!editor || !['verilog', 'systemverilog'].includes(editor.document.languageId)) return;
        if (editor.selections.length !== 1) {
            await vscode.window.showInformationMessage('Insert HDL Template requires one cursor.'); return;
        }
        if (editor.document.uri.scheme !== 'untitled' && vscode.workspace.fs.isWritableFileSystem(editor.document.uri.scheme) === false) return;
        const selection = editor.selection;
        const version = editor.document.version;
        const position = editor.selection.active;
        const configuration = vscode.workspace.getConfiguration('veriflow', editor.document.uri);
        const resolved = resolveHdlTemplates(configuration.get('hdlTemplates'));
        if (resolved.issues.length > 0) {
            const details = resolved.issues.map(issue => `${issue.path}: ${issue.message}`).join('\n');
            void vscode.window.showWarningMessage(`Invalid HDL template configuration:\n${details}`, 'Open Settings').then(action => {
                if (action === 'Open Settings') return vscode.commands.executeCommand('workbench.action.openSettings', 'veriflow.hdlTemplates');
                return undefined;
            });
        }
        const templates = resolved.templates.filter(template => template.languages.includes(editor.document.languageId as 'verilog' | 'systemverilog'));
        const template = id ? templates.find(item => item.id === id) : await vscode.window.showQuickPick(
            templates, { title: 'Insert HDL Template', matchOnDescription: true });
        if (id && !template) {
            await vscode.window.showInformationMessage(`HDL template "${id}" is disabled or unavailable for ${editor.document.languageId}.`);
            return;
        }
        if (!template) return;
        if ((editor.document.uri.scheme !== 'untitled' && vscode.workspace.fs.isWritableFileSystem(editor.document.uri.scheme) === false) || editor.document.isClosed || editor.document.version !== version || vscode.window.activeTextEditor !== editor || editor.selections.length !== 1 || !editor.selection.isEqual(selection)) {
            await vscode.window.showInformationMessage('The editor changed. Run Insert HDL Template again.'); return;
        }
        // appendText escapes HDL $tasks and backslashes; no syntax-position detection.
        const eol = editor.document.eol === vscode.EndOfLine.CRLF ? '\r\n' : '\n';
        const source = template.body.replace(/\r\n|\r/g, '\n').replace(/\n/g, eol);
        if (source.length === 0) return;
        const snippet = new vscode.SnippetString();
        let offset = 0;
        for (const match of source.matchAll(/\{\{(\d+)(?::([^}]*))?\}\}/g)) {
            const index = Number(match[1]);
            // Unsupported indices stay literal rather than rounding or becoming Infinity.
            if (!Number.isSafeInteger(index)) continue;
            snippet.appendText(source.slice(offset, match.index));
            if (match[2] !== undefined) snippet.appendPlaceholder(match[2], index);
            // appendTabstop emits $N, which consumes literal digits immediately after it.
            // Only the validated index is raw snippet syntax; HDL text still uses appendText.
            else snippet.value += '${' + index + '}';
            offset = match.index! + match[0].length;
        }
        snippet.appendText(source.slice(offset));
        await editor.insertSnippet(snippet, position, { undoStopBefore: true, undoStopAfter: true });
    }
    async function generate(): Promise<void> {
        if (getActiveCanvas()?.kind === 'st') await vscode.commands.executeCommand('veriflow.exportSimulationTestbench');
        else await vscode.commands.executeCommand('veriflow.newSimulationTask');
    }
    const commands: vscode.Disposable[] = [
        vscode.commands.registerCommand('veriflow.insertHdlTemplate', () => insert()),
        vscode.commands.registerCommand('veriflow.generateTestbench', async () => {
            try { await generate(); } catch (error) { await vscode.window.showErrorMessage(`Generate Testbench: ${error instanceof Error ? error.message : String(error)}`); }
        }),
    ];
    for (const id of ['clock', 'reset', 'timeout', 'waveform']) {
        commands.push(vscode.commands.registerCommand(`veriflow.insertHdlTemplate.${id}`, () => insert(id)));
    }
    return vscode.Disposable.from(...commands);
}
