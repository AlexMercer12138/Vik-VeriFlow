import * as vscode from 'vscode';
import * as path from 'path';
import { getActiveCanvas } from '../workbench/moduleTargets';
import { ArchDesignEditorProvider } from './archDesignEditorProvider';
import { createArchDesignCommandHandlers } from './archDesignCommands';
import { createArchDesign } from './archDesignCreation';
import type { PhysicalPinsPanel } from './physicalPinsPanel';

export function registerArchDesignCommands(services: {
    provider: Pick<ArchDesignEditorProvider, 'validate' | 'exportRtl' | 'build'>;
    pins: Pick<PhysicalPinsPanel, 'open' | 'manageBoards'>;
    refresh(): void;
}): vscode.Disposable {
    const resource = (value: unknown): vscode.Uri | undefined => {
        if (value instanceof vscode.Uri) return value;
        const uri = (value as { resourceUri?: unknown } | undefined)?.resourceUri;
        return uri instanceof vscode.Uri ? uri : undefined;
    };
    const openEditor = async (uri: vscode.Uri): Promise<void> => {
        await vscode.commands.executeCommand('vscode.openWith', uri, ArchDesignEditorProvider.viewType);
    };
    const handlers = createArchDesignCommandHandlers<vscode.Uri>({
        isResource: (value): value is vscode.Uri => value instanceof vscode.Uri,
        openEditor,
        validate: uri => services.provider.validate(uri),
        exportRtl: uri => services.provider.exportRtl(uri),
    });
    const report = (error: unknown) => vscode.window.showErrorMessage(error instanceof Error ? error.message : String(error));
    const commands: Array<[string, (...args: unknown[]) => unknown]> = [
        ['veriflow.createArchDesign', async () => {
            const created = await createArchDesign<vscode.Uri>({
                filename: target => path.basename(target.fsPath),
                requestTarget: () => vscode.window.showSaveDialog({
                    title: 'Create Arch Design', saveLabel: 'Create',
                    defaultUri: vscode.workspace.workspaceFolders?.[0]
                        ? vscode.Uri.joinPath(vscode.workspace.workspaceFolders[0].uri, 'design.ad') : undefined,
                    filters: { 'Arch Design': ['ad'] },
                }),
                writeFile: async (target, text) => {
                    if (!target.path.toLowerCase().endsWith('.ad')) throw new Error('Use a .ad filename.');
                    const edit = new vscode.WorkspaceEdit();
                    edit.createFile(target, { overwrite: false });
                    edit.insert(target, new vscode.Position(0, 0), text);
                    if (!await vscode.workspace.applyEdit(edit)) throw new Error('The file already exists or cannot be created.');
                    if (!await (await vscode.workspace.openTextDocument(target)).save()) throw new Error('Save the new AD before continuing.');
                },
                openEditor,
                reportError: async message => { await vscode.window.showErrorMessage(`Unable to create Arch Design: ${message}`); },
            });
            if (created) services.refresh();
            return created;
        }],
        ['veriflow.refreshArchDesigns', () => services.refresh()],
        ['veriflow.openArchDesign', value => handlers.open(value)],
        ['veriflow.validateArchDesign', value => handlers.validate(value)],
        ['veriflow.exportArchDesign', value => handlers.exportRtl(value)],
        ['veriflow.buildArchDesign', async value => {
            const canvas = getActiveCanvas();
            const uri = resource(value) ?? (canvas?.kind === 'ad' ? canvas.uri : undefined);
            if (uri) await openEditor(uri);
            await services.provider.build(uri);
        }],
        ['veriflow.bindArchDesignPins', value => services.pins.open(resource(value) ?? getActiveCanvas()?.uri).catch(report)],
        ['veriflow.generatePinConstraints', value => services.pins.open(resource(value)).catch(report)],
        ['veriflow.manageBoards', () => services.pins.manageBoards().catch(report)],
    ];
    const registrations = commands.map(([name, handler]) => vscode.commands.registerCommand(name, handler));
    return { dispose: () => registrations.forEach(registration => registration.dispose()) };
}
