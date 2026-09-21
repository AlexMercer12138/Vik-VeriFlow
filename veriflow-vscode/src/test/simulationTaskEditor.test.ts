import assert from 'node:assert/strict';
import Module = require('module');
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createSimulationTask,createProtocolPreset} from '@veriflow/hdl-runtime/simulationTask';
import {createInterfaceProtocolCatalog} from '@veriflow/schematic-core/interfaces';
import {createEmptyArchDesign} from '@veriflow/schematic-core/arch-design';
class Emitter { listeners:Array<(event:any)=>void>=[]; event=(listener:(event:any)=>void)=>{this.listeners.push(listener);return{dispose(){}};}; fire(value?:any){this.listeners.forEach(listener=>listener(value));} dispose(){} }
class Uri { constructor(readonly fsPath:string){} get path(){return this.fsPath.replace(/\\/g,'/');} static file(file:string){return new Uri(file);} static parse(uri:string){return Uri.file(fileURLToPath(uri));} static joinPath(uri:Uri,...parts:string[]){return Uri.file(path.join(uri.fsPath,...parts));} toString(){return pathToFileURL(this.fsPath).toString();} }
async function main(){
 const changes=new Emitter(),messages=new Emitter(),runs=new Emitter(),invalidations=new Emitter(); const sent:any[]=[],edits:any[]=[],cancelled:string[]=[],errors:string[]=[],problems:any[]=[],owners:object[]=[],released:object[]=[];
 let scans=0,portName='clk';
 let parameterNames=['WIDTH'];
 let afterApply=()=>{};
 const uri=Uri.file(path.resolve('task.st'));
 const fixtureRoot=require('fs').mkdtempSync(path.join(require('os').tmpdir(),'vf-editor-assets-'));
 const assetRoot=path.join(fixtureRoot,'media','schematic');require('fs').mkdirSync(assetRoot,{recursive:true});
 require('fs').writeFileSync(path.join(assetRoot,'index.html'),'<meta http-equiv="Content-Security-Policy" content=""><link href="./index.css"><script src="./index.js"></script>');
 let text=JSON.stringify(createSimulationTask());
 const document={uri,version:1,getText:()=>text,positionAt:(position:number)=>position,save:async()=>true};
 const mock={Uri,EventEmitter:Emitter,WorkspaceEdit:class{replace(...args:any[]){edits.push(args);}},Range:class{},
  Diagnostic:class{constructor(public range:any,public message:string,public severity:number){}},DiagnosticSeverity:{Error:0,Warning:1},
  languages:{createDiagnosticCollection:()=>({set:(_uri:any,items:any[])=>{problems.splice(0,problems.length,...items);},dispose(){}})},
  window:{showErrorMessage:async(message:string)=>errors.push(message)},
  workspace:{findFiles:async()=>{scans++;return [];},createFileSystemWatcher:()=>({onDidCreate:()=>({dispose(){}}),onDidChange:()=>({dispose(){}}),onDidDelete:()=>({dispose(){}}),dispose(){}}),onDidChangeTextDocument:changes.event,openTextDocument:async(uri:Uri)=>uri.path.endsWith('.ad')?{...document,getText:()=>JSON.stringify(createEmptyArchDesign('external_top'))}:document,
   applyEdit:async()=>{text=edits.at(-1)[2];document.version++;changes.fire({document});afterApply();return true;}},commands:{executeCommand:async()=>{}}};
 const loader=Module as typeof Module & {_load:any},original=loader._load;
 loader._load=function(request:string,...args:any[]){return request==='vscode'?mock:original.call(this,request,...args);};
 try{
  const {SimulationTaskEditorProvider}=require('../simulationTask/taskEditorProvider');
  const services={execution:()=>({status:'idle',canOpenWave:false}),interfaces:async()=>createInterfaceProtocolCatalog(),onDidChange:runs.event,onDidInvalidate:invalidations.event,cancel:(value:Uri)=>cancelled.push(value.toString()),openWave:async()=>{},generate:async()=>{},run:async()=>{},
   releaseDefinitions:(owner:object)=>released.push(owner),
   definitions:async(_uri?:Uri,owner?:object)=>{if(owner)owners.push(owner);return [{key:'sample',name:'sample',uri:Uri.file(path.join(path.dirname(uri.fsPath),'module.v')).toString(),ports:[{name:portName,direction:'input',width:{kind:'known',bits:1}}],parameters:parameterNames.map(name=>({name,defaultExpression:'8'}))}];}};
  const provider=new SimulationTaskEditorProvider({extensionUri:Uri.file(fixtureRoot)},services); let disposePanel=()=>{};
  const panel={webview:{options:{},html:'',cspSource:'vscode-webview:',asWebviewUri:(value:Uri)=>value,onDidReceiveMessage:messages.event,postMessage:async(message:any)=>{sent.push(message);return true;}},onDidDispose:(callback:()=>void)=>{disposePanel=callback;}};
  provider.resolveCustomTextEditor(document,panel);
  const flush=async()=>{await new Promise(resolve=>setTimeout(resolve,0));await new Promise(resolve=>setTimeout(resolve,0));};
  const fire=async(command:string,payload?:unknown,revision=String(document.version))=>{messages.fire({type:'simulationTaskCommand',revision,command,payload});await flush();};
  messages.fire({type:'ready'});await flush();
  assert.equal(sent.find(message=>message.type==='initialize').documentKind,'simulation-task');
  assert.equal(sent.at(-1).task.document.format,'veriflow-simulation-task');
  const initialScans=scans, initialGraphs=sent.filter(message=>message.type==='graph').length;
  const graphMessage=sent.find(message=>message.type==='graph');
  messages.fire({type:'saveLayout',revision:String(document.version),moduleKey:graphMessage.graph.moduleKey,layout:graphMessage.layout});await flush();
  assert.equal(sent.at(-1).type,'archDesignLayoutSaved');
  assert.equal(scans,initialScans,'layout saves must reuse the module catalog');
  assert.equal(sent.filter(message=>message.type==='graph').length,initialGraphs,'layout saves must not rebuild the canvas');
  runs.fire();await flush();
  assert.equal(scans,initialScans,'execution updates must not scan the workspace');
  assert.equal(sent.filter(message=>message.type==='graph').length,initialGraphs,'execution updates must preserve the canvas');
  await fire('updateTaskSettings',{settings:{...createSimulationTask().settings,duration:234}});
  assert.equal(JSON.parse(text).settings.duration,234);
  assert.equal(scans,initialScans,'semantic edits must reuse the module catalog');
  assert.equal(sent.filter(message=>message.type==='graph').length,initialGraphs,'settings updates must not rebuild an unchanged canvas');
  const scanBeforeInvalidation=scans;
  invalidations.fire();invalidations.fire();await flush();
  assert.equal(scans,scanBeforeInvalidation+1,'bursts of dependency changes must share one catalog refresh');
  assert.equal(new Set(owners).size,1,'a panel must retain one shared HDL index owner');assert.equal(released.length,0);
  const before=edits.length;
  await fire('addPreset',{id:'clock',preset:{kind:'clock',frequencyMHz:100,initial:0}},'1');
  assert.equal(edits.length,before); assert.match(sent.at(-1).message,/changed/);
  assert.match(errors.at(-1)!,/changed/,'action errors use the same VS Code notification surface as AD');
  await fire('addPreset',{id:'clock',preset:{kind:'clock',frequencyMHz:100,initial:0}});
  assert.equal(JSON.parse(text).instances[0].preset.kind,'clock');
  const beforeDuplicate=edits.length;
  await fire('addPreset',{id:'clock',preset:{kind:'clock',frequencyMHz:100,initial:0}});
  assert.equal(edits.length,beforeDuplicate);assert.equal(sent.at(-1).type,'hostError');
  messages.fire({type:'editSchematic',revision:String(document.version),edit:{type:'addInstance',instance:{name:'u_sample',module:'sample',definitionKey:JSON.stringify(['module.v','sample'])}}});await flush();
  assert.deepEqual(JSON.parse(text).instances[1].source,{kind:'hdl',path:'module.v',module:'sample'});
  const beforeParameterErrors=errors.length;
  messages.fire({type:'editSchematic',revision:String(document.version),edit:{type:'setInstanceParameter',instance:'u_sample',parameter:'WIDTH',value:'('}});await flush();
  assert.equal(JSON.parse(text).instances[1].parameters.WIDTH,'(','unfinished parameters must remain editable without ST-only rejection');
  assert.equal(errors.length,beforeParameterErrors);
  parameterNames=[];invalidations.fire();await flush();
  assert.deepEqual(JSON.parse(text).instances[1].parameters,{},'source parameter removal must reconcile the persisted ST document');
  assert.equal(sent.filter(message=>message.type==='simulationTaskState').at(-1).revision,String(document.version));
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
  const layoutEvent=sent.filter(message=>message.type==='graph').at(-1);
  const movedLayout=structuredClone(layoutEvent.layout);movedLayout.placement.nodes['instance:u_sample'].column+=1;movedLayout.placement.nodes['instance:u_sample'].fixed=true;
  afterApply=()=>{portName='new_clk';invalidations.fire();};
  messages.fire({type:'saveLayout',revision:String(document.version),moduleKey:layoutEvent.graph.moduleKey,layout:movedLayout});await flush();
  afterApply=()=>{};
  const updatedGraph=sent.filter(message=>message.type==='graph').at(-1).graph;
  assert.ok(updatedGraph.nodes.find((node:any)=>node.id==='instance:u_sample').pins.some((pin:any)=>pin.name==='new_clk'),'a dependency change during layout saving must reach the canvas');
  const concurrentLayout=structuredClone(sent.filter(message=>message.type==='graph').at(-1).layout);concurrentLayout.placement.nodes['instance:u_sample'].yOffset=123;concurrentLayout.placement.nodes['instance:u_sample'].fixed=true;
  afterApply=()=>{const external=JSON.parse(text);external.settings.duration=789;text=JSON.stringify(external);document.version++;changes.fire({document});};
  messages.fire({type:'saveLayout',revision:String(document.version),moduleKey:layoutEvent.graph.moduleKey,layout:concurrentLayout});await flush();afterApply=()=>{};
  assert.equal(sent.filter(message=>message.type==='simulationTaskState').at(-1).task.document.settings.duration,789,'external changes during a layout write must not be marked already published');
  const outside=JSON.parse(text);outside.instances.push({id:'outside',source:{kind:'ad',path:'../outside/design.ad'},parameters:{}});
  text=JSON.stringify(outside);document.version++;changes.fire({document});await flush();
  assert.equal(sent.filter(message=>message.type==='graph').at(-1).graph.nodes.find((node:any)=>node.id==='instance:outside').subtitle,'external_top','new external AD references must invalidate the catalog');
  let completeExport!:()=>void;services.generate=()=>new Promise<void>(resolve=>{completeExport=resolve;});
  await fire('generateTestbench');await fire('cancel');assert.equal(cancelled.length,2,'stop must bypass a pending export');
  completeExport();await flush();
  const validText=text;
  const beforeInvalidErrors=errors.length;
  text='{invalid';document.version++;changes.fire({document});await flush();assert.equal(sent.at(-1).type,'archDesignState');
  assert.equal(sent.at(-1).status,'invalid','malformed source disables authoring just as AD does');
  assert.equal(errors.length,beforeInvalidErrors,'source typing errors belong in diagnostics, not repeated notifications');
  assert.equal(problems[0].severity,0,'invalid ST documents must appear in VS Code Problems');
  text=validText;document.version++;changes.fire({document});await flush();
  assert.equal(problems.filter(item=>item.code==='ST_DOCUMENT_ERROR').length,0,'recovering the document clears syntax diagnostics');
  const finalLayout=structuredClone(sent.filter(message=>message.type==='graph').at(-1).layout);finalLayout.placement.nodes['instance:u_sample'].yOffset=246;finalLayout.placement.nodes['instance:u_sample'].fixed=true;
  const total=sent.length;
  messages.fire({type:'saveLayout',revision:String(document.version),moduleKey:layoutEvent.graph.moduleKey,layout:finalLayout});
  disposePanel();runs.fire();await flush();assert.equal(sent.length,total);
  assert.equal(JSON.parse(text).presentation.nodes['instance:u_sample'].offset,246,'closing the panel must finish an accepted layout save');
  assert.deepEqual(released,[owners[0]],'closing the panel releases its HDL index');
  console.log('ST editor: shared graph edits, preset properties, stale/duplicate rejection, scoped cancellation and recoverable errors passed');
 }finally{loader._load=original;}
}
void main().catch(error=>{console.error(error);process.exitCode=1;});
