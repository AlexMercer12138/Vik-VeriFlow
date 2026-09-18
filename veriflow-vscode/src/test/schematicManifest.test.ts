import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';

const extensionRoot = path.resolve(__dirname, '..', '..');
const manifest = JSON.parse(
    fs.readFileSync(path.join(extensionRoot, 'package.json'), 'utf8')
);
const extensionSource = fs.readFileSync(
    path.join(extensionRoot, 'src', 'extension.ts'),
    'utf8'
);
const editor = manifest.contributes.customEditors.find(
    (item: any) => item.viewType === 'veriflow.schematicEditor'
);
const archDesignEditor = manifest.contributes.customEditors.find(
    (item: any) => item.viewType === 'veriflow.archDesignEditor'
);
const explorerCommand = (manifest.contributes.menus['explorer/context'] ?? []).find(
    (item: any) => item.command === 'veriflow.openSchematicFromExplorer'
);
const editorTitleCommand = (manifest.contributes.menus['editor/title'] ?? []).find(
    (item: any) => item.command === 'veriflow.openSchematic'
);

assert.ok(explorerCommand, 'Explorer schematic command menu contribution is missing');
assert.match(explorerCommand.when, /resourceExtname\s*==\s*\.v\b/);
assert.match(explorerCommand.when, /resourceExtname\s*==\s*\.sv\b/);
assert.ok(editorTitleCommand, 'editor-title schematic command menu contribution is missing');
assert.match(editorTitleCommand.when, /editorLangId\s*==\s*verilog\b/);
assert.match(editorTitleCommand.when, /editorLangId\s*==\s*systemverilog\b/);
assert.ok(editor, 'schematic custom editor contribution is missing');
assert.strictEqual(editor.priority, 'option');
assert.deepStrictEqual(
    editor.selector.map((item: any) => item.filenamePattern),
    ['*.v', '*.sv']
);
assert.ok(archDesignEditor, 'Arch Design custom editor contribution is missing');
assert.strictEqual(archDesignEditor.priority, 'default');
assert.deepStrictEqual(
    archDesignEditor.selector.map((item: any) => item.filenamePattern),
    ['*.ad']
);
// VS Code >= 1.74 automatically activates contributed views, commands and editors.
assert.ok(manifest.contributes.views.veriflow.some((view: any) => view.id === 'veriflow.design'));
assert.ok(manifest.contributes.commands.some((command: any) => command.command === 'veriflow.createArchDesign'));
const archDesignLanguage = (manifest.contributes.languages ?? []).find(
    (item: any) => item.id === 'arch-design'
);
assert.ok(archDesignLanguage, 'Arch Design language contribution is missing');
assert.deepStrictEqual(archDesignLanguage.extensions, ['.ad']);
const workflowViews = manifest.contributes.views.veriflow;
assert.deepStrictEqual(
    workflowViews.map((item: any) => item.id),
    ['veriflow.files', 'veriflow.design', 'veriflow.modules']
);
assert.deepStrictEqual(workflowViews.map((item: any) => item.name), ['Module Browser', 'Architecture Design', 'Simulation Task']);
assert.deepStrictEqual(workflowViews.map((item: any) => item.contextualTitle), ['Module Browser', 'Architecture Design', 'Simulation Task']);
assert.deepStrictEqual(manifest.contributes.menus['veriflow.hdl'].map((item: any) => item.command), [
    'veriflow.insertHdlTemplate', 'veriflow.instantiateModule', 'veriflow.formatHdl', 'veriflow.runTraditionalTestbench',
]);
for (const setting of ['veriflow.simulator', 'veriflow.waveViewer']) {
    assert.deepStrictEqual(manifest.contributes.configuration.properties[setting].enum, ['builtin', 'custom']);
}

for (const id of [
    'veriflow.createArchDesign',
    'veriflow.refreshArchDesigns',
    'veriflow.openArchDesign',
]) {
    assert.ok(
        manifest.contributes.commands.some((item: any) => item.command === id),
        `${id} command contribution is missing`
    );
}
const archDesignWelcome = (manifest.contributes.viewsWelcome ?? []).find(
    (item: any) => item.view === 'veriflow.design'
);
assert.ok(archDesignWelcome, 'Arch Designs empty-state contribution is missing');
assert.match(
    archDesignWelcome.contents,
    /\[Create Architecture Design\]\(command:veriflow\.createArchDesign\)/
);
for (const id of ['veriflow.createArchDesign']) {
    assert.ok(
        (manifest.contributes.menus['view/title'] ?? []).some(
            (item: any) => item.command === id
                && /view\s*==\s*veriflow\.design\b/.test(item.when)
        ),
        `${id} Arch Designs title action is missing`
    );
}
for (const id of [
    'veriflow.openArchDesign',
    'veriflow.validateArchDesign',
    'veriflow.exportArchDesign',
]) {
    assert.ok(
        (manifest.contributes.menus['view/item/context'] ?? []).some(
            (item: any) => item.command === id
                && /viewItem\s*==\s*archDesignFile\b/.test(item.when)
        ),
        `${id} Arch Design item action is missing`
    );
}
for (const id of ['veriflow.validateArchDesign', 'veriflow.exportArchDesign']) {
    assert.ok(
        manifest.contributes.commands.some((item: any) => item.command === id),
        `${id} command contribution is missing`
    );
    assert.ok(
        !(manifest.contributes.menus['editor/title'] ?? []).some(
            (item: any) => item.command === id
        ),
        `${id} must not duplicate the in-editor toolbar`
    );
}
assert.match(
    extensionSource,
    /validate:\s*uri\s*=>\s*archDesignEditorProvider\.validate\(uri\)/
);
assert.match(
    extensionSource,
    /exportRtl:\s*uri\s*=>\s*archDesignEditorProvider\.exportRtl\(uri\)/
);
assert.match(
    extensionSource,
    /\['veriflow\.validateArchDesign',[\s\S]*?archDesignCommands\.validate\(uri\)/
);
assert.match(
    extensionSource,
    /\['veriflow\.exportArchDesign',[\s\S]*?archDesignCommands\.exportRtl\(uri\)/
);
for (const id of ['veriflow.openSchematic', 'veriflow.openSchematicFromExplorer']) {
    assert.ok(
        manifest.contributes.commands.some((item: any) => item.command === id),
        `${id} command contribution is missing`
    );
}

console.log('schematic manifest tests passed');
