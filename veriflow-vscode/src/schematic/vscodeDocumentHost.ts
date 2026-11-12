import * as path from 'node:path';
import * as vscode from 'vscode';
import type { WorkbenchDocumentHost, WorkbenchDocumentSnapshot } from '@veriflow/hdl-runtime/workbench/documentHost';

export class VscodeDocumentHost implements WorkbenchDocumentHost {
    constructor(private readonly document: vscode.TextDocument) {}

    async readText(filepath: string): Promise<WorkbenchDocumentSnapshot> {
        this.assertPath(filepath);
        return { text: this.document.getText(), version: String(this.document.version) };
    }

    async replaceText(filepath: string, expectedVersion: string, nextText: string): Promise<WorkbenchDocumentSnapshot> {
        this.assertPath(filepath);
        if (String(this.document.version) !== expectedVersion) {
            throw new Error(`Document changed since it was read: ${filepath}`);
        }
        const currentText = this.document.getText();
        if (currentText !== nextText) {
            const edit = new vscode.WorkspaceEdit();
            edit.replace(this.document.uri,
                new vscode.Range(this.document.positionAt(0), this.document.positionAt(currentText.length)), nextText);
            if (!await vscode.workspace.applyEdit(edit)) throw new Error('The document could not be updated.');
        }
        return this.readText(filepath);
    }

    private assertPath(filepath: string): void {
        const expected = path.resolve(this.document.uri.fsPath);
        const actual = path.resolve(filepath);
        if (process.platform === 'win32' ? expected.toLowerCase() !== actual.toLowerCase() : expected !== actual) {
            throw new Error(`Document host is not bound to ${filepath}`);
        }
    }
}
