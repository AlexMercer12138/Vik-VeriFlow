import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import Module = require('module');
import { hdlTemplates } from '@veriflow/flow-core';

test('native insertion retains cursor, EOL, literal tasks, undo and invocation guards', async () => {
 const handlers = new Map<string, (...args: any[]) => Promise<void>>();
 let picker: (items: any[]) => Promise<any> = async items => items.find(item => item.id === 'waveform');
 let inserted: any[] = [];
 let writable = true;
 const position = {line:3,character:7};
 const selection = {active:position,isEqual(other:unknown) {return other === this;}};
 const editor: any = { document:{languageId:'verilog',uri:{scheme:'file'},version:1,eol:2,isClosed:false},selections:[selection],selection,
   insertSnippet: async (...args:any[]) => { inserted.push(args); return true; } };
 class SnippetString {
  value='';
  appendText(text:string) { this.value += text.replace(/[$}\\]/g, '\\$&'); return this; }
  appendPlaceholder(value:string,index:number) { this.value += '${'+index+':'+value+'}'; return this; }
  appendTabstop(index:number) { this.value += '$'+index; return this; }
 }
 const fake = {window:{activeTextEditor:editor,showQuickPick:(items:any[])=>picker(items),showInformationMessage:async()=>{},showErrorMessage:async()=>{}},workspace:{fs:{isWritableFileSystem:()=>writable}},EndOfLine:{CRLF:2},SnippetString,
  commands:{registerCommand:(id:string,handler:any)=>{handlers.set(id,handler);return {dispose(){}};}},Disposable:{from:()=>({dispose(){}})}};
 const loader = Module as typeof Module & {_load:any}; const original=loader._load;
 loader._load=function(request:string,...args:any[]) {return request==='vscode'?fake:original.call(this,request,...args);};
 try { delete require.cache[require.resolve('../testbench/templateCommands')]; require('../testbench/templateCommands').registerHdlTemplateCommands(); }
 finally {loader._load=original;}
 const run = () => handlers.get('veriflow.insertHdlTemplate')!();
 await run();
 assert.equal(inserted.length,1);
 assert.equal(inserted[0][1],position);
 assert.deepEqual(inserted[0][2],{undoStopBefore:true,undoStopAfter:true});
 assert.ok(inserted[0][0].value.includes('\\$dumpfile("${1:waves.vcd}")'));
 assert.ok(inserted[0][0].value.includes('\r\n'));
 inserted=[];
 picker=async()=>undefined; await run(); assert.equal(inserted.length,0);
 picker=async items=>{editor.document.version++;return items[0];}; await run(); assert.equal(inserted.length,0);
 picker=async items=>{editor.selection={...selection};return items[0];}; await run(); assert.equal(inserted.length,0); editor.selection=selection;
 picker=async items=>{fake.window.activeTextEditor={} as any;return items[0];}; await run(); assert.equal(inserted.length,0); fake.window.activeTextEditor=editor;
 writable=false; await run(); assert.equal(inserted.length,0); writable=true;
 editor.selections=[selection,selection]; await run(); assert.equal(inserted.length,0); editor.selections=[selection];
 editor.document.uri.scheme='file';
 await handlers.get('veriflow.insertHdlTemplate.clock')!();
 assert.ok(inserted[0][0].value.includes('${1:clk}'));
 assert.ok(inserted[0][0].value.includes('$1 = ~$1'));
 assert.ok(hdlTemplates.some(item=>item.id==='combinational'));
});
