import * as assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as path from 'node:path';
import { chromium } from 'playwright';

async function main(): Promise<void> {
    const browser = await chromium.launch({ headless: true, channel: 'msedge' });
    try {
        const page = await browser.newPage({ viewport: { width: 1440, height: 940 } });
        const errors: string[] = [];
        page.on('pageerror', error => errors.push(error.message));
        const assets = path.resolve(__dirname, '../../../web-dist/waveform');
        const html = (await readFile(path.join(assets, 'index.html'), 'utf8'))
            .replace(/<meta http-equiv="Content-Security-Policy"[^>]*>/, '')
            .replace(/<link[^>]*>|<script[^>]*><\/script>/g, '');
        await page.setContent(html);
        await page.addStyleTag({ content: await readFile(path.join(assets, 'index.css'), 'utf8') });
        await page.evaluate(() => {
            (globalThis as any).acquireVsCodeApi = () => ({
                postMessage() {}, getState() { return null; }, setState() {},
            });
        });
        await page.addScriptTag({ content: await readFile(path.join(assets, 'index.js'), 'utf8') });
        await page.evaluate(() => {
            const data = {
                timescale: '1ns', startTime: 0, endTime: 800, scopes: [], warnings: [],
                signals: [{ id: '!', reference: 'clk', fullName: 'clk', scope: '', type: 'wire', width: 1 }],
            };
            (globalThis as any).dispatchEvent(new MessageEvent('message', {
                data: { type: 'waveformMetadata', generation: 1, fileName: 'snap.vcd', data },
            }));
            (globalThis as any).dispatchEvent(new MessageEvent('message', {
                data: { type: 'indexReady', generation: 1, fileName: 'snap.vcd', data },
            }));
            (globalThis as any).__veriflowWaveViewer.addFirstSignals(1);
        });
        await page.waitForFunction(() => (globalThis as any).document.getElementById('waveCanvas').clientWidth > 100);
        const state = () => page.evaluate(() => (globalThis as any).__veriflowWaveViewer.state());
        const clickTime = async (time: number) => {
            const view = await state();
            const bounds = (await page.locator('#waveCanvas').boundingBox())!;
            await page.mouse.click(bounds.x + (time - view.startTime) / (view.endTime - view.startTime) * bounds.width, bounds.y + 55);
        };
        await clickTime(137);
        assert.equal((await state()).cursorA, 125);
        await page.locator('#cursorB').click();
        await clickTime(139);
        assert.equal((await state()).cursorB, 150);
        assert.equal((await state()).cursorA, 125);

        const bounds = (await page.locator('#waveCanvas').boundingBox())!;
        await page.mouse.move(bounds.x + 137 / 800 * bounds.width, bounds.y + 15);
        await page.mouse.down();
        await page.mouse.move(bounds.x + 463 / 800 * bounds.width, bounds.y + 15, { steps: 4 });
        const selection = (await page.locator('#selectionBox').boundingBox())!;
        assert.ok(Math.abs(selection.x - (bounds.x + 125 / 800 * bounds.width)) < 2);
        assert.ok(Math.abs(selection.width - 350 / 800 * bounds.width) < 3);
        await page.mouse.up();
        assert.equal((await state()).startTime, 125);
        assert.equal((await state()).endTime, 475);
        assert.equal((await state()).cursorB, 125);

        // A panned viewport keeps the grid anchored at zero; zoom changes the step.
        await clickTime(189);
        assert.equal((await state()).cursorB, 188);
        await page.evaluate(() => {
            const viewer = (globalThis as any).__veriflowWaveViewer;
            const layout = viewer.captureLayout();
            layout.view.startTime = 100;
            layout.view.endTime = 180;
            viewer.restoreLayout(layout);
        });
        await clickTime(139);
        assert.equal((await state()).cursorB, 140);
        await page.evaluate(() => {
            const viewer = (globalThis as any).__veriflowWaveViewer;
            const layout = viewer.captureLayout();
            layout.view.startTime = 0;
            layout.view.endTime = 8;
            viewer.restoreLayout(layout);
        });
        await clickTime(3.4);
        assert.equal((await state()).cursorB, 3);
        assert.deepEqual(errors, []);
        console.log('Waveform mouse selection: A/B cursors, snapped range preview, panning, zoom and minimum VCD tick passed');
    } finally {
        await browser.close();
    }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
