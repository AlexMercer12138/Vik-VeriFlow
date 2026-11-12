import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { chromium } from 'playwright';
import { ConstraintWorkbench, UserPhysicalBoardLibrary, type ConstraintSource } from '@veriflow/hdl-runtime/physical';
async function main() {
    const root = await mkdtemp(path.join(os.tmpdir(), 'vf-ui-'));
    const browser = await chromium.launch({ headless: true, channel: 'msedge' });
    try {
        const page = await browser.newPage({ viewport: { width: 1440, height: 940 } }), errors: string[] = [];
        page.on('pageerror', e => errors.push(e.message));
        const assertFrameFits = async (action: string) => {
            for (const viewport of [
                { width: 1440, height: 940 },
                { width: 900, height: 600 },
                { width: 600, height: 360 },
            ]) {
                await page.setViewportSize(viewport);
                for (const selector of ['#constraints-shell', '.topbar', '.footer', action]) {
                    const bounds = await page.locator(selector).boundingBox();
                    assert.ok(bounds, `${selector} must be visible`);
                    assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= viewport.width,
                        `${selector} must fit the ${viewport.width}px webview width`);
                    assert.ok(bounds.y >= 0 && bounds.y + bounds.height <= viewport.height,
                        `${selector} must fit the ${viewport.height}px webview height`);
                }
            }
            await page.setViewportSize({ width: 1440, height: 940 });
        };
        const library = new UserPhysicalBoardLibrary({ configPath: path.join(root, 'config.json') });
        library.saveBoard({ id: 'b', name: 'Carrier', model: { kind: 'board', extension: '.pcf', pins: { tx: 'set_io {signal name} A1\n', p3: 'P3 {signal name}', p2: 'P2 {signal name}', p1: 'P1 {signal name}', p0: 'P0 {signal name}' }, interfaces: [{ id: 'UART', signals: [{ id: 'tx', direction: 'output', pins: ['tx'] }, {id:'wide',direction:'output',pins:['p3','p2','p1','p0']}] }] } });
        const configPath = path.join(root, 'config.json');
        const config = JSON.parse(await readFile(configPath, 'utf8'));
        config.boards.push({ id: 'old', name: 'Old', model: { pins: [{ name: 'A1' }], interfaces: [] } });
        await writeFile(configPath, JSON.stringify(config));
        const file = path.join(root, 'top.v');
        await writeFile(file, 'module top(output tx,input rx);endmodule');
        let last: any;
        const session = new ConstraintWorkbench({ library, source: async (): Promise<ConstraintSource> => ({ path: file, text: await readFile(file, 'utf8'), module: 'top', isAd: false, ports: [{ name: 'tx', direction: 'output' }, { name: 'rx', direction: 'input' }, {name:'data',direction:'output',indices:[4,5]}, {name:'bus',direction:'output',indices:[3,2,1,0]}, {name:'flag0',direction:'output'}, {name:'pair',direction:'output',indices:[1,0]}, {name:'flag1',direction:'output'}], configurationPath: path.join(root, 'top.pins.json'), inputs: [] }), saveAd: async (s) => s, openFile: async () => undefined, saveFile: async (_k, s) => s, confirmDelete: async () => true }, message => { last = message; void page.evaluate((data: any) => { (globalThis as any).__workbenchState = data; (globalThis as any).dispatchEvent(new MessageEvent('message', { data })); }, message).catch(() => {}); });
        const sent: any[] = [];
        await page.exposeFunction('sendToHost', (m: any) => { sent.push(m); return session.dispatch(m); });
        const assets = path.resolve(__dirname, '../../../web-dist/constraints');
        let html = await readFile(path.join(assets, 'index.html'), 'utf8');
        const css = await readFile(path.join(assets, 'index.css'), 'utf8'), script = await readFile(path.join(assets, 'index.js'), 'utf8');
        html = html.replace(/<meta http-equiv="Content-Security-Policy"[^>]+>/, '').replace(/<link rel="stylesheet" href="(?:\.\/)?index\.css">/, '<style>' + css + '</style>').replace(/<script src="(?:\.\/)?index\.js"><\/script>/, '<script>window.acquireVsCodeApi=()=>({postMessage:m=>window.sendToHost(m),getState:()=>undefined,setState:()=>undefined});</script><script>' + script + '</script>');
        // VS Code injects horizontal body padding before the application's CSS.
        html = html.replace('<head>', '<head><style>body { padding: 0 20px; }</style>');
        await page.setContent(html);
        await session.open();
        assert.deepEqual(errors, [], errors.join('\n'));
        assert.deepEqual(JSON.parse(await readFile(configPath, 'utf8')).boards.map((board: any) => board.id), ['b']);
        assert.equal(await page.locator('#workbench-error').isVisible(), false);
        assert.equal(await page.locator('#library-context').isVisible(), true);
        await assertFrameFits('#save-board');
        await page.locator('[data-page="library"]').click();
        await page.locator('#new-board').click();
        assert.equal(await page.locator('#new-board-dialog').isVisible(), true);
        await page.locator('#new-name').fill('Fresh board');
        assert.equal(await page.locator('#new-extension').inputValue(), '.xdc');
        await page.locator('#confirm-new-board').click();
        await page.waitForFunction(() => (globalThis as any).document.querySelector('#board-title')?.textContent === 'Fresh board');
        await page.locator('#board-list .board-option').filter({ hasText: 'Carrier' }).click();
        await page.getByRole('button',{name:'Edit template tx',exact:true}).click();
        assert.equal(await page.locator('#template-preview').innerText(), '# Single signal: bit\nset_io bit A1\n\n# Bus bit: bus[0]\nset_io bus[0] A1\n');
        await page.locator('[data-section="interfaces"]').click();
        assert.equal(await page.getByRole('button',{name:'Edit UART.wide pin templates',exact:true}).innerText(),'4/4 pins · Edit');
        assert.equal(await page.getByLabel('UART wide bit 3 template',{exact:true}).count(),0);
        await page.getByRole('button',{name:'Edit UART.wide pin templates',exact:true}).click();
        assert.equal(await page.getByLabel('UART wide bit 3 template',{exact:true}).inputValue(),'p3');
        await page.getByText('Paste pin names',{exact:true}).click();
        await page.getByLabel('Pin templates for UART.wide, high bit first',{exact:true}).fill('p0, p1, p2, p3');
        await page.getByRole('button',{name:'Apply UART.wide pin templates',exact:true}).click();
        await page.waitForFunction(() => (globalThis as any).__workbenchState?.draft.model.interfaces[0].signals[1].pins.join(',') === 'p0,p1,p2,p3');
        await page.getByLabel('Pin templates for UART.wide, high bit first',{exact:true}).fill('p3\np2\np1\np0');
        await page.getByRole('button',{name:'Apply UART.wide pin templates',exact:true}).click();
        await page.waitForFunction(() => (globalThis as any).__workbenchState?.draft.model.interfaces[0].signals[1].pins.join(',') === 'p3,p2,p1,p0');
        await page.getByRole('button',{name:'Edit UART.wide pin templates',exact:true}).click();
        await page.locator('[data-section="pins"]').click();
        await session.open(file);
        assert.equal(await page.locator('#export').isEnabled(), true);
        await assertFrameFits('#export');
        await page.locator('#export').click();
        await page.waitForFunction(() => (globalThis as any).document.querySelector('#workbench-error')?.textContent?.includes('Choose a board'));
        await page.locator('[data-page="library"]').click();
        await page.locator('#board-list .board-option').first().click();
        await page.locator('[data-page="bindings"]').click();
        await page.locator('#board-context').selectOption('user:b');
        await page.getByLabel('Select signal UART.tx',{exact:true}).check();
        await page.getByRole('button', { name: 'Bind Carrier UART.tx', exact: true }).waitFor();
        await page.getByRole('button', { name: 'Port rx', exact: true }).dragTo(page.getByRole('button', { name: 'Bind Carrier UART.tx', exact: true }));
        assert.equal(last.configuration.bindings.length, 0);
        await page.getByRole('button', { name: 'Port tx', exact: true }).dragTo(page.getByRole('button', { name: 'Bind Carrier UART.tx', exact: true }));
        await page.waitForFunction(() => (globalThis as any).document.querySelector('#export-preview')?.textContent?.includes('set_io tx A1'));
        assert.equal(last.configuration.bindings[0].port.name, 'tx');
        await page.locator('[data-page="library"]').click();
        await page.getByRole('button',{name:'Edit template tx',exact:true}).click();
        await page.locator('#template-text').fill('set_io {signal name} A2\n');
        await page.locator('[data-page="bindings"]').click();
        await page.locator('[data-page="library"]').click();
        await page.waitForFunction(() => (globalThis as any).document.querySelector('#template-text')?.value.includes('A2'));
        assert.equal(await page.locator('#detail-id').count(), 0);
        await page.locator('#save-board').click();
        await page.waitForFunction(() => (globalThis as any).document.querySelector('#toast-text')?.textContent === 'Board saved');
        assert.equal(library.get('b').model.pins.tx, 'set_io {signal name} A2\n');
        await page.locator('[data-page="bindings"]').click();
        await page.locator('#export').click();
        await page.waitForFunction(() => (globalThis as any).document.querySelector('#toast-text')?.textContent === 'Constraints exported');
        assert.equal(await readFile(path.join(root, 'top.pcf'), 'utf8'), 'set_io tx A2\n');
        assert.equal(await page.locator('.width').first().innerText(), '1');
        assert.match(await page.getByRole('button', {name:'Port bus',exact:true}).innerText(), /bus\[3:0\]/);
        const wideName = page.getByRole('button', {name:'wide [3:0]',exact:true});
        await wideName.click();
        const wideRow = page.locator('tr[data-key]').filter({hasText:'wide'}).first();
        await wideRow.waitFor();
        await wideName.click();
        await wideRow.waitFor({state:'detached'});
        await wideName.click();
        await wideRow.waitFor();
        await page.getByLabel('Select port flag1',{exact:true}).check();
        await page.getByLabel('Select port pair',{exact:true}).check();
        await page.getByLabel('Select port flag0',{exact:true}).check();
        await page.getByRole('button',{name:'Port pair',exact:true}).dragTo(wideRow);
        await page.waitForFunction(() => Array.from((globalThis as any).document.querySelectorAll('.port-chip')).map((el:any)=>el.textContent).join(',').includes('flag0,pair[1:0],flag1'));
        assert.deepEqual(last.configuration.bindings.filter((b:any)=>b.source.member.startsWith('wide.')).map((b:any)=>b.port),[{name:'flag0'},{name:'pair',bit:1},{name:'pair',bit:0},{name:'flag1'}]);
        await wideRow.locator('.port-chip').last().dragTo(wideRow.locator('.port-chip').first(),{targetPosition:{x:2,y:8}});
        await wideRow.locator('.port-chip').first().filter({hasText:'flag1'}).waitFor();
        assert.deepEqual(last.configuration.bindings.filter((b:any)=>b.source.member.startsWith('wide.')).map((b:any)=>b.port),[{name:'flag1'},{name:'flag0'},{name:'pair',bit:1},{name:'pair',bit:0}]);
        await page.getByRole('button',{name:'Expand port bus',exact:true}).click();
        await page.getByRole('button',{name:'Port bus[3]',exact:true}).dragTo(page.getByRole('button',{name:'Bind Carrier UART.tx',exact:true}));
        await page.waitForFunction(() => (globalThis as any).document.querySelector('#export-preview')?.textContent?.includes('set_io bus[3] A2'));
        assert.equal(last.configuration.bindings.find((b:any)=>b.source.member==='tx').port.bit,3);
        await page.getByRole('button',{name:'Port tx',exact:true}).dragTo(page.getByRole('button',{name:'Bind Carrier UART.tx',exact:true}));
        await page.waitForFunction(() => (globalThis as any).document.querySelector('#export-preview')?.textContent?.includes('set_io tx A2'));
        await wideName.click();
        await wideRow.waitFor({state:'detached'});
        await page.getByRole('button',{name:'Expand port pair',exact:true}).click();
        await page.getByRole('button',{name:'Port pair[1]',exact:true}).click();
        await page.getByRole('button',{name:'Port pair[0]',exact:true}).click({modifiers:['Control']});
        await page.getByRole('button',{name:'Port flag1',exact:true}).click({modifiers:['Control']});
        await page.getByRole('button',{name:'Port flag0',exact:true}).click({modifiers:['Control']});
        await wideName.click();
        await wideRow.waitFor();
        await page.getByRole('button',{name:'Port pair[0]',exact:true}).dragTo(wideRow);
        await wideRow.locator('.port-chip').filter({hasText:'pair[1:0]'}).waitFor();
        assert.deepEqual(last.configuration.bindings.filter((b:any)=>b.source.member.startsWith('wide.')).map((b:any)=>b.port),[{name:'flag0'},{name:'pair',bit:1},{name:'pair',bit:0},{name:'flag1'}]);
        await page.locator('[data-page="library"]').click();
        const retainedTemplate = await page.locator('#template-text').elementHandle();
        await page.locator('[data-page="bindings"]').click();
        const priorSelections = sent.filter(m=>m.type==='select').length;
        await page.locator('#interfaces .group-line input').uncheck();
        await page.waitForFunction(() => (globalThis as any).document.querySelectorAll('tr[data-key]').length === 0);
        await page.waitForFunction(() => (globalThis as any).__workbenchState?.active.length === 0);
        const selections = sent.filter(m=>m.type==='select');
        assert.equal(selections.length,priorSelections+1);
        assert.equal(selections[selections.length-1].changes.length,2);
        // Both members are deselected by one host command; hidden library nodes survive.
        await page.getByLabel('Select signal UART.tx',{exact:true}).check();
        await page.getByRole('button',{name:'Bind Carrier UART.tx',exact:true}).waitFor();
        assert.equal(await retainedTemplate!.evaluate((el:any)=>el.isConnected),true);
        await page.getByRole('button',{name:'Port tx',exact:true}).dragTo(page.getByRole('button',{name:'Bind Carrier UART.tx',exact:true}));
        await page.setViewportSize({ width: 900, height: 820 });
        assert.equal(await page.locator('#port-browser').isVisible(), true);
        library.saveBoard({id:'c',name:'Card',model:{kind:'daughtercard',extension:'.pcf',pins:{hi:'set_io {signal name} {pin name}\n',lo:'set_io {signal name} {pin name}\n'},interfaces:[{id:'GPIO',signals:[{id:'data',direction:'output',pins:['hi','lo']}]}]}});
        await session.publish();
        await page.locator('#add-card').click();await page.locator('#card-model').selectOption('c');await page.locator('#confirm-card').click();
        await page.locator('#toggle-interfaces').click();
        await page.getByRole('button',{name:'data [1:0]',exact:true}).click();
        await page.getByRole('button',{name:'Close interfaces',exact:true}).click();
        await session.dispatch({type:'select',card:last.configuration.cards[0].id,interface:'GPIO',signal:'data',checked:true});
        await page.getByRole('button',{name:'Port data',exact:true}).dragTo(page.getByRole('button',{name:'Bind Card GPIO.data',exact:true}));
        await page.getByRole('button',{name:'Edit 2 pins',exact:true}).click();
        await page.getByLabel('GPIO.data data.1 FPGA pin',{exact:true}).fill('B7');await page.getByLabel('GPIO.data data.1 FPGA pin',{exact:true}).press('Tab');
        await page.getByLabel('GPIO.data data.0 FPGA pin',{exact:true}).fill('B8');await page.getByLabel('GPIO.data data.0 FPGA pin',{exact:true}).press('Tab');
        await page.waitForFunction(()=>(globalThis as any).document.querySelector('#export-preview')?.textContent?.includes('data[5] B8'));
        assert.match(await page.locator('#export-preview').innerText(),/data\[4\] B7/);
        await page.setViewportSize({width:1440,height:940});await page.locator('[data-page="library"]').click();await page.locator('#new-board').click();await page.locator('#new-name').fill('New carrier');await page.locator('#new-extension').fill('.custom');await page.locator('#confirm-new-board').click();
        await page.waitForFunction(()=>(globalThis as any).document.querySelector('#board-title')?.textContent==='New carrier');assert.match(last.draft.id,/^[0-9a-f-]{36}$/);
        await page.locator('#add-pin').click();await page.locator('#pin-name').fill('clock');await page.locator('#pin-name').press('Tab');await page.locator('#template-text').fill('CLOCK {signal name}');
        await page.getByLabel('Select template clock',{exact:true}).check();await page.locator('#create-from-pins').click();await page.getByLabel('Interface name',{exact:true}).fill('CLK');await page.getByLabel('Interface name',{exact:true}).press('Tab');
        await page.locator('#save-board').click();await page.waitForFunction(()=>(globalThis as any).document.querySelector('#toast-text')?.textContent==='Board saved');assert.equal(library.get(last.draft.id).model.interfaces[0].id,'CLK');
        const templates=Array.from({length:32},(_,index)=>'p'+index);
        library.saveBoard({id:'wide-board',name:'Wide I/O',model:{kind:'board',extension:'.pcf',pins:Object.fromEntries(templates.map((name,index)=>[name,'set_io {signal name} A'+index])),interfaces:[
            {id:'RGB',signals:[{id:'color',direction:'output',pins:templates.slice(0,24).reverse()}]},
            {id:'DDR',signals:[{id:'data',direction:'inout',pins:templates.slice().reverse()}]},
        ]}});
        await session.dispatch({type:'board-open',id:'wide-board'});
        await page.getByRole('button',{name:'Edit RGB.color pin templates',exact:true}).waitFor();
        assert.equal(await page.getByRole('button',{name:'Edit RGB.color pin templates',exact:true}).innerText(),'24/24 pins · Edit');
        assert.equal(await page.getByRole('button',{name:'Edit DDR.data pin templates',exact:true}).innerText(),'32/32 pins · Edit');
        assert.equal(await page.locator('.signal-pin-list select').count(),0);
        await page.getByRole('button',{name:'Edit RGB.color pin templates',exact:true}).click();
        assert.equal(await page.locator('.signal-pin-list select').count(),24);
        await page.getByRole('button',{name:'Edit DDR.data pin templates',exact:true}).click();
        assert.equal(await page.locator('.signal-pin-list select').count(),32);
        const mappings=page.locator('.signal-pin-list');
        assert.ok(await mappings.evaluate((el:any)=>el.scrollHeight>el.clientHeight&&el.clientHeight<=240));
        await page.getByLabel('DDR data bit 31 template',{exact:true}).selectOption('p30');
        await page.getByLabel('DDR data bit 30 template',{exact:true}).selectOption('p31');
        await page.waitForFunction(()=>(globalThis as any).__workbenchState?.draft.model.interfaces[1].signals[0].pins[0]==='p30');
        await page.getByText('Paste pin names',{exact:true}).click();
        const bulk=page.getByLabel('Pin templates for DDR.data, high bit first',{exact:true});
        const apply=page.getByRole('button',{name:'Apply DDR.data pin templates',exact:true});
        for(const [names,error] of [
            ['p0, p1','Enter exactly 32 template names'],
            [Array(32).fill('p0').join(','),'Each bit needs a different pin template'],
            [[...templates.slice(0,31),'missing'].join(','),'Unknown template: missing'],
        ]) {
            await bulk.fill(names);await apply.click();
            assert.match(await page.locator('.signal-pin-error').innerText(),new RegExp(error));
            assert.equal(last.draft.model.interfaces[1].signals[0].pins[0],'p30');
        }
        await bulk.fill(templates.join('\n'));await apply.click();
        await page.waitForFunction(()=>(globalThis as any).__workbenchState?.draft.model.interfaces[1].signals[0].pins[0]==='p0');
        assert.equal(await page.getByLabel('DDR data bit 31 template',{exact:true}).inputValue(),'p0');
        assert.equal(await page.getByLabel('DDR data bit 0 template',{exact:true}).inputValue(),'p31');
        for(const width of [1440,900,600]) {
            await page.setViewportSize({width,height:820});
            assert.ok(await page.locator('.signal-pin-editor').evaluate((el:any)=>el.scrollWidth<=el.clientWidth));
            const bounds=await page.getByLabel('DDR data bit 31 template',{exact:true}).boundingBox();
            assert.ok(bounds&&bounds.width>=160&&bounds.x+bounds.width<=width);
        }
        await page.locator('#save-board').click();
        await page.waitForFunction(()=>(globalThis as any).__workbenchState?.dirty===false);
        assert.deepEqual(library.get('wide-board').model.interfaces[1].signals[0].pins,templates);
        await page.setViewportSize({width:1440,height:940});
        await page.locator('#board-list .board-option').filter({hasText:'Card'}).click();
        await page.locator('[data-section="pins"]').click();
        await page.getByRole('button',{name:'Edit template hi',exact:true}).click();
        assert.equal(await page.locator('#template-preview').innerText(),'# Single signal: bit\nset_io bit B7\n\n# Bus bit: bus[0]\nset_io bus[0] B7\n');
        assert.deepEqual(errors, []);
        console.log('Shared workbench browser: real drag/drop, validation, retained board drafts, hidden IDs and file export passed');
    }
    finally {
        await browser.close();
        await rm(root, { recursive: true, force: true });
    }
}
main().catch(e => { console.error(e); process.exitCode = 1; });
