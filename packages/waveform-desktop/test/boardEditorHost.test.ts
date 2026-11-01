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
        await page.locator('#board-context').selectOption('user:carrier');
        await page.locator('#interfaces input[type=checkbox]').first().check();
        await page.getByRole('button', { name: 'Port serial_tx', exact: true }).dragTo(page.getByRole('button', { name: 'Bind Carrier UART.tx', exact: true }));
        await page.waitForFunction(() => document.querySelector('#export-preview')?.textContent?.includes('serial_tx'));
        await page.locator('[data-page="library"]').click();
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
