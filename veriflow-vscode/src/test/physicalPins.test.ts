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
    const loader = Module as unknown as {
        _load: (...args: any[]) => any;
    }, originalLoad = loader._load;
    class Uri {
        readonly scheme = 'file';
        readonly authority = '';
        constructor(readonly fsPath: string) { }
        get path(): string { return new URL(this.toString()).pathname; }
        toString(): string { return pathToFileURL(this.fsPath).toString(); }
        with(value: {
            path: string;
        }): Uri { return new Uri(decodeURIComponent(value.path).replace(/^\/([A-Za-z]:)/, '$1')); }
        static file(value: string): Uri { return new Uri(path.resolve(value)); }
        static joinPath(base: Uri, ...parts: string[]): Uri { return new Uri(path.resolve(base.fsPath, ...parts)); }
    }
    class Document {
        version = 1;
        isDirty = false;
        constructor(readonly uri: Uri, private text: string) { }
        getText(): string { return this.text; }
        positionAt(offset: number): number { return offset; }
        change(text: string): void { this.text = text; this.isDirty = true; this.version++; for (const listener of listeners)
            listener({ document: this, contentChanges: [{}] }); }
        async save(): Promise<boolean> { await fs.writeFile(this.uri.fsPath, this.text); this.isDirty = false; return true; }
    }
    const listeners = new Set<(event: any) => void>(), documents = new Map<string, Document>(), panels: any[] = [];
    const noop = () => ({ dispose() { } });
    let applyCount = 0, saveTarget = Uri.file(path.join(directory, 'quick.xdc')), cancelSave = false;
    const mock = {
        Uri, FileType: { File: 1, Directory: 2 }, ViewColumn: { Beside: 2 }, Range: class {
        },
        WorkspaceEdit: class {
            uri?: Uri;
            text?: string;
            replace(uri: Uri, _range: unknown, text: string) { this.uri = uri; this.text = text; }
        },
        workspace: {
            fs: { readFile: (uri: Uri) => fs.readFile(uri.fsPath), readDirectory: async (uri: Uri) => (await fs.readdir(uri.fsPath, { withFileTypes: true })).map(e => [e.name, e.isDirectory() ? 2 : 1]) },
            findFiles: async () => [Uri.file(path.join(directory, 'boards/atk-au15p/board.json'))], asRelativePath: (uri: Uri) => path.relative(directory, uri.fsPath),
            openTextDocument: async (uri: Uri) => documents.get(uri.toString()) ?? { uri, getText: async () => fs.readFile(uri.fsPath, 'utf8') },
            applyEdit: async (edit: any) => { applyCount++; documents.get(edit.uri.toString())!.change(edit.text); return true; },
            onDidChangeTextDocument: (listener: (event: any) => void) => { listeners.add(listener); return { dispose() { listeners.delete(listener); } }; },
            createFileSystemWatcher: () => ({ dispose() { }, onDidChange: noop, onDidCreate: noop, onDidDelete: noop }),
        },
        window: {
            showSaveDialog: async () => cancelSave ? undefined : saveTarget, showTextDocument: async () => undefined,
            createWebviewPanel: () => {
                let receive: (message: any) => void, disposeCallback: () => void = () => undefined;
                const panel = { page: undefined as Page | undefined, messages: [] as any[], webview: { html: '',
                        onDidReceiveMessage: (handler: (message: any) => void) => { receive = handler; return noop(); },
                        postMessage: async (message: any) => { if (panel.page)
                            await panel.page.evaluate(m => (globalThis as any).window.dispatchEvent(new MessageEvent('message', { data: m })), message); return true; },
                    }, receive: (message: any) => { panel.messages.push(message); receive(message); }, onDidDispose: (handler: () => void) => { disposeCallback = handler; return noop(); }, dispose: () => disposeCallback(), reveal() { } };
                panels.push(panel);
                return panel;
            },
        },
    };
    loader._load = function (name: string, ...args: any[]): any { return name === 'vscode' ? mock : originalLoad.call(this, name, ...args); };
    try {
        const repositoryRoot = path.resolve(__dirname, '../../..');
        await fs.cp(path.join(repositoryRoot, 'docs/boards/atk-au15p'), path.join(directory, 'boards/atk-au15p'), { recursive: true });
        await fs.cp(path.join(repositoryRoot, 'docs/examples/physical-interfaces'), path.join(directory, 'examples/physical-interfaces'), { recursive: true });
        const extensionRoot = path.join(directory, 'extension');
        const interfaceRoot = path.join(extensionRoot, 'resources/physical-models/interfaces');
        await fs.mkdir(interfaceRoot, { recursive: true });
        await fs.copyFile(path.join(repositoryRoot, 'docs/examples/physical-interfaces/uart.fixed.json'), path.join(interfaceRoot, 'uart.fixed.json'));
        const { PhysicalPinsPanel } = require('../archDesign/physicalPinsPanel');
        const ports = [...['p', 'n'].map(leg => ({ name: `tmds_data_${leg}`, direction: 'output' as const, indices: [2, 1, 0] })), ...['p', 'n'].map(leg => ({ name: `tmds_clock_${leg}`, direction: 'output' as const, indices: undefined }))];
        const adUri = Uri.file(path.join(directory, 'video.ad')), rtlUri = Uri.file(path.join(directory, 'quick.sv'));
        const adText = serializeArchDesign({ ...createEmptyArchDesign('video'), ports: ports.map(p => ({ name: p.name, direction: p.direction, width: p.indices?.length ?? 1 })), export: { language: 'systemverilog', output: 'generated/video.sv' } });
        const rtlText = 'module quick(output [2:0] tmds_data_p, tmds_data_n); endmodule\n';
        documents.set(adUri.toString(), new Document(adUri, adText));
        documents.set(rtlUri.toString(), new Document(rtlUri, rtlText));
        await fs.writeFile(adUri.fsPath, adText);
        await fs.writeFile(rtlUri.fsPath, rtlText);
        const manager = new PhysicalPinsPanel({ extensionUri: Uri.file(extensionRoot) }, { ports: async () => ports });
        const workspaceBoard = 'boards/atk-au15p/board.json';
        const loaded = await manager.loadBoard(adUri, workspaceBoard);
        assert.equal(loaded.profile, 'atk-au15p', 'verified circuit rules must work without a bundled board');
        const libraryBoard = { ...loaded.model, interfaces: loaded.model.interfaces.map((instance: any) => instance.id === 'UART1' ? { ...instance, definition: 'library:interfaces/uart.fixed.json' } : instance) };
        await fs.writeFile(path.join(directory, 'boards/atk-au15p/library.board.json'), JSON.stringify(libraryBoard));
        assert.equal((await manager.loadBoard(adUri, 'boards/atk-au15p/library.board.json')).profile, 'atk-au15p', 'relocating an unchanged interface definition must preserve verified circuit rules');
        const changedBoard = { ...loaded.model, clocks: loaded.model.clocks.map((clock: any, index: number) => index === 0 ? { ...clock, frequencyHz: 50000000 } : clock) };
        // Resolve the same definitions beside the copied board; an edited hardware model must not inherit its circuit profile.
        await fs.writeFile(path.join(directory, 'boards/atk-au15p/changed.board.json'), JSON.stringify(changedBoard));
        assert.equal((await manager.loadBoard(adUri, 'boards/atk-au15p/changed.board.json')).profile, undefined);
        const customBoard = {
            kind: 'board', vendor: 'amd', device: 'xcau15p-ffvb676-2-i',
            rails: [{ id: 'v', millivolts: 3300 }], banks: [{ id: '84', supplyRail: 'v' }],
            fpgaPins: [{ id: 'W16', bank: '84' }, { id: 'Y16', bank: '84' }],
            interfaces: [{ id: 'UART', definition: 'library:interfaces/uart.fixed.json' }],
            routes: [{ interface: 'UART', member: 'tx', pin: 'W16' }, { interface: 'UART', member: 'rx', pin: 'Y16' }],
        };
        await fs.writeFile(path.join(directory, 'custom.board.json'), JSON.stringify(customBoard));
        let sources: Uri[] = [];
        assert.equal((await manager.loadBoard(adUri, 'custom.board.json', (uris: Uri[]) => { sources = uris; })).definitions.UART.function.uart.tx, 'output');
        assert.ok(sources.some(uri => uri.fsPath === path.join(interfaceRoot, 'uart.fixed.json')), 'watch the resolved library interface');
        await assert.rejects(() => manager.loadBoard(adUri, 'library:boards/atk-au15p/board.json'), /relative workspace board/);
        for (const reference of ['library:interfaces/../boards/board.json', 'library:interfaces/..\\board.json', 'library:boards/board.json', 'https://example.com/uart.json']) {
            await fs.writeFile(path.join(directory, 'invalid.board.json'), JSON.stringify({ ...customBoard, interfaces: [{ id: 'UART', definition: reference }] }));
            await assert.rejects(() => manager.loadBoard(adUri, 'invalid.board.json'), /[Ii]nterface definition/);
        }
        const launch = async (uri: Uri): Promise<Page> => {
            await manager.open(uri);
            const panel = panels[panels.length - 1], page = await browser.newPage();
            panel.page = page;
            page.setDefaultTimeout(10000);
            page.on('pageerror', error => { console.error('Pin panel browser error:', error); });
            await page.exposeFunction('sendMockMessage', (message: any) => panel.receive(message));
            await page.setContent(panel.webview.html.replace(/(<script nonce="[^"]+">)/, '$1\nfunction acquireVsCodeApi(){return{postMessage:message=>window.sendMockMessage(message)}};'));
            await page.selectOption('#board', workspaceBoard);
            assert.equal(await page.locator('#board option').count(), 2, 'only workspace boards may be offered');
            await page.locator('select[data-rail="VCCIO_B64"]').selectOption('1800');
            await page.waitForFunction(() => (globalThis as any).document.body.dataset.pending === 'false' && (globalThis as any).document.querySelector('select[data-rail="VCCIO_B64"]')?.value === '1800');
            await page.locator('select[data-selector="J22"]').selectOption('hdmi');
            await page.waitForFunction(() => (globalThis as any).document.body.dataset.pending === 'false' && (globalThis as any).document.querySelector('select[data-selector="J22"]')?.value === 'hdmi');
            return page;
        };
        const page = await launch(adUri);
        const source = page.locator('.port').filter({ hasText: /^tmds_data_p/ }), target = page.locator('.signal').filter({ hasText: /^data_p \[3\]/ });
        await source.dragTo(target);
        try {
            await page.waitForFunction(() => !(globalThis as any).document.querySelector('#export')?.disabled);
        }
        catch (error) {
            console.error('Drag messages:', panels[0].messages, 'Panel errors:', await page.locator('#error').textContent(), await page.locator('#issues').textContent());
            throw error;
        }
        const ad = documents.get(adUri.toString())!, stored = parseArchDesignText(ad.getText());
        assert.equal(stored.status, 'editable');
        if (stored.status !== 'editable')
            throw new Error('invalid AD');
        assert.equal(stored.design.physical?.bindings.length, 6);
        assert.equal((await fs.readFile(adUri.fsPath, 'utf8')), adText, 'AD bindings remain unsaved until normal Save/export');
        await page.click('#export');
        const xdc = path.join(directory, 'generated', 'video.xdc');
        await page.waitForFunction(() => !(globalThis as any).document.querySelector('#error')?.textContent);
        for (let i = 0; i < 100; i++) {
            try {
                await fs.stat(xdc);
                break;
            }
            catch {
                await new Promise(resolve => setTimeout(resolve, 20));
            }
        }
        const exported = await fs.readFile(xdc, 'utf8');
        assert.match(exported, /PACKAGE_PIN AB17 \[get_ports \{tmds_data_p\[2\]\}\]/);
        assert.match(exported, /PACKAGE_PIN AC17 \[get_ports \{tmds_data_n\[2\]\}\]/);
        assert.equal(parseArchDesignText(await fs.readFile(adUri.fsPath, 'utf8')).status, 'editable');
        assert.equal(ad.isDirty, false);
        const changed = applyArchDesignEdit(stored.design, { type: 'setPhysical', physical: { ...stored.design.physical!, bindings: [] } });
        ad.change(serializeArchDesign(changed));
        await page.waitForFunction(() => (globalThis as any).document.querySelector('#export')?.disabled === true);
        // Group checkboxes fill the existing TMDS bus aliases by their suffix names.
        await page.getByRole('checkbox', { name: 'HDMI_OUT / tmds', exact: true }).check();
        await page.waitForFunction(() => !(globalThis as any).document.querySelector('#export')?.disabled);
        await page.getByRole('checkbox', { name: 'HDMI_OUT / tmds', exact: true }).uncheck();
        await page.waitForFunction(() => (globalThis as any).document.querySelector('#export')?.disabled === true);
        const beforeQuick = applyCount, quick = await launch(rtlUri);
        await quick.locator('.port').filter({ hasText: /^tmds_data_p/ }).click();
        await quick.locator('.signal').filter({ hasText: /^data_p \[3\]/ }).getByRole('button', { name: 'Bind' }).click();
        await quick.waitForFunction(() => !(globalThis as any).document.querySelector('#export')?.disabled);
        assert.equal(applyCount, beforeQuick, 'quick RTL tool must never persist binding configuration');
        assert.equal(await fs.readFile(rtlUri.fsPath, 'utf8'), rtlText);
        cancelSave = true;
        await quick.click('#export');
        await quick.waitForFunction(() => (globalThis as any).document.body.dataset.pending === 'false');
        assert.equal(await quick.locator('#export').isEnabled(), true, 'canceling export must keep the panel usable');
        cancelSave = false;
        await fs.writeFile(saveTarget.fsPath, '# handwritten constraints\n');
        await quick.click('#export');
        await quick.waitForFunction(() => (globalThis as any).document.querySelector('#error')?.textContent?.includes('Generated file conflict'));
        assert.equal(await fs.readFile(saveTarget.fsPath, 'utf8'), '# handwritten constraints\n');
        saveTarget = Uri.file(path.join(directory, 'exported-quick.xdc'));
        await quick.click('#export');
        for (let i = 0; i < 100; i++) {
            try {
                await fs.stat(saveTarget.fsPath);
                break;
            }
            catch {
                await new Promise(resolve => setTimeout(resolve, 20));
            }
        }
        assert.match(await fs.readFile(saveTarget.fsPath, 'utf8'), /vik-veriflow:generated xdc source=/);
        manager.dispose();
        assert.equal(listeners.size, 0);
        console.log('Physical pin port ranges, paths, browser drag/drop, AD persistence, group selection, quick RTL tool and XDC ownership tests passed');
    }
    finally {
        loader._load = originalLoad;
        await browser.close();
        assert.ok(path.dirname(directory) === os.tmpdir(), 'temporary cleanup must stay under the OS temp directory');
        await fs.rm(directory, { recursive: true, force: true });
    }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
