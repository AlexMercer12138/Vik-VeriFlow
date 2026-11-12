import assert from 'node:assert/strict';
import test from 'node:test';
import { createPhysicalBoard, generateConstraints, bindPhysicalSignal, parsePhysicalConfiguration } from '../src/physicalPins';
import { applyArchDesignEdit, createEmptyArchDesign, parseArchDesignText, serializeArchDesign, semanticArchDesignFingerprint } from '../src/archDesign';
const ports = [{ name: 'tx', direction: 'output' as const }, { name: 'rx', direction: 'input' as const }];
const bindings = ['tx', 'rx'].map(member => ({ source: { interface: 'UART', member }, port: { name: member } }));
function uart() { return createPhysicalBoard({kind:'board', extension:'.xdc', pins:{tx:'PIN A1 {signal name}\r\nIO 33 {signal name}\r\n',rx:'PIN A2 {signal name}\r\n'}, interfaces:[{id:'UART',signals:[{id:'tx',direction:'output',pins:['tx']},{id:'rx',direction:'input',pins:['rx']}]}]}); }
test('fixed templates replace every signal marker and preserve arbitrary syntax',()=>{
 const b=uart(); assert.equal(generateConstraints(b,{board:'b',bindings},ports).text,'PIN A1 tx\r\nIO 33 tx\r\nPIN A2 rx\r\n');
 const odd=createPhysicalBoard({...b.model,extension:'.custom',pins:{tx:'unknown $dynamic [query] {{signal name}} \" \\ {other} {signal name}',rx:'unused'}});
 assert.equal(generateConstraints(odd,{board:'b',bindings:[bindings[0]]},ports).text,'unknown $dynamic [query] {tx} \" \\ {other} tx');
});
test('bus templates follow actual ascending and negative HDL indices',()=>{
 const b=createPhysicalBoard({kind:'board',extension:'.pcf',pins:{a:'set_io {signal name} A1',b:'set_io {signal name} A2'},interfaces:[{id:'GPIO',signals:[{id:'data',direction:'output',pins:['a','b']}]}]});
 const ps=[{name:'data',direction:'output' as const,indices:[-1,0]}]; const bs=bindPhysicalSignal(b,ps,'GPIO','data','data');
 assert.equal(generateConstraints(b,{board:'b',bindings:bs},ps).text,'set_io data[-1] A1\nset_io data[0] A2');
 assert.throws(()=>bindPhysicalSignal(b,[{...ps[0],indices:[0]}],'GPIO','data','data'),/width/i);
 assert.equal(generateConstraints(b,{board:'b',bindings:bs.slice(0,1)},ps).text,undefined);
});
test('pin signals accept bus slices and ordered concatenations of scalar and bus ports', () => {
 const board = createPhysicalBoard({ kind: 'board', extension: '.pcf', pins: { a: 'A {signal name}', b: 'B {signal name}', c: 'C {signal name}', d: 'D {signal name}', e: 'E {signal name}' }, interfaces: [{ id: 'IO', signals: [{ id: 'wide', direction: 'output', pins: ['a','b','c','d'] }, { id: 'single', direction: 'output', pins: ['e'] }] }] });
 const ports = [{ name: 'flag', direction: 'output' as const }, { name: 'bus', direction: 'output' as const, indices: [3,2,1,0] }];
 const refs = [{ name: 'flag' }, { name: 'bus', bit: 3 }, { name: 'bus', bit: 2 }, { name: 'bus', bit: 1 }];
 const wide = bindPhysicalSignal(board, ports, 'IO', 'wide', refs);
 const single = bindPhysicalSignal(board, ports, 'IO', 'single', [{ name: 'bus', bit: 0 }]);
 assert.deepEqual(wide.map(b => b.source.member), ['wide.3','wide.2','wide.1','wide.0']);
 assert.deepEqual(wide.map(b => b.port), refs);
 assert.equal(generateConstraints(board, { board: 'b', bindings: [...wide,...single] }, ports).text, 'A flag\nB bus[3]\nC bus[2]\nD bus[1]\nE bus[0]');
 const reversed = bindPhysicalSignal(board, ports, 'IO', 'wide', [{name:'bus',bit:1},{name:'bus',bit:2},{name:'bus',bit:3},{name:'flag'}]);
 assert.equal(generateConstraints(board, { board: 'b', bindings: reversed }, ports).text, 'A bus[1]\nB bus[2]\nC bus[3]\nD flag');
 assert.throws(() => bindPhysicalSignal(board, ports, 'IO', 'wide', refs.slice(1)), /width/i);
 assert.throws(() => bindPhysicalSignal(board, ports, 'IO', 'wide', [...refs.slice(0,3),refs[1]]), /duplicate/i);
 assert.throws(() => bindPhysicalSignal(board, ports, 'IO', 'single', [{name:'bus',bit:7}]), /port\/bit/i);
 assert.throws(() => bindPhysicalSignal(board, [{...ports[1], direction:'input'}], 'IO', 'single', [{name:'bus',bit:0}]), /direction/i);
 assert.equal(generateConstraints(board, {board:'b',bindings:[...wide,{...single[0],port:{name:'bus',bit:1}}]}, ports).text, undefined);
});
test('daughtercards bind final positions with independent electrical settings and no board mapping',()=>{
 const b={...uart(),cards:{c:createPhysicalBoard({kind:'daughtercard',extension:'.xdc',pins:{tx:'PIN {pin name} {signal name}\nIO 18 {signal name}'},interfaces:[{id:'U',signals:[{id:'tx',direction:'output',pins:['tx']}]}]}).model}};
 const config={board:'b',cards:[{id:'c',board:'card.json'}],bindings:[{source:{card:'c',interface:'U',member:'tx'},port:{name:'tx'},pin:'A1'}]};
 assert.equal(generateConstraints(b,config,ports).text,'PIN A1 tx\nIO 18 tx');
 assert.equal(generateConstraints(b,{...config,bindings:[{...config.bindings[0],pin:''}]},ports).text,undefined);
 assert.equal(generateConstraints(b,{...config,bindings:[...config.bindings,bindings[0]]},ports).text,undefined);
 assert.throws(()=>parsePhysicalConfiguration({...config,cards:[{...config.cards[0],connections:[]}]}),/unknown/i);
});
test('templates are literal, do not recursively expand and board pin marker is invalid',()=>{
 const b=uart(); assert.throws(()=>createPhysicalBoard({...b.model,pins:{tx:'{pin name} {signal name}'}}),/pin name/i);
 const odd=createPhysicalBoard({...b.model,pins:{tx:'{signal name} $& {literal}',rx:''}});
 assert.equal(generateConstraints(odd,{board:'b',bindings:[{...bindings[0],port:{name:'tx$'}}]},[{name:'tx$',direction:'output'}]).text,'tx$ $& {literal}');
 assert.equal(generateConstraints(odd,{board:'b',bindings:[bindings[1]]},ports).text,undefined);
});
test('duplicate logical resources and ports, direction mismatch and format mismatch block export',()=>{
 const b=uart(); assert.equal(generateConstraints(b,{board:'b',bindings:[bindings[0],bindings[0]]},ports).text,undefined);
 assert.equal(generateConstraints(b,{board:'b',bindings:[bindings[0]]},[{name:'tx',direction:'input'}]).text,undefined);
 const c=createPhysicalBoard({...b.model,kind:'daughtercard',extension:'.qsf'}).model;
 assert.equal(generateConstraints({...b,cards:{c}},{board:'b',cards:[{id:'c',board:'c'}],bindings:[]},ports).text,undefined);
});
test('AD physical bindings round trip and stay outside RTL fingerprint',()=>{
 const base={...createEmptyArchDesign('top'),ports:[ports[0]]}; const physical=parsePhysicalConfiguration({board:'user:b',bindings:[bindings[0]]});
 const stored=applyArchDesignEdit(base,{type:'setPhysical',physical}); const parsed=parseArchDesignText(serializeArchDesign(stored));
 assert.equal(parsed.status,'editable'); if(parsed.status==='editable')assert.deepEqual(parsed.design.physical,physical);
 assert.equal(semanticArchDesignFingerprint(base),semanticArchDesignFingerprint(stored));
 assert.equal(applyArchDesignEdit(stored,{type:'updatePort',name:'tx',port:{name:'serial_tx',direction:'output'}}).physical?.bindings[0].port.name,'serial_tx');
});
