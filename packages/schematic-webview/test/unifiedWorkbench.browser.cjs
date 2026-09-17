const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const esbuild = require('esbuild');
const core = require('@veriflow/schematic-core');
const ad = require('@veriflow/schematic-core/arch-design');
const { describePreset } = require('@veriflow/hdl-runtime/simulationTask');
const root = path.resolve(__dirname, '../../..');
const output = path.join(root, '.artifacts/ad-st-core-ui');
fs.mkdirSync(output, { recursive: true });
esbuild.buildSync({ entryPoints: [path.join(root, 'packages/schematic-webview/src/index.ts')], bundle: true, platform: 'browser', format: 'iife', outfile: path.join(output, 'index.js') });
for (const file of ['index.html', 'index.css']) fs.copyFileSync(path.join(root,'packages/schematic-webview/src',file),path.join(output,file));
const definition = {key:'hdl:counter.v:counter', name:'counter', parameters:[{name:'WIDTH',defaultExpression:'8'}],ports:[{name:'clk',direction:'input',width:{kind:'known',bits:1}},{name:'count',direction:'output',width:{kind:'known',bits:8}}]};
const task = {format:'veriflow-simulation-task',schemaVersion:1,settings:{timeUnit:'1ns',timePrecision:'1ps',duration:1000000,waveform:{enabled:true,filename:'demo_tb.vcd'}}, instances:[],connections:[],logic:[],interfaceConnections:[],interfaceOverrides:{},presentation:{}};
let design = structuredClone(ad.createEmptyArchDesign('demo_tb'));
design.instances = [{name:'dut',module:'counter',definitionKey:definition.key}];
const catalog=[definition];
const messages=[];
let revision=1;
let execution={status:'idle',canOpenWave:false};
let kind='simulation-task';
let page;
async function send(data) { await page.evaluate(data=>window.postMessage(data,'*'),data); }
async function state() {
 for (const instance of task.instances.filter(item=>item.preset)) {
  const module=describePreset(instance.preset), key='preset:'+instance.id;
  const entry={key,name:module.module,parameters:[],ports:module.ports.map(port=>({...port,width:{kind:'known',bits:Number(port.width)}}))};
  const existing=catalog.findIndex(item=>item.key===key);
  if(existing<0) catalog.push(entry);else catalog[existing]=entry;
  const node=design.instances.find(item=>item.name===instance.id);if(node) node.module=module.module;
 }
 const projected=ad.projectArchDesignGraph(design,catalog,{fileUri:'file:///demo.st'});
 for(const node of projected.graph.nodes) {
  const instance=task.instances.find(item=>node.id==='instance:'+item.id);
  if(!instance?.preset) continue;
  const preset=instance.preset;
  node.subtitle=preset.kind==='protocol'?`${({axis:'AXI-STREAM',axi4lite:'AXI-Lite',axi4:'AXI-Full',rgb888:'RGB'})[preset.protocol]??preset.protocol.toUpperCase()} ${preset.role}`:preset.kind[0].toUpperCase()+preset.kind.slice(1);
  delete node.definitionKey;
 }
 const projection={design,catalog,moduleChoices:[{label:'counter',description:'counter.v',moduleName:'counter',definitionKey:definition.key}],validation:projected.validation,inspector:{interfaces:[],protocols:[]}};
 await send({type:'graph',revision:String(revision),graph:projected.graph,layout:{placement:core.createPlacement(projected.graph,core.assignColumns(projected.graph)),viewport:{x:0,y:0,zoom:1},minimap:false},fitOnFirstRender:revision===1});
 if(kind==='simulation-task') await send({type:'simulationTaskState',revision:String(revision),projection,task:{document:task,version:revision,execution}});
 else await send({type:'archDesignState',status:'editable',revision:String(revision),...projection});
}
async function initialize() {
 const projected=ad.projectArchDesignGraph(design,catalog,{fileUri:'file:///demo.st'});
 await send({type:'initialize',fileUri:'file:///demo.st',modules:[{key:projected.graph.moduleKey,name:'demo_tb'}],selectedModuleKey:projected.graph.moduleKey,documentKind:kind,editable:true});
 await state();
}
(async()=>{
 const server=http.createServer((req,res)=>{const file=path.join(output,req.url==='/'?'index.html':req.url.slice(1));res.setHeader('Content-Type',file.endsWith('.js')?'application/javascript':file.endsWith('.css')?'text/css':'text/html');res.end(fs.readFileSync(file));});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const browser=await chromium.launch({channel:'msedge',headless:true});
 try {
  page=await browser.newPage({viewport:{width:1280,height:850}});
  const errors=[];page.on('pageerror',e=>{errors.push(e.message);console.error(e.message);});
  await page.exposeFunction('hostMessage',async message=>{
   messages.push(message);
   if(message.type==='ready') return initialize();
   if(message.type==='saveLayout') return send({type:'archDesignLayoutSaved',revision:String(revision)});
   if(message.type==='simulationTaskCommand') {
    const p=message.payload;
    if(message.command==='addPreset') {
     task.instances.push({id:p.id,preset:p.preset});
     design.instances.push({name:p.id,module:describePreset(p.preset).module,definitionKey:'preset:'+p.id});
    }
    if(message.command==='updatePreset') task.instances.find(i=>i.id===p.id).preset=p.preset;
    if(message.command==='updateTaskSettings') task.settings=p.settings;
    if(message.command==='run') execution={status:'running',canOpenWave:false};
    if(message.command==='cancel') execution={status:'stopped',canOpenWave:true};
    revision++;return state();
   }
   if(message.type==='editSchematic'||message.type==='editArchDesign') {
    design=structuredClone(ad.applyArchDesignEdit(design,message.edit));
    revision++;return state();
   }
  });
  await page.addInitScript(()=>window.acquireVsCodeApi=()=>({postMessage:m=>window.hostMessage(m),getState:()=>({}),setState:()=>{}}));
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.locator('.x6-node').first().waitFor();
  await page.locator('#add-instance-button').click();
  assert.equal(await page.locator('#add-instance-dialog').evaluate(dialog=>dialog.open),true,'ST Add instance must open the same canvas dialog');
  assert.equal(messages.some(m=>m.command==='addModule'),false,'No QuickPick action');
  await page.screenshot({path:path.join(output,'st-same-dialog.png')});
  await page.locator('#instance-module-filter').fill('counter');
  assert.equal(await page.locator('#instance-module-select option').count(),1);
  assert.equal(await page.locator('#instance-name-input').inputValue(),'u_counter_0');
  await page.locator('#add-instance-submit').click();
  await page.waitForFunction(()=>!document.querySelector('#add-instance-button').disabled);
  assert.equal(messages.filter(m=>m.type==='editSchematic').at(-1).edit.type,'addInstance');
  await page.keyboard.press('a');
  assert.equal(await page.locator('#add-instance-dialog').evaluate(d=>d.open),true);
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('.simulation-task-actions,.simulation-task-drawer').count(),0);
  assert.equal(await page.locator('#toolbar').count(),1);
  assert.equal(await page.locator('#add-port-button').isVisible(),false);
  for(const preset of ['clock','reset','stimulus']) {
   await page.locator('#add-simulation-button').click();
   await page.locator('#simulation-kind-select').selectOption(preset);
   await page.locator('#add-simulation-form button[type=submit]').click();
   await page.locator('#preset-kind').waitFor();
   await page.waitForFunction(kind=>document.querySelector('#preset-kind')?.textContent?.toLowerCase()===kind,preset);
   assert.equal(await page.locator('#instance-name').inputValue(),`u_${preset}_0`);
   if(preset==='clock') {
    await page.locator('#preset-frequency').fill('148.5');
    await page.locator('#preset-frequency').press('Enter');
    await page.waitForFunction(()=>document.querySelector('#preset-period')?.textContent==='6.734 (1ns)'&&!document.querySelector('#preset-frequency').disabled);
    assert.equal(task.instances.find(item=>item.id==='u_clock_0').preset.frequencyMHz,148.5);
   }
   if(preset!=='stimulus') await page.screenshot({path:path.join(output,`st-${preset}-inspector.png`)});
  }
  // Change width without reselecting the node or editing its initial value.
  await page.locator('#preset-width').fill('7');await page.locator('#preset-width').press('Tab');
  await page.waitForFunction(()=>document.querySelector('#preset-width')?.value==='7'&&!document.querySelector('#preset-width').disabled);
  await page.locator('#add-transition').click();
  await page.getByLabel('Transition 1 time',{exact:true}).fill('9');
  await page.getByLabel('Transition 1 value',{exact:true}).fill("7'd9");
  await page.getByLabel('Transition 1 value',{exact:true}).press('Enter');
  await page.waitForFunction(()=>!document.querySelector('#add-transition').disabled);
  assert.deepEqual(task.instances.find(i=>i.preset.kind==='stimulus').preset.transitions,[{at:9,value:"7'd9"}]);
  await page.getByRole('button',{name:'Delete transition 1',exact:true}).click();
  await page.waitForFunction(()=>!document.querySelector('#add-transition').disabled);
  // A different invalid draft must not mark the current, valid literal as invalid.
  await page.locator('#add-transition').click();
  await page.getByLabel('Transition 1 time',{exact:true}).fill('1');
  await page.getByLabel('Transition 1 value',{exact:true}).fill('9');
  await page.getByLabel('Transition 1 value',{exact:true}).press('Enter');
  await page.locator('#add-transition').click();
  await page.getByLabel('Transition 2 time',{exact:true}).fill('2');
  await page.getByLabel('Transition 2 value',{exact:true}).fill("7'd9");
  await page.getByLabel('Transition 2 value',{exact:true}).press('Enter');
  assert.equal(await page.getByLabel('Transition 2 value',{exact:true}).evaluate(input=>input.validity.valid),true);
  assert.match(await page.getByLabel('Transition 1 value',{exact:true}).evaluate(input=>input.validationMessage),/Transition 1 value/);
  // Correcting the offending row commits both drafts without reselecting the node.
  await page.getByLabel('Transition 1 value',{exact:true}).fill("7'd8");
  await page.getByLabel('Transition 1 value',{exact:true}).press('Enter');
  await page.waitForFunction(()=>!document.querySelector('#add-transition').disabled);
  assert.deepEqual(task.instances.find(i=>i.preset.kind==='stimulus').preset.transitions,[{at:1,value:"7'd8"},{at:2,value:"7'd9"}]);
  await page.getByRole('button',{name:'Delete transition 2',exact:true}).click();
  await page.waitForFunction(()=>!document.querySelector('#add-transition').disabled);
  await page.getByRole('button',{name:'Delete transition 1',exact:true}).click();
  await page.waitForFunction(()=>!document.querySelector('#add-transition').disabled);
  await page.locator('#preset-width').fill('8');await page.locator('#preset-width').press('Enter');
  await page.waitForFunction(()=>document.querySelector('#preset-width')?.value==='8'&&!document.querySelector('#preset-width').disabled);
  await page.locator('#preset-initial').fill("8'h00");await page.locator('#preset-initial').press('Enter');
  await page.locator('#add-transition').click();
  await page.locator('[aria-label="Transition 1 time"]').fill('10');
  await page.locator('[aria-label="Transition 1 value"]').fill("8'hff");
  await page.locator('[aria-label="Transition 1 value"]').press('Enter');
  await page.waitForFunction(()=>!document.querySelector('#add-transition').disabled);
  assert.deepEqual(task.instances.find(i=>i.preset.kind==='stimulus').preset.transitions,[{at:10,value:"8'hff"}]);
  await page.getByRole('button',{name:'Delete transition 1',exact:true}).click();
  await page.waitForFunction(()=>!document.querySelector('#add-transition').disabled);
  assert.equal(task.instances.find(i=>i.preset.kind==='stimulus').preset.transitions.length,0);
  await page.locator('#add-transition').click();
  await page.locator('[aria-label="Transition 1 time"]').fill('10');
  await page.locator('[aria-label="Transition 1 value"]').fill("8'hff");
  await page.locator('[aria-label="Transition 1 value"]').press('Enter');
  await page.waitForFunction(()=>!document.querySelector('#add-transition').disabled);
  await page.locator('#fit-button').click();
  await page.locator('#connect-button').click();
  await page.locator('[data-cell-id="instance:u_clock_0"] .x6-port-body').first().click({force:true});
  await page.locator('[data-cell-id="instance:dut"] .x6-port-body').first().click({force:true});
  await page.waitForFunction(()=>!document.querySelector('#add-instance-button').disabled);
  assert(messages.some(m=>m.type==='editSchematic'&&m.edit.type==='connect'));
  assert.equal(design.connections.length,1);
  await page.locator('#connect-button').click();
  await page.locator('#canvas').click({position:{x:40,y:40}});
  await page.locator('#task-duration').waitFor();
  await page.locator('#task-duration').fill('2000');await page.locator('#task-duration').press('Enter');
  await page.waitForFunction(()=>!document.querySelector('#task-duration').disabled);
  assert.equal(task.settings.duration,2000);
  const countBeforeInvalid=messages.length;
  await page.locator('#task-duration').fill('-1');await page.locator('#task-duration').press('Enter');
  assert.equal(await page.locator('#task-duration').inputValue(),'-1');
  assert.equal(await page.locator('#task-duration').evaluate(input=>input.checkValidity()),false);
  assert.equal(messages.slice(countBeforeInvalid).filter(m=>m.command==='updateTaskSettings').length,0);
  await page.locator('#task-duration').fill('2000');await page.locator('#task-duration').press('Enter');
  await page.waitForFunction(()=>!document.querySelector('#task-duration').disabled);
  await page.screenshot({path:path.join(output,'st-task-inspector.png')});
  await page.locator('#add-logic-button').click();
  await page.locator('#add-logic-form button[type=submit]').click();
  await page.waitForFunction(()=>!document.querySelector('#add-instance-button').disabled);
  assert(messages.some(m=>m.type==='editSchematic'&&m.edit.type==='addLogic'));
  await page.locator('[data-cell-id="instance:u_stimulus_0"]').click({position:{x:60,y:25},force:true});
  await page.locator('#preset-width').waitFor();
  await page.locator('#run-task-button').click();
  await page.getByRole('button',{name:'Stop simulation',exact:true}).waitFor();
  await page.getByRole('button',{name:'Stop simulation',exact:true}).click();
  await page.waitForFunction(()=>!document.querySelector('#wave-task-button').disabled);
  await page.locator('#wave-task-button').click();
  await page.locator('#export-button').click();
  assert(messages.some(m=>m.command==='openWave'));assert(messages.some(m=>m.command==='generateTestbench'));
  await page.waitForFunction(()=>!document.querySelector('#add-instance-button').disabled);
  await page.locator('#fit-button').click();
  const titleText=await page.locator('[data-cell-id="instance:u_stimulus_0"] .veriflow-title-clip text title').textContent();
  assert.equal(titleText,'Stimulus u_stimulus_0','Module and instance share the top header');
  for(const theme of ['light','dark']) {
   await page.evaluate(theme=>{
    const dark=theme==='dark'; document.documentElement.style.colorScheme=theme;
    const colors={'editor-background':dark?'#1e1e1e':'#ffffff','editor-foreground':dark?'#d4d4d4':'#222222','sideBar-background':dark?'#252526':'#f3f3f3','editorGroupHeader-tabsBackground':dark?'#252526':'#f3f3f3','dropdown-background':dark?'#3c3c3c':'#ffffff','dropdown-foreground':dark?'#f0f0f0':'#222222','input-background':dark?'#3c3c3c':'#ffffff','input-foreground':dark?'#f0f0f0':'#222222','panel-border':dark?'#454545':'#c7c7c7','descriptionForeground':dark?'#aaaaaa':'#57606a','button-background':dark?'#0e639c':'#0969da','button-foreground':'#ffffff','statusBar-background':dark?'#252526':'#f3f3f3','statusBar-foreground':dark?'#d4d4d4':'#333333','editorWhitespace-foreground':dark?'#404040':'#d1d1d1'};
    for(const [key,value] of Object.entries(colors)) document.documentElement.style.setProperty('--vscode-'+key,value);
   },theme);
   await page.screenshot({path:path.join(output,`st-${theme}.png`)});
  }
  await page.setViewportSize({width:640,height:700});await page.locator('#fit-button').click();await page.screenshot({path:path.join(output,'st-narrow.png')});
  assert((await page.locator('#canvas').boundingBox()).height>350);
  assert.equal(await page.locator('#toolbar').evaluate(e=>getComputedStyle(e).flexWrap),'nowrap');
  await page.setViewportSize({width:1280,height:850});
  await page.evaluate(()=>document.documentElement.removeAttribute('style'));
  assert.deepEqual(await page.locator('#simulation-kind-select option').evaluateAll(items=>items.slice(3).map(item=>item.textContent)),['UART','SPI','I2C','APB','AXI-STREAM','AXI-Lite','AXI-Full','RGB']);
  for (const protocol of ['uart','spi','i2c','apb','axis','axi4lite','axi4','rgb888']) {
   await page.locator('#add-simulation-button').click();
   await page.locator('#simulation-kind-select').selectOption(protocol);
   await page.locator('#add-simulation-form button[type=submit]').click();
   await page.locator('#preset-role').waitFor();
   await page.waitForFunction(id=>document.querySelector('#instance-name')?.value===id&&!document.querySelector('#preset-role').disabled,`u_${protocol}_0`);
   const instance=task.instances.find(item=>item.id===`u_${protocol}_0`);
   assert.equal(instance.preset.protocol,protocol);
   const groupedBus=['apb','axis','axi4lite','axi4'].includes(protocol);
   const visiblePins=groupedBus?2:describePreset(instance.preset).ports.length;
   await page.waitForFunction(({id,count})=>document.querySelectorAll(`[data-cell-id="instance:${id}"] .x6-port-body`).length===count,{id:`u_${protocol}_0`,count:visiblePins});
   assert.equal(await page.locator(`[data-cell-id="instance:u_${protocol}_0"] .x6-port-body`).count(),visiblePins);
   if(groupedBus) assert.equal(await page.locator(`[data-cell-id="instance:u_${protocol}_0"] .x6-port-body[port="interface:instance:u_${protocol}_0:m_${protocol.startsWith('axi4')?'axi':protocol}"]`).count(),1,'Standard bus pins form one AD aggregate');
   if(protocol==='axis'||protocol==='apb') {
    const option=protocol==='axis'?'includeLast':'includeError';
    const count=describePreset(instance.preset).ports.length;
    await page.locator('#preset-option-'+option).selectOption('false');
    await page.waitForFunction(key=>document.querySelector('#preset-option-'+key)?.value==='false'&&!document.querySelector('#preset-role').disabled,option);
    assert.equal(instance.preset.options[option],false);
    assert.equal(describePreset(instance.preset).ports.length,count-1);
    await page.waitForFunction(({id,count})=>document.querySelectorAll(`[data-cell-id="instance:${id}"] .x6-port-body`).length===count,{id:`u_${protocol}_0`,count:visiblePins});
   }
   if (protocol==='uart') {
    await page.getByRole('textbox',{name:'Transmit values 1 value',exact:true}).fill("8'h42");
    await page.getByRole('textbox',{name:'Transmit values 1 value',exact:true}).press('Enter');
    await page.waitForFunction(()=>!document.querySelector('#preset-role').disabled);
    assert.deepEqual(instance.preset.data,["8'h42"]);
    await page.screenshot({path:path.join(output,'st-uart-inspector.png')});
    await page.locator('#preset-role').selectOption('rx');
    await page.getByRole('table',{name:'Expected values',exact:true}).waitFor();
   }
   if(['apb','axi4lite','axi4'].includes(protocol)) {
    assert.equal(await page.locator('#preset-option-write,#preset-option-address').count(),0);
    await page.getByLabel('Transaction 1 address',{exact:true}).fill("32'h10");
    await page.getByLabel('Transaction 1 address',{exact:true}).press('Enter');
    await page.waitForFunction(()=>!document.querySelector('#preset-role').disabled);
    await page.getByLabel('Transaction 1 values',{exact:true}).fill(protocol==='axi4'?"32'h1234\n32'h5678":"32'h1234");
    await page.getByLabel('Transaction 1 values',{exact:true}).press(protocol==='axi4'?'Control+Enter':'Enter');
    await page.waitForFunction(()=>!document.querySelector('#preset-role').disabled);
    await page.getByRole('button',{name:'Add transaction',exact:true}).click();
    await page.getByLabel('Transaction 2 operation',{exact:true}).selectOption('read');
    await page.waitForFunction(()=>!document.querySelector('#preset-role').disabled);
    await page.getByLabel('Transaction 2 address',{exact:true}).fill("32'h20");
    await page.getByLabel('Transaction 2 address',{exact:true}).press('Enter');
    await page.waitForFunction(()=>!document.querySelector('#preset-role').disabled);
    await page.getByLabel('Transaction 2 values',{exact:true}).fill("32'h42");
    await page.getByLabel('Transaction 2 values',{exact:true}).press(protocol==='axi4'?'Control+Enter':'Enter');
    await page.waitForFunction(()=>!document.querySelector('#preset-role').disabled);
    assert.equal(instance.preset.transactions[0].operation,'write');
    assert.equal(instance.preset.transactions[0].address,"32'h10");
    assert.deepEqual(instance.preset.transactions[1],{operation:'read',address:"32'h20",data:[],expected:["32'h42"]});
    await page.screenshot({path:path.join(output,`st-${protocol}-transactions.png`)});
    await page.getByRole('button',{name:'Delete transaction 1',exact:true}).click();
    await page.waitForFunction(()=>!document.querySelector('#preset-role').disabled);
    assert.equal(instance.preset.transactions.length,1);
    assert.equal(instance.preset.transactions[0].operation,'read');
   }
   if(protocol==='rgb888') {
    assert.equal(await page.locator('#preset-option-hFrontPorch,#preset-option-hSync,#preset-option-vBackPorch').count(),0);
    for(const [key,value] of Object.entries({hTotal:2200,hActive:1920,hSyncStart:2008,hSyncEnd:2052,vTotal:1125,vActive:1080,vSyncStart:1084,vSyncEnd:1089})) {
     await page.locator('#preset-option-'+key).fill(String(value));
     await page.locator('#preset-option-'+key).press('Enter');
     await page.waitForFunction(()=>!document.querySelector('#preset-role').disabled);
     assert.equal(instance.preset.options[key],value);
    }
    await page.locator('#preset-option-pattern').selectOption('pixels');
    await page.getByRole('table',{name:'Transmit values',exact:true}).waitFor();
    await page.getByRole('button',{name:'Add transmit value',exact:true}).click();
    await page.getByRole('textbox',{name:'Transmit values 1 value',exact:true}).fill("24'hff0000");
    await page.getByRole('textbox',{name:'Transmit values 1 value',exact:true}).press('Enter');
    await page.waitForFunction(()=>!document.querySelector('#preset-role').disabled);
    assert.deepEqual(instance.preset.data,["24'hff0000"]);
    await page.screenshot({path:path.join(output,'st-rgb888-inspector.png')});
   }
  }
  kind='arch-design';await initialize();
  await page.locator('#add-instance-button').click();
  assert.equal(await page.locator('#add-instance-dialog').evaluate(d=>d.open),true);
  await page.screenshot({path:path.join(output,'ad-same-dialog.png')});
  assert.equal(await page.locator('#add-simulation-button').isVisible(),false);
  assert.equal(await page.locator('#export-button').getAttribute('aria-label'),'Export RTL');
  assert.equal(await page.locator('#add-port-button').isVisible(),true);
  assert.deepEqual(errors,[]);
  console.log('Real X6 browser: shared AD/ST dialog, presets and inspector, stimulus table, toolbar run/stop/wave/export, light/dark/narrow passed');
 }finally {await browser.close();server.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
