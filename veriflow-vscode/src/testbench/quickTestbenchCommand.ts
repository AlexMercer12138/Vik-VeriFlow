import * as vscode from 'vscode';
import * as path from 'path';
import { defaultTestbenchConfig, TestbenchGenerator } from '@veriflow/hdl-runtime/hdl';
import type { WorkspaceHdlIndex } from '@veriflow/hdl-runtime/workspaceHdlIndex';
import { snapshotIndexedInputs, checkArtifactPlan } from '@veriflow/hdl-runtime/archDesign';
import { canonicalizeSourceUri } from '@veriflow/hdl-core/preprocessor';

export function registerQuickTestbenchCommand(services: {
    getIndex(uri: vscode.Uri, owner: object): Promise<WorkspaceHdlIndex | undefined>;
    release(owner: object): void;
}): vscode.Disposable {
    return vscode.commands.registerCommand('veriflow.generateQuickTestbench', async (value?: vscode.Uri | { resourceUri?: vscode.Uri }) => {
        const owner = {};
        try {
            const uri = value instanceof vscode.Uri ? value : value?.resourceUri ?? vscode.window.activeTextEditor?.document.uri;
            if (!uri || !/\.(v|sv)$/i.test(uri.path)) throw new Error('Choose a .v or .sv file');
            const document = await vscode.workspace.openTextDocument(uri);
            if (document.isDirty && !await document.save()) throw new Error('Save the HDL source before generating a TB');
            const version = document.version;
            const index = await services.getIndex(uri, owner);
            const definitions = index?.getAllDefinitions('module').filter(item => canonicalizeSourceUri(item.uri) === canonicalizeSourceUri(uri.toString())) ?? [];
            const chosen = definitions.length === 1 ? definitions[0] : (await vscode.window.showQuickPick(
                definitions.map(definition => ({ label: definition.name, definition })), { title: 'Generate Testbench — select module' }))?.definition;
            if (!chosen) return;
            const inputs = await snapshotIndexedInputs(index!, [chosen.uri]);
            const config = defaultTestbenchConfig(chosen);
            const target = await vscode.window.showSaveDialog({ title: 'Generate Testbench',
                defaultUri: vscode.Uri.file(path.join(path.dirname(uri.fsPath), config.name + '.v')), filters: { Verilog: ['v'] } });
            if (!target) return;
            if (document.isDirty || document.version !== version) throw new Error('HDL changed; generate the TB again');
            await checkArtifactPlan({ diagnostics: [], inputs, artifacts: [] });
            const text = `// veriflow:hdl-source ${JSON.stringify(uri.fsPath.replace(/\\/g, '/'))}\n` + new TestbenchGenerator().render(config);
            const edit = new vscode.WorkspaceEdit();
            edit.createFile(target, { overwrite: false }); edit.insert(target, new vscode.Position(0, 0), text);
            if (!await vscode.workspace.applyEdit(edit)) throw new Error('Choose a new filename; an existing file cannot be replaced');
            const output = await vscode.workspace.openTextDocument(target);
            if (!await output.save()) throw new Error('Unable to save the generated testbench');
            await vscode.window.showTextDocument(output);
        } catch (error) { await vscode.window.showErrorMessage(`Generate Testbench: ${error instanceof Error ? error.message : String(error)}`); }
        finally { services.release(owner); }
    });
}
