import * as vscode from 'vscode';
import { hdlTemplates } from '@veriflow/flow-core';
import { getActiveCanvas } from '../workbench/moduleTargets';

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
        const template = id ? hdlTemplates.find(item => item.id === id) : await vscode.window.showQuickPick(
            hdlTemplates, { title: 'Insert HDL Template', matchOnDescription: true });
        if (!template) return;
        if ((editor.document.uri.scheme !== 'untitled' && vscode.workspace.fs.isWritableFileSystem(editor.document.uri.scheme) === false) || editor.document.isClosed || editor.document.version !== version || vscode.window.activeTextEditor !== editor || editor.selections.length !== 1 || !editor.selection.isEqual(selection)) {
            await vscode.window.showInformationMessage('The editor changed. Run Insert HDL Template again.'); return;
        }
        // appendText escapes HDL $tasks and backslashes; no syntax-position detection.
        const eol = editor.document.eol === vscode.EndOfLine.CRLF ? '\r\n' : '\n';
        const snippet = new vscode.SnippetString();
        const source = (template.snippet ?? template.text).replace(/\n/g, eol);
        let offset = 0;
        for (const match of source.matchAll(/\{\{(\d+)(?::([^}]*))?\}\}/g)) {
            snippet.appendText(source.slice(offset, match.index));
            if (match[2] !== undefined) snippet.appendPlaceholder(match[2], Number(match[1]));
            else snippet.appendTabstop(Number(match[1]));
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
