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
            const host = globalThis as any;
            host.__waveformResponses = 0;
            host.acquireVsCodeApi = () => ({
                postMessage(message: any) {
                    if (message.type !== 'windowRequest' || !host.__waveformWindows) return;
                    queueMicrotask(() => {
                        host.dispatchEvent(new MessageEvent('message', { data: {
                            type: 'windowData', generation: message.generation, requestId: message.requestId,
                            pixelWidth: message.pixelWidth,
                            series: message.references.filter((reference: string) => host.__waveformWindows[reference])
                                .map((reference: string) => ({ reference, ...host.__waveformWindows[reference] })),
                        } }));
                        host.__waveformResponses++;
                    });
                },
                getState() { return null; }, setState() {},
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
        const clickTime = async (time: number, row = 0) => {
            const view = await state();
            const bounds = (await page.locator('#waveCanvas').boundingBox())!;
            await page.mouse.click(bounds.x + (time - view.startTime) / (view.endTime - view.startTime) * bounds.width, bounds.y + 38 + row * 32 + 16);
        };
        // Native mouse coordinates can round to a neighboring VCD tick.
        const assertMouseTime = (actual: number, expected: number) => assert.ok(Math.abs(actual - expected) <= 1, `Expected mouse time near ${expected}, got ${actual}`);
        await clickTime(137);
        assertMouseTime((await state()).cursorA, 137);
        const initialCursorA = (await state()).cursorA;
        await page.locator('#cursorB').click();
        await clickTime(139);
        assertMouseTime((await state()).cursorB, 139);
        assert.equal((await state()).cursorA, initialCursorA);
        for (const width of [900, 1440]) {
            await page.setViewportSize({ width, height: 940 });
            const canvasWidth = (await page.locator('#waveCanvas').boundingBox())!.width;
            await clickTime(125 + 2 * 800 / canvasWidth);
            assert.equal((await state()).cursorB, 125, 'two screen pixels from the grid should snap');
            const freeTime = 125 + 5 * 800 / canvasWidth;
            await clickTime(freeTime);
            assertMouseTime((await state()).cursorB, Math.round(freeTime));
        }

        const bounds = (await page.locator('#waveCanvas').boundingBox())!;
        await page.mouse.move(bounds.x + 137 / 800 * bounds.width, bounds.y + 15);
        await page.mouse.down();
        await page.mouse.move(bounds.x + 463 / 800 * bounds.width, bounds.y + 15, { steps: 4 });
        const selection = (await page.locator('#selectionBox').boundingBox())!;
        assert.ok(Math.abs(selection.x - (bounds.x + 137 / 800 * bounds.width)) < 2);
        assert.ok(Math.abs(selection.width - 326 / 800 * bounds.width) < 3);
        await page.mouse.up();
        assertMouseTime((await state()).startTime, 137);
        assertMouseTime((await state()).endTime, 463);
        assert.equal((await state()).cursorB, (await state()).startTime);

        // A panned viewport keeps the grid anchored at zero; zoom changes the step.
        await clickTime(193);
        assertMouseTime((await state()).cursorB, 193);
        await clickTime(200.2);
        assert.equal((await state()).cursorB, 200);
        await page.evaluate(() => {
            const viewer = (globalThis as any).__veriflowWaveViewer;
            const layout = viewer.captureLayout();
            layout.view.startTime = 100;
            layout.view.endTime = 180;
            viewer.restoreLayout(layout);
        });
        await clickTime(139);
        assert.equal((await state()).cursorB, 139);
        await clickTime(139.95);
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

        await page.evaluate(() => {
            const signals = [
                { reference: 'upper', width: 1, changes: [{ time: 0, value: '0' }, { time: 137, value: '1' }, { time: 248, value: '0' }] },
                { reference: 'lower', width: 1, changes: [{ time: 0, value: '0' }, { time: 139, value: '1' }, { time: 252, value: '0' }] },
                { reference: 'quiet', width: 1, changes: [{ time: 0, value: '0' }] },
                { reference: 'bus', width: 2, changes: [{ time: 0, value: '00' }, { time: 411, value: '01' }, { time: 414, value: '11' }, { time: 600, value: '10' }] },
                ...Array.from({ length: 40 }, (_, index) => ({
                    reference: `padding${index}`, width: 1,
                    changes: index === 39 ? [{ time: 0, value: '0' }, { time: 338, value: '1' }] : [{ time: 0, value: '0' }],
                })),
            ].map((signal, index) => ({ ...signal, id: String(index), fullName: signal.reference, scope: '', type: 'wire' }));
            (globalThis as any).__edgeSnapData = { timescale: '1ns', startTime: 0, endTime: 800, scopes: [], warnings: [], signals };
            (globalThis as any).dispatchEvent(new MessageEvent('message', { data: { type: 'vcd', fileName: 'edges.vcd', data: (globalThis as any).__edgeSnapData } }));
            (globalThis as any).__veriflowWaveViewer.addFirstSignals(signals.length);
        });
        for (const width of [900, 1440]) {
            await page.setViewportSize({ width, height: 940 });
            await clickTime(139, 0);
            assert.equal((await state()).cursorA, 137, 'clicked upper row wins over a closer edge on the lower row');
            await clickTime(137, 1);
            assert.equal((await state()).cursorA, 139, 'clicked lower row wins over a closer edge on the upper row');
            await clickTime(138.8, 2);
            assert.equal((await state()).cursorA, 139, 'a flat clicked row falls back to the closest edge on other visible rows');
            await clickTime(249.8, 0);
            assert.equal((await state()).cursorA, 248, 'a nearby edge takes priority over grid snapping');
            await clickTime(249.8, 1);
            assert.equal((await state()).cursorA, 252);
            const canvasWidth = (await page.locator('#waveCanvas').boundingBox())!.width;
            await clickTime(137 + 4 * 800 / canvasWidth, 0);
            assert.equal((await state()).cursorA, 137, 'edge radius stays fixed in screen pixels after resizing');
            await clickTime(137 - 9 * 800 / canvasWidth, 0);
            assert.notEqual((await state()).cursorA, 137, 'clicks outside the edge radius stay free');
            await clickTime(338 + 4 * 800 / canvasWidth, 2);
            assert.notEqual((await state()).cursorA, 338, 'offscreen signals cannot capture the cursor');
            await clickTime(188, 2);
            assertMouseTime((await state()).cursorA, 188);
        }
        await page.evaluate(() => (globalThis as any).__veriflowWaveViewer.expandFirstBus());
        await clickTime(412, 3);
        assert.equal((await state()).cursorA, 411, 'bus row snaps to any value change');
        await clickTime(412, 4);
        assert.equal((await state()).cursorA, 414, 'bit 1 ignores the closer transition of bit 0');
        await clickTime(412, 5);
        assert.equal((await state()).cursorA, 411, 'bit 0 ignores transitions of bit 1');

        // Scrolling three rows moves the bus to the first visible row.
        const scrolledBounds = (await page.locator('#waveCanvas').boundingBox())!;
        await page.mouse.move(scrolledBounds.x + 100, scrolledBounds.y + 60);
        await page.keyboard.down('Alt');
        await page.mouse.wheel(0, 100);
        await page.keyboard.up('Alt');
        await page.waitForFunction(() => (globalThis as any).document.querySelector('#waveNameList .wave-name-row')?.textContent?.includes('bus'));
        await clickTime(412, 1);
        assert.equal((await state()).cursorA, 414, 'row priority follows vertical scrolling');

        await page.evaluate(() => {
            const viewer = (globalThis as any).__veriflowWaveViewer;
            const layout = viewer.captureLayout();
            layout.view.startTime = 100;
            layout.view.endTime = 180;
            viewer.restoreLayout(layout);
        });
        const zoomedWidth = (await page.locator('#waveCanvas').boundingBox())!.width;
        await clickTime(137 + 4 * 80 / zoomedWidth, 0);
        assert.equal((await state()).cursorA, 137, 'edge radius stays fixed after zooming and panning');
        await clickTime(137 + 9 * 80 / zoomedWidth, 0);
        assert.notEqual((await state()).cursorA, 137);

        // Exercise the real indexed-window transport, including expanded bus rows.
        await page.evaluate(() => {
            const host = globalThis as any;
            const data = host.__edgeSnapData;
            host.__waveformWindows = Object.fromEntries(data.signals.map((signal: any) => [signal.reference, {
                kind: 'raw', width: signal.width,
                times: signal.changes.map((change: any) => change.time),
                values: btoa(String.fromCharCode(...signal.changes.map((change: any) => change.value.split('').reduce(
                    (packed: number, bit: string, index: number) => packed | Number(bit) << (6 - index * 2), 0,
                )))),
                valueStride: 1,
            }]));
            host.dispatchEvent(new MessageEvent('message', { data: { type: 'waveformMetadata', generation: 2, fileName: 'indexed-edges.vcd', data } }));
            host.dispatchEvent(new MessageEvent('message', { data: { type: 'indexReady', generation: 2, fileName: 'indexed-edges.vcd', data } }));
            host.__veriflowWaveViewer.addFirstSignals(4);
            host.__veriflowWaveViewer.expandFirstBus();
        });
        await page.waitForFunction(() => (globalThis as any).__waveformResponses > 0 && !(globalThis as any).__veriflowWaveViewer.requestState().window);
        await clickTime(139, 0);
        assert.equal((await state()).cursorA, 137, 'indexed signals use the same row priority');
        await clickTime(137, 1);
        assert.equal((await state()).cursorA, 139);
        await clickTime(412, 4);
        assert.equal((await state()).cursorA, 414, 'indexed bit rows use their parent signal data');
        await clickTime(412, 5);
        assert.equal((await state()).cursorA, 411);
        assert.deepEqual(errors, []);
        console.log('Waveform mouse selection: grid and row-prioritized edge snapping, bus bits, indexed windows, scrolling, resizing, panning and zoom passed');
    } finally {
        await browser.close();
    }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
