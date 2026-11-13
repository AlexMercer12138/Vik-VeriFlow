const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { buildSync } = require('esbuild');
const { chromium } = require('playwright');

// Run with: node --test packages/schematic-webview/test/constraintsPerformance.browser.cjs
const root = path.resolve(__dirname, '../../..');
const script = buildSync({ entryPoints: [path.join(root, 'packages/schematic-webview/src/constraints/index.ts')], bundle: true, platform: 'browser', write: false }).outputFiles[0].text;
const html = fs.readFileSync(path.join(root, 'packages/schematic-webview/src/constraints/index.html'), 'utf8')
    .replace(/<meta http-equiv="Content-Security-Policy"[^>]+>/, '')
    .replace(/<script[^>]*src=[^>]+><\/script>/g, '');

test('large constraint workbench avoids unrelated DOM work and batches typing', async t => {
    const browser = await chromium.launch({ headless: true, channel: 'msedge' });
    try {
        const page = await browser.newPage();
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.setContent(html);
        await page.evaluate(() => {
            window.sent = [];
            window.acquireVsCodeApi = () => ({ postMessage: m => window.sent.push(m), getState: () => undefined, setState: () => {} });
        });
        await page.addScriptTag({ content: script });
        const pins = Object.fromEntries(Array.from({ length: 512 }, (_, i) => ['p' + i, 'set_io {signal name} P' + i]));
        const signals = Object.keys(pins).map(id => ({ id, direction: 'output', pins: [id] }));
        const model = { kind: 'board', extension: '.pcf', pins, interfaces: [{ id: 'IO', signals }] };
        const state = { type: 'state', page: 'library', boards: [{ id: 'b', name: 'Board', kind: 'board', pins: signals.length, saved: true }], draft: { id: 'b', name: 'Board', model }, dirty: false, issues: [], source: { path: '/top.v', module: 'top' }, configuration: { board: 'user:b', bindings: [] }, ports: signals.map(s => ({ name: s.id, direction: 'output' })), active: [], interfaces: model.interfaces, models: { '': model }, diagnostics: [], preview: '', output: 'top.pcf', error: '' };
        const send = data => page.evaluate(data => { window.dispatchEvent(new MessageEvent('message', { data })); }, data);
        const started = Date.now();
        await send(state);
        t.diagnostic(`512-pin initial state: ${Date.now() - started} ms`);

        await t.test('interface template choices are populated only for the opened control', async () => {
            const result = await page.evaluate(() => {
                document.querySelector('[data-section="interfaces"]').click();
                const selects = [...document.querySelectorAll('#interface-editors select[aria-label$=" template"]')];
                const initialOptions = selects.reduce((sum, select) => sum + select.options.length, 0);
                selects[0].dispatchEvent(new Event('focus'));
                return { initialOptions, openedOptions: selects[0].options.length };
            });
            assert.ok(result.initialOptions <= 512 * 2, `Too many eager options: ${result.initialOptions}`);
            assert.equal(result.openedOptions, 513);
        });
        await page.locator('[data-section="pins"]').click();

        await t.test('template selection leaves the interface editor intact', async () => {
            const result = await page.evaluate(() => {
                const editor = document.querySelector('#interface-editors');
                const observer = new MutationObserver(() => {});
                observer.observe(editor, { childList: true, subtree: true });
                const start = performance.now();
                document.querySelectorAll('#template-list button')[1].click();
                const mutations = observer.takeRecords().length;
                observer.disconnect();
                return { mutations, ms: performance.now() - start };
            });
            t.diagnostic(`select template: ${result.ms.toFixed(1)} ms; interface mutations: ${result.mutations}`);
            assert.equal(result.mutations, 0);
        });
        await t.test('typing is coalesced and Save flushes the final draft first', async () => {
            const result = await page.evaluate(() => {
                window.sent.length = 0;
                const input = document.querySelector('#template-text');
                const start = performance.now();
                for (let i = 0; i < 32; i++) {
                    input.value = 'updated {signal name} ' + i;
                    input.dispatchEvent(new Event('input'));
                }
                document.querySelector('#save-board').click();
                return { messages: window.sent, ms: performance.now() - start };
            });
            t.diagnostic(`32 input events and save: ${result.ms.toFixed(1)} ms; messages: ${result.messages.length}`);
            const changes = result.messages.filter(m => m.type === 'board-change');
            assert.equal(changes.length, 1);
            assert.equal(changes[0].draft.model.pins.p1, 'updated {signal name} 31');
            assert.deepEqual(result.messages.map(m => m.type), ['board-change', 'board-save']);
        });
        await t.test('library acknowledgements leave hidden binding lists intact', async () => {
            const mutations = await page.evaluate(data => {
                const observer = new MutationObserver(() => {});
                for (const id of ['interfaces', 'binding-rows', 'port-list']) observer.observe(document.getElementById(id), { childList: true, subtree: true });
                window.dispatchEvent(new MessageEvent('message', { data: { ...data, reason: 'board-change', editId: 32, dirty: true } }));
                const count = observer.takeRecords().length;
                observer.disconnect();
                return count;
            }, state);
            assert.equal(mutations, 0);
        });
        await t.test('unchanged binding refresh retains existing lists', async () => {
            await send({ ...state, page: 'bindings' });
            const result = await page.evaluate(data => {
                const row = document.querySelector('#port-list .port-entry');
                const observer = new MutationObserver(() => {});
                observer.observe(document.querySelector('#port-list'), { childList: true, subtree: true });
                const start = performance.now();
                window.dispatchEvent(new MessageEvent('message', { data: { ...data, page: 'bindings', reason: 'source-refresh' } }));
                const count = observer.takeRecords().length;
                observer.disconnect();
                return { count, connected: row.isConnected, ms: performance.now() - start };
            }, state);
            t.diagnostic(`unchanged binding refresh: ${result.ms.toFixed(1)} ms`);
            assert.equal(result.count, 0);
            assert.equal(result.connected, true);
        });
        await t.test('selecting an interface signal retains the unchanged port browser', async () => {
            const result = await page.evaluate(() => {
                const row = document.querySelector('#port-list .port-entry');
                document.querySelector('#interfaces .signal-item button').click();
                return { connected: row.isConnected, rows: document.querySelectorAll('#binding-rows tr[data-key]').length, title: document.querySelector('#binding-selected-title').textContent };
            });
            assert.equal(result.rows, 1);
            assert.equal(result.title, 'IO.p0');
            assert.equal(result.connected, true);
        });
        await t.test('a pause in typing publishes the latest draft automatically', async () => {
            await send({ ...state, page: 'library', reason: 'board-open' });
            await page.evaluate(() => {
                window.sent.length = 0;
                const input = document.querySelector('#template-text');
                for (let i = 0; i < 3; i++) {
                    input.value = 'paused {signal name} ' + i;
                    input.dispatchEvent(new Event('input'));
                }
            });
            await page.waitForFunction(() => window.sent.some(m => m.type === 'board-change'));
            const changes = await page.evaluate(() => window.sent.filter(m => m.type === 'board-change'));
            assert.equal(changes.length, 1);
            assert.equal(changes[0].draft.model.pins.p1, 'paused {signal name} 2');
        });
        await t.test('saving a renamed draft re-enables using the board', async () => {
            const change = await page.evaluate(() => {
                const name = document.querySelector('#detail-name');
                name.value = 'Renamed board';
                name.dispatchEvent(new Event('change'));
                document.querySelector('#save-board').click();
                return window.sent.filter(m => m.type === 'board-change').at(-1);
            });
            const saved = { ...state, draft: change.draft, boards: [{ ...state.boards[0], name: 'Renamed board' }] };
            await send({ ...saved, reason: 'board-change', editId: change.editId, dirty: true });
            await send({ ...saved, reason: 'board-save', dirty: false });
            assert.equal(await page.locator('#use-board').isEnabled(), true);
        });
        assert.deepEqual(errors, []);
    } finally {
        await browser.close();
    }
});
