import assert from 'node:assert/strict';
import { access } from 'node:fs/promises';
import * as path from 'node:path';
import { chromium } from 'playwright';
import { boardLibraryHtml } from '../archDesign/boardLibraryView';
import { emptyBoard, inspectBoardDraft, wiringRows, parseBoardDraft, validateInterfaceDefinition } from '../archDesign/boardEditorModel';
import { readPhysicalBoardFile } from '../archDesign/physicalBoardLibrary';
declare const window: any;
declare const document: any;

async function main(): Promise<void> {
    const bundled = await access(chromium.executablePath()).then(() => true, () => false);
    const browser = await chromium.launch({ headless: true, ...(!bundled && process.platform === 'win32' ? { channel: 'msedge' } : {}) });
    try {
        const page = await browser.newPage(), errors: string[] = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.addInitScript(() => { (window as any).messages = []; (window as any).acquireVsCodeApi = () => ({ postMessage: (message: any) => (window as any).messages.push(message) }); });
        await page.goto('about:blank');
        await page.setContent(boardLibraryHtml());
        const draft = emptyBoard(); draft.id = 'manual'; draft.name = 'Manual';
        draft.model = { kind: 'board', vendor: 'amd', device: 'xcau15p-ffvb676-2-i',
            banks: [{ id: '84', type: 'hd', supplyRail: 'V' }], rails: [{ id: 'V', millivolts: 3300 }],
            fpgaPins: [{ id: 'P1', bank: '84' }, { id: 'N1', bank: '84' }], differentialPairs: [{ positive: 'P1', negative: 'N1' }],
            interfaces: [], routes: [] };
        const definition = { kind: 'fixed' as const, signals: ['clk_p', 'clk_n'], function: { input: { clk_p: 'input' as const, clk_n: 'input' as const } }, differentialPairs: [{ positive: 'clk_p', negative: 'clk_n' }] };
        const state = { type: 'state', draft, boards: [], templates: [{ name: 'Clock', reference: 'clock.json', definition }], ...inspectBoardDraft(draft), rows: wiringRows(draft) };
        await page.evaluate(state => window.dispatchEvent(new MessageEvent('message', { data: state })), state);
        await page.locator('[id="field:name"]').fill('Manual revision');
        assert.equal(await page.evaluate(() => (window as any).messages.filter((m: any) => m.type === 'change').at(-1)?.draft.name), 'Manual revision', 'typing must reach the host before blur so Ctrl+S and dirty-close see current text');
        await page.locator('#instance-id').fill('CLK');
        await page.locator('#add-interface').click();
        await page.locator('[data-wire-member="clk_p"] input[data-pin]').fill('P1');
        await page.locator('[data-wire-member="clk_p"] input[data-pin]').press('Tab');
        assert.equal(await page.locator('[data-wire-member="clk_n"] input[data-pin]').inputValue(), 'N1');
        const changed = await page.evaluate(() => (window as any).messages.filter((m: any) => m.type === 'change').at(-1).draft);
        assert.equal(changed.model.routes.length, 2);
        assert.deepEqual(inspectBoardDraft(changed).issues.filter(i => i.severity === 'error'), []);
        await page.evaluate(result => window.dispatchEvent(new MessageEvent('message', { data: { type: 'validation', ...result } })), inspectBoardDraft(changed));
        await page.locator('#save').click();
        assert.equal(await page.evaluate(() => (window as any).messages.at(-1).type), 'save');
        await page.evaluate(() => window.dispatchEvent(new MessageEvent('message', { data: { type: 'validation', issues: [{ severity: 'error', message: 'Bad pin', target: 'route:CLK:clk_p' }], summary: { interfaces: 1, mapped: 2, total: 2, sharedPins: 0, banks: [] } } })));
        await page.getByRole('button', { name: 'Bad pin' }).click();
        assert.equal(await page.locator('[data-wire-member="clk_p"] input[data-pin]').evaluate(el => el === document.activeElement), true);
        assert.equal(await page.locator('#save').isDisabled(), true);
        // Exercise the whole manual-entry path, including a board-specific interface.
        await page.evaluate(state => window.dispatchEvent(new MessageEvent('message', { data: state })), { ...state, draft: emptyBoard(), ...inspectBoardDraft(emptyBoard()), templates: [] });
        for (const [key, value] of Object.entries({ id: 'handmade', name: 'Handmade', vendor: 'amd', device: 'xcau15p-ffvb676-2-i' }))
            await page.locator('[id="field:' + key + '"]').fill(value);
        await page.locator('#banks').getByRole('button', { name: 'Add Row' }).click();
        await page.locator('#banks tr').nth(1).locator('input').nth(0).fill('84');
        await page.locator('#banks tr').nth(1).locator('select').selectOption('hd');
        await page.locator('#banks tr').nth(1).locator('input').nth(1).fill('VCC');
        await page.locator('#rails').getByRole('button', { name: 'Add Row' }).click();
        await page.locator('#rails tr').nth(1).locator('input').nth(0).fill('VCC');
        await page.locator('#rails tr').nth(1).locator('input').nth(1).fill('3300');
        await page.locator('details').filter({ has: page.locator('#pins') }).locator('summary').click();
        await page.locator('#pins').getByRole('button', { name: 'Add Row' }).click();
        await page.locator('#pins tr').nth(1).locator('input').nth(0).fill('P1');
        await page.locator('#pins tr').nth(1).locator('input').nth(1).fill('84');
        await page.locator('#custom').click();
        await page.locator('#template-id').fill('led'); await page.locator('#template-name').fill('LED');
        await page.locator('#template-signals').getByRole('button', { name: 'Add Row' }).click();
        await page.locator('#template-signals tr').nth(1).locator('input').nth(0).fill('led');
        await page.locator('#template-signals tr').nth(1).locator('select').selectOption('output');
        await page.locator('#use-template').click();
        const manualTemplate = await page.evaluate(() => (window as any).messages.at(-1));
        validateInterfaceDefinition(manualTemplate.definition);
        await page.evaluate(template => window.dispatchEvent(new MessageEvent('message', { data: { type: 'templates', templates: [{ reference: template.reference, name: template.name, definition: template.definition }], reference: template.reference } })), manualTemplate);
        await page.locator('#instance-id').fill('LED0'); await page.locator('#add-interface').click();
        await page.locator('[data-wire-member="led"] input[data-pin]').fill('P1');
        const manual = parseBoardDraft(await page.evaluate(() => (window as any).messages.filter((m: any) => m.type === 'change').at(-1).draft));
        assert.deepEqual(inspectBoardDraft(manual).issues.filter(i => i.severity === 'error'), []);
        assert.equal(manual.model.routes[0].pin, 'P1');
        // Load and rename an AU15P interface without losing bus routes or clocks.
        const root = path.resolve(__dirname, '../../../data/physical-models');
        const au15p = { id: 'au15p', name: 'AU15P', ...await readPhysicalBoardFile(path.join(root, 'boards/atk-au15p/board.json'), path.join(root, 'interfaces')) };
        const auState = { ...state, draft: au15p, ...inspectBoardDraft(au15p), templates: Object.entries(au15p.definitions).map(([reference, definition]) => ({ reference, name: reference, definition })) };
        await page.evaluate(state => window.dispatchEvent(new MessageEvent('message', { data: state })), auState);
        await page.locator('#instances').getByRole('button', { name: 'Edit', exact: true }).first().click();
        await page.locator('#instance-id').fill('CLK_REV2'); await page.locator('#add-interface').click();
        const revised = parseBoardDraft(await page.evaluate(() => (window as any).messages.filter((m: any) => m.type === 'change').at(-1).draft));
        assert.equal(revised.model.routes.length, 302);
        assert.deepEqual(inspectBoardDraft(revised).issues.filter(i => i.severity === 'error'), []);
        await page.evaluate(result => window.dispatchEvent(new MessageEvent('message', { data: { type: 'validation', ...result } })), inspectBoardDraft(revised));
        await page.setViewportSize({ width: 1440, height: 1080 });
        assert.equal(await page.evaluate(() => (globalThis as any).document.documentElement.scrollWidth <= (globalThis as any).innerWidth), true, 'long interface specifications must stay inside the editor column');
        await page.evaluate(() => (globalThis as any).scrollTo(0, 0));
        await page.screenshot({ path: path.resolve(__dirname, '../board-editor-preview.png') });
        assert.deepEqual(errors, []);
        console.log('Board editor browser: manual interface, differential auto-completion, issue navigation and save passed');
    } finally { await browser.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
