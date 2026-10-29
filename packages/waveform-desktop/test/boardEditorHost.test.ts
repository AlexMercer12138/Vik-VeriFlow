import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { _electron as electron } from 'playwright';

const repositoryRoot = path.resolve(__dirname, '../../../..');
const mainEntry = path.join(repositoryRoot, 'packages', 'waveform-desktop', 'dist', 'main.js');

test('Electron board editor uses the shared page and saves profiles to the user library', { timeout: 20_000 }, async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'veriflow-board-editor-'));
    const configPath = path.join(root, '.veriflow_config.json');
    await writeFile(configPath, JSON.stringify({ boards: [{ id: 'carrier', name: 'Carrier', model: {
        kind: 'board', extension: '.xdc', constraints: 'set_property PACKAGE_PIN A1 [get_ports tx]\n',
        interfaces: [{ id: 'UART', signals: [{ id: 'tx', direction: 'output', pins: ['A1'] }] }],
    } }] }));
    const env = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === 'string'));
    const app = await electron.launch({ args: [mainEntry, '--board-library', configPath, `--user-data-dir=${root}`, '--disable-gpu'], env });
    try {
        const page = await app.firstWindow();
        page.setDefaultTimeout(5_000);
        await page.getByRole('button', { name: 'Import board', exact: true }).waitFor();
        await page.locator('#boards').selectOption('carrier');
        await page.getByRole('button', { name: 'Open', exact: true }).click();
        await page.getByLabel('Name', { exact: true }).waitFor();
        await page.getByLabel('Name', { exact: true }).fill('Carrier Updated');
        await page.getByRole('button', { name: 'Save', exact: true }).click();
        const deadline = Date.now() + 5_000;
        while (Date.now() < deadline) {
            const value = JSON.parse(await readFile(configPath, 'utf8'));
            if (value.boards[0].name === 'Carrier Updated') break;
            await new Promise(resolve => setTimeout(resolve, 20));
        }
        const saved = JSON.parse(await readFile(configPath, 'utf8'));
        assert.equal(saved.boards[0].name, 'Carrier Updated');
        assert.equal(saved.boards[0].model.constraints, 'set_property PACKAGE_PIN A1 [get_ports tx]\n');
    } finally {
        await app.close();
        await rm(root, { recursive: true, force: true });
    }
});
