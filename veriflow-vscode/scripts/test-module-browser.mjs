import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';

let render;
try {
    const compiled = await build({ entryPoints: [fileURLToPath(new URL('../src/workbench/moduleBrowserWebview.ts', import.meta.url))], bundle: true, format: 'esm', platform: 'node', write: false, logLevel: 'silent' });
    ({ moduleBrowserHtml: render } = await import('data:text/javascript;base64,' + Buffer.from(compiled.outputFiles[0].text).toString('base64')));
} catch (error) { if (!error.errors?.some(item => item.text.includes('Could not resolve'))) throw error; }
assert.equal(typeof render, 'function', 'Module Browser provides a persistent filter above an accessible tree');
const browser = await chromium.launch({ headless: true,
    ...(!existsSync(chromium.executablePath()) && process.platform === 'win32' ? { channel: 'msedge' } : {}) });
try {
    const page = await browser.newPage({ viewport: { width: 310, height: 260 } });
    await page.addInitScript(() => {
        window.messages = [];
        window.acquireVsCodeApi = () => ({ postMessage: value => window.messages.push(value), getState: () => undefined, setState: () => {} });
    });
    await page.goto('data:text/html,' + encodeURIComponent(render('test-nonce')));
    await page.evaluate(() => window.dispatchEvent(new MessageEvent('message', { data: {
        type: 'modules', roots: [{ id: 'root', kind: 'root', label: 'Workspace', tooltip: '/workspace', children: [
            { id: 'rtl', kind: 'directory', label: 'rtl', children: [
                { id: 'a', kind: 'module', moduleKey: 'a', label: 'ALU', tooltip: 'ALU /first.v' },
                { id: 'b', kind: 'module', moduleKey: 'b', label: '<img src=x onerror=alert(1)>', tooltip: 'untrusted' },
                ...Array.from({ length: 35 }, (_, index) => ({ id: 'm' + index, kind: 'module', moduleKey: 'm' + index, label: 'counter_' + index, tooltip: 'counter' })),
            ] },
        ] }],
    } })));
    const filter = page.getByRole('textbox', { name: 'Filter modules' });
    await assert.equal(await filter.count(), 1);
    assert.equal(await page.getByRole('treeitem').count(), 2, 'roots start expanded and subdirectories start collapsed');
    await filter.fill(' alu ');
    assert.deepEqual(await page.getByRole('treeitem').allTextContents(), ['Workspace', 'rtl', 'ALU']);
    await filter.fill('not-present');
    assert.equal(await page.getByRole('treeitem').count(), 0);
    assert.ok(await page.getByText('No matching modules').isVisible());
    await filter.fill('');
    assert.equal(await page.getByRole('treeitem').count(), 2, 'clearing filter restores directory expansion');
    assert.equal(await page.locator('img').count(), 0, 'module names are text, never HTML');
    await page.getByRole('treeitem', { name: 'rtl', exact: true }).press('ArrowRight');
    await page.getByRole('treeitem', { name: 'ALU', exact: true }).click();
    assert.ok((await page.evaluate(() => window.messages)).some(message => message.type === 'open' && message.moduleKey === 'a'), 'ordinary click opens the declaration');
    const openedBeforeSelection = (await page.evaluate(() => window.messages)).filter(message => message.type === 'open').length;
    await page.getByRole('treeitem', { name: 'counter_0', exact: true }).click({ modifiers: ['Control'] });
    assert.equal((await page.evaluate(() => window.messages)).filter(message => message.type === 'open').length, openedBeforeSelection, 'multi-selection does not steal the canvas editor');
    const context = JSON.parse(await page.getByRole('treeitem', { name: 'ALU', exact: true }).getAttribute('data-vscode-context'));
    assert.deepEqual(context.moduleKeys, ['a', 'm0']);
    await page.getByRole('treeitem', { name: 'counter_0', exact: true }).press('Shift+ArrowDown');
    assert.equal(await page.locator('[aria-selected="true"]').count(), 2);
    await page.getByRole('treeitem', { name: 'ALU', exact: true }).dblclick();
    assert.ok((await page.evaluate(() => window.messages)).some(message => message.type === 'open' && message.moduleKey === 'a'));
    const before = await filter.boundingBox();
    await page.locator('#tree-scroll').evaluate(element => { element.scrollTop = element.scrollHeight; });
    const after = await filter.boundingBox();
    assert.equal(after.y, before.y, 'filter stays at top when modules scroll');
    await filter.fill('counter_34');
    await filter.press('ArrowDown');
    assert.equal(await page.evaluate(() => document.activeElement.getAttribute('role')), 'treeitem');
    await page.keyboard.press('End');
    assert.equal(await page.evaluate(() => document.activeElement.textContent), 'counter_34');
    await page.keyboard.press('Enter');
    assert.ok((await page.evaluate(() => window.messages)).some(message => message.type === 'open' && message.moduleKey === 'm34'));
    console.log('Module Browser live filter, scrolling, keyboard, selection, context, and escaping browser tests passed');
} finally { await browser.close(); }
