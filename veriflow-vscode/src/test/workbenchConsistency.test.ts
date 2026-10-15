import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';

const manifest = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../package.json'), 'utf8'));
const contributes = manifest.contributes;
const palette = contributes.menus.commandPalette;
assert.equal(palette.length, contributes.commands.length);
assert.equal(palette.find((item: any) => item.command === 'veriflow.simulate').when, 'false');
assert.equal(palette.find((item: any) => item.command === 'veriflow.selectTraditionalTestbench').when, 'true');
assert.equal(palette.find((item: any) => item.command === 'veriflow.runSimulationTask').when, 'activeCustomEditorId == veriflow.simulationTask');
assert.equal(palette.find((item: any) => item.command === 'veriflow.insertHdlTemplate.clock').when, 'false');
assert.ok(contributes.languages.find((item: any) => item.id === 'json').extensions.includes('.st'), 'ST keeps JSON schema support');
assert.deepEqual(contributes.views.veriflow.map((view: any) => view.name), ['Module Browser', 'Architecture Design', 'Simulation Task']);
assert.equal(contributes.views.veriflow[1].icon, contributes.views.veriflow[2].icon);
const titleActions = (view: string) => contributes.menus['view/title'].filter((item: any) => item.when === `view == ${view}`);
for (const [view, command] of [['veriflow.design', 'veriflow.createArchDesign'], ['veriflow.modules', 'veriflow.newSimulationTask']]) {
    assert.deepEqual(titleActions(view).map((item: any) => item.command), [command]);
    assert.equal(contributes.commands.find((item: any) => item.command === command).icon, '$(add)');
    assert.match(contributes.viewsWelcome.find((item: any) => item.view === view).contents, new RegExp(`^\\[Create .+\\]\\(command:${command}\\)$`));
}
assert.deepEqual(titleActions('veriflow.files').map((item: any) => contributes.commands.find((command: any) => command.command === item.command).icon), ['$(refresh)', '$(add)']);
const add = contributes.commands.find((item: any) => item.command === 'veriflow.addModuleToCanvas');
assert.equal(add.enablement, 'veriflow.activeCanvas');
assert.equal(add.title, 'Add to Canvas');
const moduleActions = contributes.menus['webview/context'].filter((item: any) => item.when === 'webviewId == veriflow.files && webviewSection == hdlModule');
assert.deepEqual(moduleActions.map((item: any) => item.command), ['veriflow.addModuleToCanvas', 'veriflow.openModuleBrowserModule', 'veriflow.copyInstantiation']);
const hdlSubmenu = contributes.menus['veriflow.hdl'];
for (const command of ['veriflow.generatePinConstraints', 'veriflow.bindArchDesignPins']) {
    assert.ok(hdlSubmenu.some((item: any) => item.command === command), `${command} is missing from the VeriFlow submenu`);
}
for (const menu of ['editor/context', 'explorer/context']) {
    const entries = contributes.menus[menu];
    assert.equal(entries.filter((item: any) => item.command === 'veriflow.generatePinConstraints').length, 0, `${menu} keeps a standalone pin constraint command`);
    assert.equal(entries.filter((item: any) => item.command === 'veriflow.bindArchDesignPins').length, 0, `${menu} keeps a standalone AD pin binding command`);
    assert.ok(entries.some((item: any) => item.submenu === 'veriflow.hdl'), `${menu} does not expose the VeriFlow submenu`);
}
assert.equal(hdlSubmenu.find((item: any) => item.command === 'veriflow.generatePinConstraints').when, 'resourceExtname == .v || resourceExtname == .sv');
assert.equal(hdlSubmenu.find((item: any) => item.command === 'veriflow.bindArchDesignPins').when, 'resourceExtname == .ad');
for (const entries of Object.values(contributes.menus) as any[][]) {
    for (const entry of entries) if (entry.command) assert.ok(contributes.commands.some((command: any) => command.command === entry.command), `Undeclared menu command: ${entry.command}`);
}
console.log('Workbench view and command consistency tests passed');
