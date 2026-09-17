import assert from 'node:assert/strict';
import Module = require('module');
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createSimulationTask,createProtocolPreset} from '@veriflow/hdl-runtime/simulationTask';
import {createInterfaceProtocolCatalog} from '@veriflow/schematic-core/interfaces';
class Emitter { listeners:Array<(event:any)=>void>=[]; event=(listener:(event:any)=>void)=>{this.listeners.push(listener);return{dispose(){}};}; fire(value?:any){this.listeners.forEach(listener=>listener(value));} dispose(){} }
class Uri { constructor(readonly fsPath:string){} get path(){return this.fsPath.replace(/\\/g,'/');} static file(file:string){return new Uri(file);} static parse(uri:string){return Uri.file(fileURLToPath(uri));} static joinPath(uri:Uri,...parts:string[]){return Uri.file(path.join(uri.fsPath,...parts));} toString(){return pathToFileURL(this.fsPath).toString();} }
async function main(){
 const changes=new Emitter(),messages=new Emitter(),runs=new Emitter(); const sent:any[]=[],edits:any[]=[],cancelled:string[]=[];
 const uri=Uri.file(path.resolve('task.st'));
 const fixtureRoot=require('fs').mkdtempSync(path.join(require('os').tmpdir(),'vf-editor-assets-'));
 const assetRoot=path.join(fixtureRoot,'media','schematic');require('fs').mkdirSync(assetRoot,{recursive:true});
 require('fs').writeFileSync(path.join(assetRoot,'index.html'),'<meta http-equiv="Content-Security-Policy" content=""><link href="./index.css"><script src="./index.js"></script>');
 let text=JSON.stringify(createSimulationTask());
 const document={uri,version:1,getText:()=>text,positionAt:(position:number)=>position,save:async()=>true};
 const mock={Uri,EventEmitter:Emitter,WorkspaceEdit:class{replace(...args:any[]){edits.push(args);}},Range:class{},
  workspace:{findFiles:async()=>[],createFileSystemWatcher:()=>({onDidCreate:()=>({dispose(){}}),onDidChange:()=>({dispose(){}}),onDidDelete:()=>({dispose(){}}),dispose(){}}),onDidChangeTextDocument:changes.event,openTextDocument:async()=>document,
   applyEdit:async()=>{text=edits.at(-1)[2];document.version++;changes.fire({document});return true;}},commands:{executeCommand:async()=>{}}};
 const loader=Module as typeof Module & {_load:any},original=loader._load;
 loader._load=function(request:string,...args:any[]){return request==='vscode'?mock:original.call(this,request,...args);};
 try{
  const {SimulationTaskEditorProvider}=require('../simulationTask/taskEditorProvider');
  const services={execution:()=>({status:'idle',canOpenWave:false}),interfaces:async()=>createInterfaceProtocolCatalog(),onDidChange:runs.event,cancel:(value:Uri)=>cancelled.push(value.toString()),openWave:async()=>{},generate:async()=>{},run:async()=>{},
   definitions:async()=>[{key:'sample',name:'sample',uri:Uri.file(path.join(path.dirname(uri.fsPath),'module.v')).toString(),ports:[{name:'clk',direction:'input',width:{kind:'known',bits:1}}],parameters:[]}]};
  const provider=new SimulationTaskEditorProvider({extensionUri:Uri.file(fixtureRoot)},services); let disposePanel=()=>{};
  const panel={webview:{options:{},html:'',cspSource:'vscode-webview:',asWebviewUri:(value:Uri)=>value,onDidReceiveMessage:messages.event,postMessage:async(message:any)=>{sent.push(message);return true;}},onDidDispose:(callback:()=>void)=>{disposePanel=callback;}};
  provider.resolveCustomTextEditor(document,panel);
  const flush=async()=>{await new Promise(resolve=>setTimeout(resolve,0));await new Promise(resolve=>setTimeout(resolve,0));};
  const fire=async(command:string,payload?:unknown,revision=String(document.version))=>{messages.fire({type:'simulationTaskCommand',revision,command,payload});await flush();};
  messages.fire({type:'ready'});await flush();
  assert.equal(sent.find(message=>message.type==='initialize').documentKind,'simulation-task');
  assert.equal(sent.at(-1).task.document.format,'veriflow-simulation-task');
  await fire('updateTaskSettings',{settings:{...createSimulationTask().settings,duration:234}});
  assert.equal(JSON.parse(text).settings.duration,234);
  const before=edits.length;
  await fire('addPreset',{id:'clock',preset:{kind:'clock',frequencyMHz:100,initial:0}},'1');
  assert.equal(edits.length,before); assert.match(sent.at(-1).message,/changed/);
  await fire('addPreset',{id:'clock',preset:{kind:'clock',frequencyMHz:100,initial:0}});
  assert.equal(JSON.parse(text).instances[0].preset.kind,'clock');
  const beforeDuplicate=edits.length;
  await fire('addPreset',{id:'clock',preset:{kind:'clock',frequencyMHz:100,initial:0}});
  assert.equal(edits.length,beforeDuplicate);assert.equal(sent.at(-1).type,'hostError');
  messages.fire({type:'editSchematic',revision:String(document.version),edit:{type:'addInstance',instance:{name:'u_sample',module:'sample',definitionKey:JSON.stringify(['module.v','sample'])}}});await flush();
  assert.deepEqual(JSON.parse(text).instances[1].source,{kind:'hdl',path:'module.v',module:'sample'});
  await fire('updatePreset',{id:'clock',preset:{kind:'clock',frequencyMHz:50,initial:1}});
  assert.equal(JSON.parse(text).instances[0].preset.frequencyMHz,50);
  const uart=createProtocolPreset('uart');
  await fire('addPreset',{id:'serial',preset:uart});
  assert.equal(JSON.parse(text).instances.find((item:any)=>item.id==='serial').preset.role,'tx');
  await fire('updatePreset',{id:'serial',preset:{...uart,data:["8'h42"]}});
  assert.deepEqual(JSON.parse(text).instances.find((item:any)=>item.id==='serial').preset.data,["8'h42"]);
  await fire('updatePreset',{id:'serial',preset:{...createProtocolPreset('uart','rx'),expected:[]}});
  assert.equal(JSON.parse(text).instances.find((item:any)=>item.id==='serial').preset.role,'rx');
  const projected=sent.filter(message=>message.type==='graph').at(-1).graph.nodes.find((node:any)=>node.id==='instance:serial');
  assert.equal(projected.subtitle,'UART rx');assert.equal(projected.definitionKey,undefined);
  const apb=createProtocolPreset('apb');
  await fire('addPreset',{id:'bus',preset:apb});
  const transactions=[{operation:'write',address:"32'h10",data:["32'h1234"]},{operation:'read',address:"32'h20",data:[],expected:["32'h5678"]}];
  await fire('updatePreset',{id:'bus',preset:{...apb,transactions}});
  assert.deepEqual(JSON.parse(text).instances.find((item:any)=>item.id==='bus').preset.transactions,transactions);
  await fire('cancel');assert.deepEqual(cancelled,[uri.toString()]);
  const count=edits.length; await fire('addEnvironment'); assert.equal(edits.length,count);
  services.run=async()=>{throw new Error('Traditional testbench is still running');};await fire('run');assert.match(sent.at(-1).message,/Traditional testbench/);
  const {replaceTaskDocument}=require('../simulationTask/taskEditorProvider');
  const first=JSON.parse(text),second=JSON.parse(text);first.settings.duration=300;second.settings.duration=400;
  const concurrent=await Promise.allSettled([replaceTaskDocument(document,first),replaceTaskDocument(document,second)]);
  assert.equal(concurrent.filter(result=>result.status==='fulfilled').length,1);
  assert.equal(JSON.parse(text).settings.duration,300);await flush();
  text='{invalid';document.version++;changes.fire({document});await flush();assert.equal(sent.at(-1).type,'hostError');
  const total=sent.length;disposePanel();runs.fire();await flush();assert.equal(sent.length,total);
  console.log('ST editor: shared graph edits, preset properties, stale/duplicate rejection, scoped cancellation and recoverable errors passed');
 }finally{loader._load=original;}
}
void main().catch(error=>{console.error(error);process.exitCode=1;});
