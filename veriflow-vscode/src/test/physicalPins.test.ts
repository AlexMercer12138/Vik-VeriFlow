import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import Module = require('module');
import { chromium } from 'playwright';
import { createEmptyArchDesign, parseArchDesignText, serializeArchDesign } from '@veriflow/schematic-core/arch-design';
import { UserPhysicalBoardLibrary } from '../archDesign/physicalBoardLibrary';
import { rtlPhysicalPorts } from '../archDesign/physicalPinsSupport';
async function main() {
    const range = (packedRange: string) => ({ name: 'data', direction: 'output' as const, width: { kind: 'unknown' as const }, packedRange });
    assert.deepEqual(rtlPhysicalPorts([range('[LOW:LOW+2]')], [{ name: 'LOW', defaultExpression: '4' }])[0].indices, [4, 5, 6]);
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vf-pin-panel-'));
    const bundled = await fs.access(chromium.executablePath()).then(() => true, () => false), browser = await chromium.launch({ headless: true, ...(!bundled && process.platform === 'win32' ? { channel: 'msedge' } : {}) });
    const loader = Module as unknown as {
        _load: (...args: any[]) => any;
    }, originalLoad = loader._load;
    class Uri {
        scheme = 'file';
        constructor(readonly fsPath: string) { }
        get path() { return this.fsPath.replace(/\\/g, '/'); }
        toString() { return pathToFileURL(this.fsPath).toString(); }
        static file(p: string) { return new Uri(path.resolve(p)); }
    }
    const uri = Uri.file(path.join(root, 'top.ad')), ports = [{ name: 'serial_tx', direction: 'output' as const }, { name: 'serial_rx', direction: 'input' as const }];
    let text = serializeArchDesign({ ...createEmptyArchDesign('top'), ports, defaults: { 'serial_tx.value': "1'b0" } });
    await fs.writeFile(uri.fsPath, text);
    const doc = { uri, version: 1, isDirty: false, getText: () => text, positionAt: (n: number) => n, save: async () => { await fs.writeFile(uri.fsPath, text); doc.isDirty = false; return true; } };
    let panel: any, receive: (m: any) => void = () => { };
    const page = await browser.newPage();
    const errors: string[] = [];
    page.on('pageerror', e => errors.push(e.message));
    class Edit {
        value = '';
        replace(_uri: any, _range: any, value: string) { this.value = value; }
    }
    const mock = { Uri, WorkspaceEdit: Edit, Range: class {
            constructor(..._args: any[]) { }
        }, ViewColumn: { Active: 1 }, workspace: { textDocuments: [doc], openTextDocument: async () => doc, applyEdit: async (e: Edit) => { text = e.value; doc.version++; doc.isDirty = true; return true; } }, window: { createWebviewPanel: () => panel = { webview: { html: '', onDidReceiveMessage: (fn: any) => { receive = fn; return { dispose() { } }; }, postMessage: async (data: any) => { await page.evaluate((data: any) => (globalThis as any).dispatchEvent(new MessageEvent('message', { data })), data); return true; } }, reveal() { }, onDidDispose: () => ({ dispose() { } }), dispose() { } }, showSaveDialog: async () => Uri.file(path.join(root, 'top.xdc')) } };
    loader._load = function (name: string, ...args: any[]) { return name === 'vscode' ? mock : originalLoad.call(this, name, ...args); };
    try {
        const library = new UserPhysicalBoardLibrary({ configPath: path.join(root, 'config.json') });
        library.saveBoard({ id: 'uart', name: 'UART Board', model: { kind: 'board', extension: '.xdc', constraints: 'set_property PACKAGE_PIN A1 [get_ports tx]\nset_property PACKAGE_PIN A2 [get_ports rx]\n', interfaces: [{ id: 'UART0', signals: [{ id: 'tx', direction: 'output', pins: ['A1'] }, { id: 'rx', direction: 'input', pins: ['A2'] }] }] } });
        const { PhysicalPinsPanel } = require('../archDesign/physicalPinsPanel');
        const manager = new PhysicalPinsPanel({}, { ports: async () => ports, library });
        await manager.open(uri);
        await page.exposeFunction('sendMockMessage', (m: any) => receive(m));
        await page.setContent(panel.webview.html.replace(/(<script nonce="[^"]+">)/, '$1\nfunction acquireVsCodeApi(){return{postMessage:m=>window.sendMockMessage(m)}};'));
        await page.locator('#board option[value="user:uart"]').waitFor({ state: 'attached' });
        await page.locator('#board').selectOption('user:uart');
        await page.getByText('UART0', { exact: true }).waitFor();
        await page.locator('#interfaces input[type=checkbox]').first().check();
        await page.getByLabel('UART0 tx port', { exact: true }).waitFor();
        assert.equal(doc.version, 1);
        await page.getByLabel('UART0 tx port', { exact: true }).selectOption('serial_tx');
        await page.waitForFunction(() => (globalThis as any).document.querySelector('#preview').textContent.includes('serial_tx'));
        await page.getByLabel('UART0 rx port', { exact: true }).selectOption('serial_rx');
        await page.waitForFunction(() => !(globalThis as any).document.querySelector('#confirm').disabled);
        await page.locator('#confirm').click();
        await page.waitForFunction(() => (globalThis as any).document.querySelector('#notice').textContent.includes('exported'));
        assert.equal(await fs.readFile(path.join(root, 'top.xdc'), 'utf8'), 'set_property PACKAGE_PIN A1 [get_ports serial_tx]\nset_property PACKAGE_PIN A2 [get_ports serial_rx]\n');
        const parsed = parseArchDesignText(text);
        assert.equal(parsed.status, 'editable');
        if (parsed.status === 'editable')
            assert.equal(parsed.design.physical?.bindings.length, 2);
        await fs.writeFile(path.join(root, 'top.xdc'), 'manual');
        await page.locator('#confirm').click();
        await page.waitForFunction(() => (globalThis as any).document.querySelector('#error').textContent.includes('conflict'));
        assert.equal(await fs.readFile(path.join(root, 'top.xdc'), 'utf8'), 'manual');
        library.saveBoard({ id: 'card', name: 'Serial Card', model: { kind: 'daughtercard', extension: '.xdc', constraints: 'set_property PACKAGE_PIN P1 [get_ports tx]\nset_property PACKAGE_PIN P2 [get_ports rx]\n', interfaces: [{ id: 'UART', signals: [{ id: 'tx', direction: 'output', pins: ['P1'] }, { id: 'rx', direction: 'input', pins: ['P2'] }] }] } });
        await page.locator('#refresh').click();
        await page.waitForFunction(() => (globalThis as any).document.querySelector('#card-profile option[value="user:card"]'));
        await page.locator('#interfaces input[type=checkbox]').first().uncheck();
        await page.waitForFunction(() => (globalThis as any).document.body.dataset.pending === 'false');
        await page.locator('#cards-section summary').click();
        await page.locator('#card-id').fill('serial0');
        await page.locator('#card-profile').selectOption('user:card');
        await page.locator('#add-card').click();
        await page.getByLabel('serial0 P1 carrier pin', { exact: true }).waitFor();
        await page.getByLabel('serial0 P1 carrier pin', { exact: true }).selectOption('A1');
        await page.waitForFunction(() => (globalThis as any).document.body.dataset.pending === 'false');
        await page.getByLabel('serial0 P2 carrier pin', { exact: true }).selectOption('A2');
        await page.waitForFunction(() => (globalThis as any).document.body.dataset.pending === 'false');
        await page.locator('#interfaces .row').filter({ hasText: 'serial0 / UART' }).locator('input[type=checkbox]').first().check();
        await page.getByLabel('serial0 UART tx port', { exact: true }).waitFor();
        await page.getByLabel('serial0 UART tx port', { exact: true }).selectOption('serial_tx');
        await page.waitForFunction(() => (globalThis as any).document.body.dataset.pending === 'false');
        await page.getByLabel('serial0 UART rx port', { exact: true }).selectOption('serial_rx');
        await page.waitForFunction(() => !(globalThis as any).document.querySelector('#confirm').disabled);
        assert.match(await page.locator('#preview').textContent() ?? '', /PACKAGE_PIN A1 \[get_ports serial_tx\]/);
        assert.doesNotMatch(await page.locator('#preview').textContent() ?? '', /PACKAGE_PIN P1/);
        assert.deepEqual(errors, []);
        manager.dispose();
        console.log('Pin browser selects UART, binds AD ports, exports original constraints, protects manual output and maps a daughtercard');
    }
    finally {
        loader._load = originalLoad;
        await browser.close();
        await fs.rm(root, { recursive: true, force: true });
    }
}
main().catch(e => { console.error(e); process.exitCode = 1; });
