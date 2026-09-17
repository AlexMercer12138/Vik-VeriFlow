const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const esbuild = require('esbuild');
const root = path.resolve(__dirname, '../../..');
const output = path.join(root, '.artifacts/ad-st-feedback-20260917/canvas');
fs.mkdirSync(output, { recursive: true });
const sourceCore = {
    '@veriflow/schematic-core': path.join(root, 'packages/schematic-core/src/index.ts'),
    '@veriflow/schematic-core/arch-design': path.join(root, 'packages/schematic-core/src/archDesign/index.ts'),
};
(async () => {
    await esbuild.build({
        entryPoints: [path.join(root, 'packages/schematic-webview/src/index.ts')],
        bundle: true, platform: 'browser', format: 'iife', outfile: path.join(output, 'index.js'),
        plugins: [{ name: 'source-core', setup(build) {
            build.onResolve({ filter: /^@veriflow\/schematic-core(?:\/arch-design)?$/ }, args => ({ path: sourceCore[args.path] }));
        } }],
    });
    for (const file of ['index.html', 'index.css']) fs.copyFileSync(path.join(root, 'packages/schematic-webview/src', file), path.join(output, file));
    for (const [name, entryPoint] of Object.entries({ core: sourceCore['@veriflow/schematic-core'], ad: sourceCore['@veriflow/schematic-core/arch-design'] })) {
        esbuild.buildSync({ entryPoints: [entryPoint], bundle: true, platform: 'node', format: 'cjs', outfile: path.join(output, `${name}.cjs`) });
    }
    const core = require(path.join(output, 'core.cjs'));
    const ad = require(path.join(output, 'ad.cjs'));
    const server = http.createServer((req, res) => {
        const file = path.join(output, req.url === '/' ? 'index.html' : req.url.slice(1));
        res.setHeader('Content-Type', file.endsWith('.js') ? 'application/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html');
        res.end(fs.readFileSync(file));
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const browser = await chromium.launch({ channel: 'msedge', headless: true });
    try {
        for (const kind of ['simulation-task', 'arch-design']) {
            const page = await browser.newPage({ viewport: { width: 1280, height: 850 } });
            const errors = [];
            const messages = [];
            page.on('pageerror', error => errors.push(error.message));
            const definition = { key: 'counter', name: 'counter', parameters: [], ports: [] };
            const design = structuredClone(ad.createEmptyArchDesign('navigator'));
            design.instances = [{ name: 'u_counter_0', module: 'counter', definitionKey: 'counter' }];
            let revision = 1;
            let layout;
            const send = data => page.evaluate(data => window.postMessage(data, '*'), data);
            async function state() {
                const projected = ad.projectArchDesignGraph(design, [definition], { fileUri: 'file:///navigator.st' });
                const projection = { design, catalog: [definition], moduleChoices: [], validation: projected.validation, inspector: { interfaces: [], protocols: [] } };
                if (kind === 'simulation-task') await send({ type: 'simulationTaskState', revision: String(revision), projection, task: {
                    document: { format: 'veriflow-simulation-task', schemaVersion: 1, settings: { timeUnit: '1ns', timePrecision: '1ps', duration: 1000, waveform: { enabled: false, filename: 'navigator.vcd' } }, instances: [], connections: [], logic: [], interfaceConnections: [], interfaceOverrides: {}, presentation: {} },
                    version: revision, execution: { status: 'idle', canOpenWave: false },
                } });
                else await send({ type: 'archDesignState', status: 'editable', revision: String(revision), ...projection });
                layout ??= { placement: core.createPlacement(projected.graph, core.assignColumns(projected.graph)), viewport: { x: 0, y: 0, zoom: 1 }, minimap: false };
                const projectedLayout = { ...layout, placement: core.createPlacement(projected.graph, core.assignColumns(projected.graph)) };
                await send({ type: 'graph', revision: String(revision), graph: projected.graph, layout: projectedLayout, fitOnFirstRender: revision === 1 });
            }
            await page.exposeFunction('hostMessage', async message => {
                messages.push(message);
                if (message.type === 'ready') {
                    await send({ type: 'initialize', fileUri: 'file:///navigator.st', modules: [{ key: 'arch-design:navigator', name: 'navigator' }], selectedModuleKey: 'arch-design:navigator', documentKind: kind, editable: true });
                    await state();
                }
                if (message.type === 'saveLayout') {
                    layout = message.layout;
                    await send({ type: 'archDesignLayoutSaved', revision: String(revision) });
                }
            });
            await page.addInitScript(() => {
                let state = {};
                window.acquireVsCodeApi = () => ({ postMessage: m => window.hostMessage(m), getState: () => state, setState: value => { state = value; window.savedWebviewState = value; } });
            });
            await page.goto(`http://127.0.0.1:${server.address().port}`);
            await page.locator('#canvas .x6-node').first().waitFor();
            const node = page.locator('#canvas [data-cell-id="instance:u_counter_0"]');
            assert.equal(await node.locator('.veriflow-title-clip text title').textContent(), 'counter u_counter_0');
            assert.equal((await node.locator('.veriflow-title-clip text tspan').textContent()).replaceAll('\u00a0', ' '), 'counter u_counter_0');
            assert.equal(await node.locator('.veriflow-subtitle-clip').getAttribute('width'), '0');
            assert.equal(await node.locator('.veriflow-title-clip text').evaluate(e => getComputedStyle(e).textDecorationLine), 'none');
            await node.dblclick();
            assert(messages.some(message => message.type === 'openDefinition'), 'Double-click retains source definition navigation');
            const matrix = () => page.locator('#canvas .x6-graph-svg-viewport').getAttribute('transform');
            const beforeToggle = await matrix();
            await page.locator('#minimap-button').click();
            await page.locator('.x6-widget-minimap-viewport').waitFor();
            await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
            assert.equal(await matrix(), beforeToggle, 'Showing the minimap must preserve the main transform');
            const box = await page.locator('#minimap').boundingBox();
            const viewport = await page.locator('.x6-widget-minimap-viewport').boundingBox();
            assert(viewport.width <= box.width && viewport.height <= box.height, 'The navigator viewport must fit inside the overview for a small graph');
            const startX = viewport.x + viewport.width / 2;
            const startY = viewport.y + viewport.height / 2;
            await page.mouse.move(startX, startY);
            await page.mouse.down();
            await page.mouse.move(startX + 12, startY + 6, { steps: 4 });
            await page.mouse.up();
            await page.waitForFunction(old => document.querySelector('#canvas .x6-graph-svg-viewport').getAttribute('transform') !== old, beforeToggle);
            await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
            const draggedViewport = await page.locator('.x6-widget-minimap-viewport').boundingBox();
            assert(Math.abs(draggedViewport.x - viewport.x - 12) < 2, 'Dragging the navigator must track pointer displacement');
            assert(Math.abs(draggedViewport.y - viewport.y - 6) < 2);
            // Main-canvas pan and zoom must update the same viewport rectangle.
            const mainBeforePan = await matrix();
            await page.mouse.move(100, 100);
            await page.mouse.down({ button: 'middle' });
            await page.mouse.move(150, 130, { steps: 4 });
            await page.mouse.up({ button: 'middle' });
            await page.waitForFunction(old => document.querySelector('#canvas .x6-graph-svg-viewport').getAttribute('transform') !== old, mainBeforePan);
            await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
            const pannedViewport = await page.locator('.x6-widget-minimap-viewport').boundingBox();
            assert(pannedViewport.x < draggedViewport.x && pannedViewport.y < draggedViewport.y, 'Main panning moves the overview viewport in the opposite direction');
            await page.mouse.wheel(0, -240);
            await page.waitForFunction(width => document.querySelector('.x6-widget-minimap-viewport').getBoundingClientRect().width < width, pannedViewport.width);
            await page.screenshot({ path: path.join(output, `${kind}-navigator.png`) });
            // Reprojection changes content bounds while preserving the active navigator.
            layout = await page.evaluate(() => Object.values(window.savedWebviewState.layouts)[0]);
            for (let i = 1; i < 18; i++) design.instances.push({ name: `u_counter_${i}`, module: 'counter', definitionKey: 'counter' });
            revision++;
            await state();
            await page.waitForFunction(() => document.querySelectorAll('#minimap .x6-node').length === 18);
            await page.locator('#fit-button').click();
            const afterFit = await matrix();
            await page.locator('#minimap-button').click();
            await page.locator('#minimap-button').click();
            assert.equal(await matrix(), afterFit, 'Toggling the minimap after updates must not fit the main canvas');
            await page.locator('#zoom-reset-button').click();
            await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
            await page.waitForFunction(() => document.querySelector('.x6-widget-minimap-viewport').getBoundingClientRect().height > 0);
            const mini = page.locator('#minimap .x6-graph');
            const overview = await mini.boundingBox();
            const beforeClick = await matrix();
            const target = { x: overview.width / 2, y: overview.height * 0.8 };
            await mini.click({ position: target, force: true });
            await page.waitForFunction(old => document.querySelector('#canvas .x6-graph-svg-viewport').getAttribute('transform') !== old, beforeClick);
            await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
            const clickedViewport = await page.locator('.x6-widget-minimap-viewport').boundingBox();
            assert(Math.abs(clickedViewport.x + clickedViewport.width / 2 - overview.x - target.x) < 2, 'Click must center the main viewport at the navigator point');
            assert(Math.abs(clickedViewport.y + clickedViewport.height / 2 - overview.y - target.y) < 2, 'Click must use the actual overview scale');
            await page.mouse.move(clickedViewport.x + clickedViewport.width / 2, clickedViewport.y + clickedViewport.height / 2);
            await page.mouse.down();
            await page.mouse.move(clickedViewport.x + clickedViewport.width / 2 + 10, clickedViewport.y + clickedViewport.height / 2 - 8, { steps: 4 });
            await page.mouse.up();
            await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
            const updatedDraggedViewport = await page.locator('.x6-widget-minimap-viewport').boundingBox();
            assert(Math.abs(updatedDraggedViewport.x - clickedViewport.x - 10) < 2, 'Dragging after reprojection uses the updated overview scale');
            assert(Math.abs(updatedDraggedViewport.y - clickedViewport.y + 8) < 2);
            await page.screenshot({ path: path.join(output, `${kind}-navigator-updated.png`) });
            assert.deepEqual(errors, []);
            await page.close();
        }
        console.log('Real X6 AD/ST single-line headers and navigator fit, drag, click, zoom, update, toggle passed');
    } finally { await browser.close(); server.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
