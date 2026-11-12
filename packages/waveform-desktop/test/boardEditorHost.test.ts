import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { _electron as electron } from 'playwright';
const rootDir = path.resolve(__dirname, '../../../..'), mainEntry = path.join(rootDir, 'packages/waveform-desktop/dist/main.js');
test('Electron shared workbench edits a board, binds RTL via drag/drop and keeps identity stable', { timeout: 30000 }, async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'vf-workbench-electron-')), configPath = path.join(root, 'config.json'), source = path.join(root, 'top.v');
    await writeFile(configPath, JSON.stringify({ boards: [{ id: 'carrier', name: 'Carrier', model: { kind: 'board', extension: '.pcf', pins: { tx: 'set_io {signal name} A1\n' }, interfaces: [{ id: 'UART', signals: [{ id: 'tx', direction: 'output', pins: ['tx'] }] }] } }] }));
    await writeFile(source, "module top(output serial_tx);assign serial_tx=1'b0;endmodule");
    const env = Object.fromEntries(Object.entries(process.env).filter((e): e is [
        string,
        string
    ] => typeof e[1] === 'string'));
    const app = await electron.launch({ args: [mainEntry, '--board-library', configPath, '--source', source, '--user-data-dir=' + root, '--disable-gpu'], env });
    try {
        const page = await app.firstWindow();
        page.setDefaultTimeout(7000);
        const assertCompactLayout = async (): Promise<void> => {
            const layout = await page.evaluate(() => {
                const bar = document.querySelector('.topbar')?.getBoundingClientRect();
                const activeTools = Array.from(document.querySelectorAll('.topbar-tools:not(.hidden)'));
                const controls = activeTools.flatMap(group => Array.from(group.querySelectorAll('button, select, .context-select')))
                    .filter(element => element.getBoundingClientRect().width > 0);
                return {
                    toolbarHeight: bar?.height ?? 0,
                    controlsInsideToolbar: controls.every(element => {
                        const rect = element.getBoundingClientRect();
                        return !!bar && rect.top >= bar.top && rect.bottom <= bar.bottom;
                    }),
                    brandCount: document.querySelectorAll('.brand').length,
                    contextBarCount: document.querySelectorAll('.contextbar').length,
                    mainHeadingCount: document.querySelectorAll('.main-head').length,
                    progressCount: document.querySelectorAll('.progress').length,
                    rowStatusCount: document.querySelectorAll('.statuscell').length,
                };
            });
            assert.ok(layout.toolbarHeight > 0 && layout.toolbarHeight <= 40, `topbar stays one compact row (height=${layout.toolbarHeight}, url=${page.url()})`);
            assert.equal(layout.controlsInsideToolbar, true, 'page controls share the top toolbar row');
            assert.equal(layout.brandCount, 0, 'redundant brand block is removed');
            assert.equal(layout.contextBarCount, 0, 'context controls are not in a second row');
            assert.equal(layout.mainHeadingCount, 0, 'redundant page headings are removed');
            assert.equal(layout.progressCount, 0, 'binding progress is removed');
            assert.equal(layout.rowStatusCount, 0, 'per-row assignment status is removed');
        };
        await page.locator('.topbar').waitFor({ state: 'visible' });
        await assertCompactLayout();
        await page.locator('#board-context').selectOption('user:carrier');
        await page.locator('#interfaces input[type=checkbox]').first().check();
        await page.getByRole('button', { name: 'Port serial_tx', exact: true }).dragTo(page.getByRole('button', { name: 'Bind Carrier UART.tx', exact: true }));
        await page.waitForFunction(() => document.querySelector('#export-preview')?.textContent?.includes('serial_tx'));
        await page.locator('[data-page="library"]').click();
        await assertCompactLayout();
        const template = page.locator('#template-text');
        const templateHeight = await template.evaluate(element => element.getBoundingClientRect().height);
        assert.ok(templateHeight > 200, `constraint editor expands with its pane (got ${templateHeight}px)`);
        await template.fill('set_io  [get_ports]');
        await template.evaluate(element => (element as HTMLTextAreaElement).setSelectionRange(7, 7));
        const signalTool = page.locator('#insert-signal');
        assert.equal(await signalTool.getAttribute('aria-label'), 'Insert signal name');
        assert.equal(await signalTool.locator('svg').count(), 1);
        await signalTool.click();
        assert.equal(await template.inputValue(), 'set_io {signal name} [get_ports]');
        assert.equal(await template.evaluate(element => (element as HTMLTextAreaElement).selectionStart), 7 + '{signal name}'.length);
        await page.locator('[data-section="details"]').click();
        await page.locator('#detail-kind').selectOption('daughtercard');
        await page.locator('[data-section="pins"]').click();
        await template.fill('set_property PACKAGE_PIN  [get_ports {signal name}]');
        const pinPosition = 'set_property PACKAGE_PIN '.length;
        await template.evaluate((element, cursor) => (element as HTMLTextAreaElement).setSelectionRange(cursor, cursor), pinPosition);
        const pinTool = page.locator('#insert-pin');
        assert.equal(await pinTool.getAttribute('aria-label'), 'Insert pin name');
        assert.equal(await pinTool.locator('svg').count(), 1);
        await pinTool.click();
        assert.equal(await template.inputValue(), 'set_property PACKAGE_PIN {pin name} [get_ports {signal name}]');
        assert.equal(await template.evaluate(element => (element as HTMLTextAreaElement).selectionStart), pinPosition + '{pin name}'.length);
        await template.fill('set_io {signal name} A1\n');
        await page.locator('[data-section="details"]').click();
        await page.locator('#detail-kind').selectOption('board');
        await page.locator('[data-section="details"]').click();
        assert.equal(await page.locator('#detail-id').count(), 0);
        await page.locator('#detail-name').fill('Renamed carrier');
        await page.locator('#detail-name').press('Tab');
        await page.locator('#save-board').click();
        await page.waitForFunction(() => document.querySelector('#toast-text')?.textContent === 'Board saved');
        const saved = JSON.parse(await readFile(configPath, 'utf8'));
        assert.equal(saved.boards[0].name, 'Renamed carrier');
        assert.equal(saved.boards[0].id, 'carrier');
        await page.locator('[data-page="bindings"]').click();
        await assertCompactLayout();
        assert.match(await page.locator('#export-preview').innerText(), /set_io serial_tx A1/);
        const prefs = await app.evaluate(({ BrowserWindow }) => (BrowserWindow.getAllWindows()[0].webContents as any).getLastWebPreferences());
        assert.equal(prefs.nodeIntegration, false);
        assert.equal(prefs.contextIsolation, true);
    }
    finally {
        await app.close();
        await rm(root, { recursive: true, force: true });
    }
});
