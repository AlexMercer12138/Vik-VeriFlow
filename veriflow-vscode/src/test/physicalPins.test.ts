import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import Module = require('module');
import { chromium, type Page } from 'playwright';
import { applyArchDesignEdit, createEmptyArchDesign, parseArchDesignText, serializeArchDesign } from '@veriflow/schematic-core/arch-design';
import { createInterfaceProtocolCatalog } from '@veriflow/schematic-core/interfaces';
import { adPhysicalPorts, rtlPhysicalPorts } from '../archDesign/physicalPinsSupport';
import { archDesignXdcOutputPath } from '../archDesign/archDesignExport';
function verifyPortsAndPaths(): void {
    const port = (packedRange?: string) => ({ name: 'data', direction: 'output' as const, width: { kind: 'unknown' as const }, packedRange });
    assert.deepEqual(rtlPhysicalPorts([port('[LOW:LOW+2]')], [{ name: 'LOW', defaultExpression: '4' }])[0].indices, [4, 5, 6]);
    assert.deepEqual(rtlPhysicalPorts([port('[W-1:0]')], [{ name: 'W', defaultExpression: '3' }])[0].indices, [2, 1, 0]);
    assert.equal(rtlPhysicalPorts([port('[missing:0]')])[0].unresolved, true);
    assert.equal(rtlPhysicalPorts([port('[1:0][3:0]')])[0].unresolved, true);
    assert.equal(rtlPhysicalPorts([port('[5000:0]')])[0].unresolved, true);
    const design = { ...createEmptyArchDesign('top'), interfacePorts: [{ name: 'm', protocol: 'amba.axis', role: 'master' as const, memberPrefix: 'M', members: [{ member: 'tdata', width: 3 }] }] };
    assert.deepEqual(adPhysicalPorts(design, [], createInterfaceProtocolCatalog()), [{ name: 'M_tdata', direction: 'output', indices: [2, 1, 0] }]);
    const owner = path.resolve('project', 'top.ad');
    assert.equal(archDesignXdcOutputPath(owner, design), path.resolve('project', 'top.xdc'));
    const configured = { ...design, export: { language: 'systemverilog' as const, output: 'generated/custom.sv' } };
    assert.equal(archDesignXdcOutputPath(owner, configured), path.resolve('project', 'generated', 'custom.xdc'));
    assert.equal(archDesignXdcOutputPath(owner, { ...configured, export: { ...configured.export, xdcOutput: 'pins/board.xdc' } }), path.resolve('project', 'pins', 'board.xdc'));
    assert.throws(() => archDesignXdcOutputPath(owner, { ...design, export: { xdcOutput: 'wrong.txt' } }), /\.xdc/);
}
async function main(): Promise<void> {
    verifyPortsAndPaths();
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'veriflow-physical-pins-'));
    const bundledBrowser = await fs.access(chromium.executablePath()).then(() => true, () => false);
    const browser = await chromium.launch({ headless: true, ...(!bundledBrowser && process.platform === 'win32' ? { channel: 'msedge' } : {}) });
    const loader = Module as unknown as { _load: (...args: any[]) => any }, originalLoad = loader._load;
    class Uri {
        readonly scheme = 'file'; readonly authority = '';
        constructor(readonly fsPath: string) {}
        get path(): string { return new URL(this.toString()).pathname; }
        toString(): string { return pathToFileURL(this.fsPath).toString(); }
        static file(value: string): Uri { return new Uri(path.resolve(value)); }
    }
    const listeners = new Set<(event: any) => void>(), watchCallbacks = new Set<(uri: Uri) => void>(), documents = new Map<string, Document>(), panels: any[] = [];
    class Document {
        version = 1; isDirty = false;
        constructor(readonly uri: Uri, private text: string) {}
        getText(): string { return this.text; }
        positionAt(offset: number): number { return offset; }
        change(text: string): void { this.text = text; this.isDirty = true; this.version++; listeners.forEach(listener => listener({ document: this, contentChanges: [{}] })); }
        async save(): Promise<boolean> { if (cancelAdSave) return false; await fs.writeFile(this.uri.fsPath, this.text); this.isDirty = false; return true; }
    }
    const noop = () => ({ dispose() {} });
    let applyCount = 0, saveTarget = Uri.file(path.join(directory, 'quick.xdc')), cancelSave = false, cancelAdSave = false, saveDialogs = 0;
    const mock = {
        Uri, ViewColumn: { Active: 1 }, RelativePattern: class { constructor(readonly base: string, readonly pattern: string) {} }, Range: class {},
        WorkspaceEdit: class { uri?: Uri; text?: string; replace(uri: Uri, _range: unknown, text: string) { this.uri = uri; this.text = text; } },
        workspace: {
            openTextDocument: async (uri: Uri) => documents.get(uri.toString()) ?? { uri, getText: async () => fs.readFile(uri.fsPath, 'utf8') },
            applyEdit: async (edit: any) => { applyCount++; documents.get(edit.uri.toString())!.change(edit.text); return true; },
            onDidChangeTextDocument: (listener: (event: any) => void) => { listeners.add(listener); return { dispose() { listeners.delete(listener); } }; },
            createFileSystemWatcher: () => {
                const onChange = (callback: (uri: Uri) => void) => { watchCallbacks.add(callback); return { dispose() { watchCallbacks.delete(callback); } }; };
                return { dispose() {}, onDidChange: onChange, onDidCreate: onChange, onDidDelete: onChange };
            },
        },
        window: {
            showSaveDialog: async (options: any) => { saveDialogs++; assert.equal(options.title, 'Save Pin Constraints'); return cancelSave ? undefined : saveTarget; },
            showTextDocument: async () => undefined,
            createWebviewPanel: () => {
                let receive: (message: any) => void, disposeCallback: () => void = () => undefined;
                const panel = { page: undefined as Page | undefined, messages: [] as any[], webview: { html: '',
                    onDidReceiveMessage: (handler: (message: any) => void) => { receive = handler; return noop(); },
                    postMessage: async (message: any) => { if (panel.page) await panel.page.evaluate(m => (globalThis as any).window.dispatchEvent(new MessageEvent('message', { data: m })), message); return true; },
                }, receive: (message: any) => { panel.messages.push(message); receive(message); }, onDidDispose: (handler: () => void) => { disposeCallback = handler; return noop(); }, dispose: () => disposeCallback(), reveal() {} };
                panels.push(panel); return panel;
            },
        },
    };
    loader._load = function(name: string, ...args: any[]): any { return name === 'vscode' ? mock : originalLoad.call(this, name, ...args); };
    try {
        const { UserPhysicalBoardLibrary } = require('../archDesign/physicalBoardLibrary');
        const { PhysicalPinsPanel } = require('../archDesign/physicalPinsPanel');
        const repositoryRoot = path.resolve(__dirname, '../../..'), extensionRoot = path.join(directory, 'extension');
        const interfaceRoot = path.join(extensionRoot, 'resources/physical-models/interfaces');
        await fs.mkdir(interfaceRoot, { recursive: true });
        await fs.cp(path.join(repositoryRoot, 'data/physical-models/interfaces'), interfaceRoot, { recursive: true });
        const library = new UserPhysicalBoardLibrary({ configPath: path.join(directory, 'user.json'), interfaceRoot });
        await library.importBoard(path.join(repositoryRoot, 'data/physical-models/boards/atk-au15p/board.json'), 'ATK AU15P', 'atk-au15p');
        const saved = JSON.parse(await fs.readFile(library.configPath, 'utf8'));
        const blocked = structuredClone(saved.boards[0]);
        blocked.id = 'group-lock'; blocked.name = 'Mandatory group test';
        blocked.model.interfaces.find((i: any) => i.id === 'J16').definition = 'header40.expansion.json';
        blocked.definitions['header40.expansion.json'] = JSON.parse(await fs.readFile(path.join(interfaceRoot, 'header40.expansion.json'), 'utf8'));
        blocked.definitions['header40.expansion.json'].groups = [{ id: 'gpio_pair', members: ['6', '8'], selection: 'together' }];
        saved.boards.push(blocked); await fs.writeFile(library.configPath, JSON.stringify(saved));
        const ports = [...['p', 'n'].map(leg => ({ name: 'tmds_data_' + leg, direction: 'output' as const, indices: [2, 1, 0] })), ...['p', 'n'].map(leg => ({ name: 'tmds_clock_' + leg, direction: 'output' as const, indices: undefined }))];
        const adUri = Uri.file(path.join(directory, 'video.ad')), rtlUri = Uri.file(path.join(directory, 'quick.sv'));
        const adText = serializeArchDesign({ ...createEmptyArchDesign('video'), ports: ports.map(p => ({ name: p.name, direction: p.direction, width: p.indices?.length ?? 1 })), export: { language: 'systemverilog', output: 'generated/video.sv' } });
        const rtlText = 'module quick(output [2:0] tmds_data_p, tmds_data_n); endmodule\n';
        documents.set(adUri.toString(), new Document(adUri, adText)); documents.set(rtlUri.toString(), new Document(rtlUri, rtlText));
        await fs.writeFile(adUri.fsPath, adText); await fs.writeFile(rtlUri.fsPath, rtlText);
        const manager = new PhysicalPinsPanel({ extensionUri: Uri.file(extensionRoot) }, { ports: async () => ports, library });
        assert.equal((await manager.loadBoard(adUri, 'user:atk-au15p')).model.device, 'xcau15p-ffvb676-2-i');
        assert.equal(Object.keys(saved.boards[0].definitions).length, 7, 'generic interfaces are library references, not per-board snapshots');
        await assert.rejects(() => manager.loadBoard(adUri, 'library:boards/atk-au15p/board.json'), /workspace board/);
        const ready = async (page: Page) => { await page.waitForFunction(() => (globalThis as any).document.body.dataset.pending === 'false'); };
        const expand = async (page: Page, iface: string) => { await page.locator('details[data-iface="' + iface + '"]').evaluate((element: any) => { element.open = true; }); };
        const settings = async (page: Page, selector: string, value: string) => { await page.locator(selector).selectOption(value); await ready(page); };
        const checkbox = (page: Page, name: string) => page.getByRole('checkbox', { name, exact: true });
        const launch = async (uri: Uri): Promise<Page> => {
            await manager.open(uri);
            const panel = panels[panels.length - 1], page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
            panel.page = page; page.setDefaultTimeout(15000);
            await page.exposeFunction('sendMockMessage', (message: any) => panel.receive(message));
            await page.setContent(panel.webview.html.replace(/(<script nonce="[^"]+">)/, '$1\nfunction acquireVsCodeApi(){return{postMessage:message=>window.sendMockMessage(message)}};'));
            await page.locator('#board option[value="user:atk-au15p"]').waitFor({ state: 'attached' });
            return page;
        };
        const page = await launch(adUri);
        await settings(page, '#board', 'user:group-lock');
        assert.equal(await page.locator('main.columns > section').count(), 3);
        assert.equal(await page.locator('.signal').count(), 0);
        await settings(page, 'select[data-rail="VCCIO_B85"]', '3300');
        await expand(page, 'CAN1'); await expand(page, 'J16');
        await checkbox(page, 'CAN1 / tx').check(); await ready(page);
        assert.equal(await checkbox(page, 'J16 / 8').isDisabled(), true, 'selecting without any RTL assignment must reserve J10');
        assert.equal(await checkbox(page, 'J16 / 6').isDisabled(), true, 'one conflicting member disables its complete mandatory group');
        assert.equal(await checkbox(page, 'J16 / gpio_pair').isDisabled(), true);
        assert.equal(applyCount, 0, 'selection is a draft');
        await checkbox(page, 'CAN1 / tx').uncheck(); await ready(page);
        assert.equal(await checkbox(page, 'J16 / 6').isEnabled(), true, 'deselecting releases the group');
        await settings(page, '#board', 'user:atk-au15p');
        await settings(page, 'select[data-rail="VCCIO_B64"]', '1800');
        await expand(page, 'HDMI_OUT');
        await checkbox(page, 'HDMI_OUT / data_p[2:0] / data_n[2:0]').evaluate((element: any) => { element.closest('details').open = true; });
        await checkbox(page, 'HDMI_OUT / data_p[1] / data_n[1]').check(); await ready(page);
        assert.equal(await page.locator('.signal').count(), 1, 'individual lanes remain selectable');
        assert.match(await page.locator('.signal-info').textContent() ?? '', /data_p\[1\] \/ data_n\[1\]/);
        await checkbox(page, 'HDMI_OUT / data_p[2:0] / data_n[2:0]').check(); await ready(page);
        assert.equal(await page.locator('.signal').count(), 1, 'P/N share one assignment slot');
        assert.match(await page.locator('.signal-info').textContent() ?? '', /data_p\[2:0\] \/ data_n\[2:0\]/);
        assert.equal(await checkbox(page, 'HDMI_OUT / ddc_scl').count(), 0, 'unconnected template signals are omitted by the board subset');
        assert.equal(await page.locator('#confirm').isDisabled(), true, 'selected signals require assignments');
        const source = page.locator('.port[data-port="tmds_data_n"]'), target = page.locator('.signal[data-signal="data_p"]');
        await source.dragTo(target); await ready(page);
        assert.equal(await page.locator('.port[data-port="tmds_data_p"] .mapped').textContent(), 'HDMI_OUT.data_p[2:0]');
        assert.equal(await page.locator('.port[data-port="tmds_data_n"] .mapped').textContent(), 'HDMI_OUT.data_n[2:0]');
        assert.equal(await page.getByRole('button', { name: 'Bind', exact: true }).count(), 0);
        assert.equal(await page.getByRole('button', { name: 'Clear', exact: true }).count(), 0);
        assert.equal(await page.locator('select[data-selector]').count(), 0);
        assert.equal(await page.locator('#confirm').isDisabled(), true, 'ports alone must not guess IO standards');
        const standard = '.signal[data-signal="data_p"] select[data-standard]';
        assert.ok((await page.locator(standard).locator('option').allTextContents()).some(s => s.includes('LVDS')));
        assert.ok(!(await page.locator(standard).locator('option').allTextContents()).some(s => s.includes('TMDS_33')));
        await settings(page, standard, 'LVDS');
        assert.equal(await page.locator('#confirm').isEnabled(), true, await page.locator('#issues').textContent() ?? '');
        await settings(page, 'select[data-rail="VCCIO_B64"]', '1200');
        assert.equal(await page.locator('#confirm').isDisabled(), true, 'Bank voltage takes priority over an existing standard');
        assert.equal(await page.locator(standard + ' option[value="LVDS"]').isDisabled(), true);
        assert.ok(!(await page.locator(standard).locator('option:not(:disabled)').allTextContents()).some(s => s.includes('LVDS')));
        await settings(page, 'select[data-rail="VCCIO_B64"]', '1800');
        assert.equal(await page.locator('#confirm').isEnabled(), true);
        assert.ok((await page.locator('.signal').first().boundingBox())!.height < 85, 'signal assignment must fit two compact lines');
        await settings(page, '.signal[data-signal="data_p"] select[data-port-select]', '');
        assert.equal(await page.locator('#confirm').isDisabled(), true, 'empty port dropdown clears P/N bindings');
        await page.locator('.port[data-port="tmds_data_p"]').dragTo(page.locator('.signal[data-signal="data_p"]')); await ready(page);
        assert.equal(await page.locator('#confirm').isEnabled(), true);
        assert.equal(applyCount, 0, 'assignments must not edit AD before confirmation');
        assert.equal(documents.get(adUri.toString())!.getText(), adText);
        assert.equal(await fs.readFile(adUri.fsPath, 'utf8'), adText);
        saved.boards[0].name = 'ATK AU15P updated';
        await fs.writeFile(library.configPath, JSON.stringify(saved)); watchCallbacks.forEach(callback => callback(Uri.file(library.configPath)));
        await page.waitForFunction(() => (globalThis as any).document.querySelector('#board option[value="user:atk-au15p"]')?.textContent === 'ATK AU15P updated');
        await ready(page); assert.equal(await page.locator('#confirm').isEnabled(), true, 'library refresh preserves unconfirmed assignments');
        if (process.env.VERIFLOW_PIN_SCREENSHOT) await page.screenshot({ path: process.env.VERIFLOW_PIN_SCREENSHOT, fullPage: true });
        const xdc = path.join(directory, 'generated/video.xdc');
        await fs.mkdir(path.dirname(xdc), { recursive: true }); await fs.writeFile(xdc, '# hand-written AD constraints\n');
        await page.click('#confirm'); await ready(page);
        assert.match(await page.locator('#error').textContent() ?? '', /Generated file conflict/);
        assert.equal(applyCount, 0, 'an existing output conflict must not commit AD drafts');
        await fs.unlink(xdc);
        cancelAdSave = true;
        await page.click('#confirm'); await ready(page);
        assert.match(await page.locator('#error').textContent() ?? '', /Save AD/);
        await assert.rejects(() => fs.stat(xdc), /ENOENT/);
        cancelAdSave = false;
        await page.click('#confirm'); await ready(page);
        assert.equal(saveDialogs, 0, 'AD confirmation uses its configured output path');
        const exported = await fs.readFile(xdc, 'utf8');
        assert.match(exported, /PACKAGE_PIN AB17 \[get_ports \{tmds_data_p\[2\]\}\]/);
        assert.match(exported, /PACKAGE_PIN AC17 \[get_ports \{tmds_data_n\[2\]\}\]/);
        const stored = parseArchDesignText(await fs.readFile(adUri.fsPath, 'utf8'));
        assert.equal(stored.status, 'editable');
        if (stored.status !== 'editable') throw new Error('invalid AD');
        assert.equal(stored.design.physical?.board, 'user:atk-au15p'); assert.equal(stored.design.physical?.bindings.length, 6);
        assert.equal(stored.design.physical?.ioStandards?.length, 6);
        assert.equal(stored.design.physical?.selections?.[0].members.length, 6); assert.equal(documents.get(adUri.toString())!.isDirty, false);
        panels[0].dispose();
        const reopened = await launch(adUri);
        assert.equal(await reopened.locator('#confirm').isEnabled(), true, 'reopening restores selections and assignments');
        const beforeQuick = applyCount, quick = await launch(rtlUri);
        await settings(quick, '#board', 'user:atk-au15p');
        await settings(quick, 'select[data-rail="VCCIO_B64"]', '1800');
        await expand(quick, 'HDMI_OUT');
        await checkbox(quick, 'HDMI_OUT / data_p[2:0] / data_n[2:0]').check(); await ready(quick);
        await settings(quick, '.signal[data-signal="data_p"] select[data-port-select]', 'tmds_data_p');
        await settings(quick, '.signal[data-signal="data_p"] select[data-standard]', 'LVDS');
        assert.equal(applyCount, beforeQuick); assert.equal(await fs.readFile(rtlUri.fsPath, 'utf8'), rtlText);
        cancelSave = true; await quick.click('#confirm'); await ready(quick);
        assert.equal(await quick.locator('#confirm').isEnabled(), true);
        cancelSave = false; await fs.writeFile(saveTarget.fsPath, '# handwritten constraints\n');
        await quick.click('#confirm'); await ready(quick);
        assert.match(await quick.locator('#error').textContent() ?? '', /Generated file conflict/);
        assert.equal(await fs.readFile(saveTarget.fsPath, 'utf8'), '# handwritten constraints\n');
        saveTarget = Uri.file(path.join(directory, 'exported-quick.xdc'));
        await quick.click('#confirm'); await ready(quick);
        assert.match(await fs.readFile(saveTarget.fsPath, 'utf8'), /vik-veriflow:generated xdc source=/);
        assert.equal(applyCount, beforeQuick, 'RTL confirmation must not store any binding model');
        manager.dispose(); assert.equal(listeners.size, 0);
        console.log('User board choices, three-column selection locks, draft assignments, P/N bus drag, AD confirm/reopen, RTL save/cancel and output ownership passed');
    } finally {
        loader._load = originalLoad; await browser.close();
        assert.equal(path.dirname(directory), os.tmpdir());
        await fs.rm(directory, { recursive: true, force: true });
    }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
