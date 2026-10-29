import assert from 'node:assert/strict';
import { access } from 'node:fs/promises';
import { chromium } from 'playwright';
import { boardLibraryHtml } from '../archDesign/boardLibraryView';
import { emptyBoard, inspectBoardDraft, parseBoardDraft, physicalPins } from '../archDesign/boardEditorModel';
async function main() {
    const bundled = await access(chromium.executablePath()).then(() => true, () => false);
    const browser = await chromium.launch({ headless: true, ...(!bundled && process.platform === 'win32' ? { channel: 'msedge' } : {}) });
    try {
        const page = await browser.newPage(), errors: string[] = [];
        page.on('pageerror', e => errors.push(e.message));
        let draft = emptyBoard();
        draft.id = 'manual';
        draft.name = 'Manual';
        draft.model.constraints = 'set_property PACKAGE_PIN A1 [get_ports tx]\nset_property PACKAGE_PIN A2 [get_ports rx]\n';
        await page.exposeFunction('sendMockMessage', async (m: any) => { if (m.type === 'change') {
            draft = parseBoardDraft(m.draft);
            await page.evaluate((data: any) => (globalThis as any).dispatchEvent(new MessageEvent('message', { data })), { type: 'validation', ...inspectBoardDraft(draft), pins: physicalPins(draft.model) });
        } });
        await page.setContent(boardLibraryHtml().replace(/(<script nonce="[^"]+">)/, '$1\nfunction acquireVsCodeApi(){return{postMessage:m=>window.sendMockMessage(m)}};'));
        assert.equal(await page.getByRole('button', { name: 'Import board', exact: true }).count(), 1);
        await page.evaluate((data: any) => (globalThis as any).dispatchEvent(new MessageEvent('message', { data })), { type: 'state', draft, saved: false, boards: [], ...inspectBoardDraft(draft), pins: physicalPins(draft.model) });
        await page.locator('#add-interface').click();
        await page.getByLabel('Interface name', { exact: true }).fill('UART0');
        await page.getByLabel('Interface name', { exact: true }).press('Tab');
        await page.getByRole('button', { name: 'Add signal', exact: true }).click();
        await page.getByLabel('Signal name', { exact: true }).fill('tx');
        await page.getByLabel('Signal name', { exact: true }).press('Tab');
        await page.locator('#interface-list select').first().selectOption('output');
        await page.getByRole('button', { name: 'Add signal', exact: true }).click();
        await page.getByLabel('Signal name', { exact: true }).nth(1).fill('rx');
        await page.getByLabel('Signal name', { exact: true }).nth(1).press('Tab');
        // Re-render after names change so pin labels use the edited signal names.
        await page.evaluate((data: any) => (globalThis as any).dispatchEvent(new MessageEvent('message', { data })), { type: 'state', draft, saved: false, boards: [], ...inspectBoardDraft(draft), pins: physicalPins(draft.model) });
        await page.getByLabel('UART0 tx pin 0', { exact: true }).selectOption('A1');
        await page.getByLabel('UART0 rx pin 0', { exact: true }).selectOption('A2');
        await page.waitForFunction(() => (globalThis as any).document.querySelector('#save').disabled === false);
        assert.deepEqual(draft.model.interfaces, [{ id: 'UART0', signals: [{ id: 'tx', direction: 'output', pins: ['A1'] }, { id: 'rx', direction: 'input', pins: ['A2'] }] }]);
        assert.equal((await page.locator('#constraints').inputValue()), draft.model.constraints);
        assert.deepEqual(errors, []);
        console.log('Board browser creates UART with input/output and matches imported pins');
    }
    finally {
        await browser.close();
    }
}
main().catch(e => { console.error(e); process.exitCode = 1; });
