import assert from 'node:assert/strict';
import Module = require('module');
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createSimulationTask} from '@veriflow/hdl-runtime/simulationTask';
import {prepareSimulationTaskWorkspace} from '@veriflow/hdl-runtime/simulationTaskWorkspace';
import {SimulationRunCoordinator} from '../workbench/simulationRunCoordinator';
class Emitter {event=()=>({dispose(){}});fire(){}dispose(){}}
class Uri { constructor(readonly fsPath:string){} get path(){return this.fsPath.replace(/\\/g,'/');} static file(file:string){return new Uri(file);} static parse(uri:string){return Uri.file(fileURLToPath(uri));} static joinPath(uri:Uri,...parts:string[]){return Uri.file(path.join(uri.fsPath,...parts));} toString(){return pathToFileURL(this.fsPath).toString();} }
async function main(){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'vf-st-controller-'));const target=Uri.file(path.join(root,'sample.st')), exported=Uri.file(path.join(root,'sample_tb.v'));
 const commands=new Map<string,any>(),opened:any[]=[],errors:string[]=[];let saveTarget=target,disposed=0,captured='',backendFailure=false,openedWave=''; const disposable={dispose(){}};
 const channels:string[]=[], printed:string[]=[], shown:any[]=[];let outputCleared=0,outputDisposed=0;
 let text='',version=1; const document={uri:target,get version(){return version;},getText:()=>text,positionAt:(n:number)=>n,save:async()=>{fs.writeFileSync(target.fsPath,text);return true;}};
 const mock={Uri,EventEmitter:Emitter,Position:class{},Range:class{},ProgressLocation:{Notification:1},
  WorkspaceEdit:class {operations:any[]=[];createFile(uri:Uri){this.operations.push(['create',uri]);}insert(uri:Uri,_position:any,content:string){this.operations.push(['write',uri,content]);}replace(uri:Uri,_range:any,content:string){this.operations.push(['write',uri,content]);}},
  commands:{registerCommand:(key:string,action:any)=>{commands.set(key,action);return disposable;},executeCommand:async(...args:any[])=>{opened.push(args);}},
  window:{createOutputChannel:(name:string)=>{channels.push(name);return {dispose(){outputDisposed++;},clear(){outputCleared++;},show(preserveFocus:any){shown.push(preserveFocus);},appendLine(line:string){printed.push(line);}};},showSaveDialog:async()=>saveTarget,showErrorMessage:async(message:string)=>errors.push(message),showTextDocument:async()=>{},withProgress:async(_options:any,action:any)=>action({}, {isCancellationRequested:false,onCancellationRequested:()=>disposable})},
  workspace:{onDidChangeConfiguration:()=>disposable,createFileSystemWatcher:()=>({...disposable,onDidChange:()=>disposable,onDidCreate:()=>disposable,onDidDelete:()=>disposable}),onDidChangeTextDocument:()=>disposable,isTrusted:true,workspaceFolders:[{uri:Uri.file(root)}],getWorkspaceFolder:()=>({uri:Uri.file(root)}),saveAll:async()=>true,openTextDocument:async()=>document,
   applyEdit:async(edit:any)=>{for(const [kind,uri,content] of edit.operations){if(kind==='create'&&fs.existsSync(uri.fsPath))return false;if(kind==='write'){text=content;version++;}}return true;},fs:{writeFile:async(uri:Uri,data:Uint8Array)=>fs.writeFileSync(uri.fsPath,data)}}};
 const loader=Module as typeof Module & {_load:any},original=loader._load;
 loader._load=function(request:string,...args:any[]){return request==='vscode'?mock:original.call(this,request,...args);};
 try{
  const {SimulationTaskController}=require('../simulationTask/taskController');const coordinator=new SimulationRunCoordinator();
  const services={definitions:async()=>[],interfaces:async()=>undefined,coordinator,openWave:async(file:string)=>{openedWave=file;},
   prepare:async(task:any,uri:Uri,signal?:AbortSignal)=>{const value=await prepareSimulationTaskWorkspace(task,uri.fsPath,signal);const cleanup=value.dispose;value.dispose=async()=>{disposed++;await cleanup();};return value;},
   backend:async()=>({compileAndRun:async(request:any)=>{captured=fs.readFileSync(request.files[0],'utf8');assert.equal(request.topModule,'sample_tb');
    const staged=[...request.files,...request.runtimeFiles,...(request.includeFiles??[])].map((file:string)=>process.platform==='win32'?path.resolve(file).toLowerCase():path.resolve(file));
    assert.equal(new Set(staged).size,staged.length,'HDL sources must not be staged twice as include files');
    for(const artifact of request.artifacts)fs.writeFileSync(artifact.destination,'wave');return {success:!backendFailure,stdout:'done',stderr:backendFailure?'compile failed':'',artifacts:request.artifacts.map((a:any)=>({...a,written:true}))};}})};
  const output=require('../output');output.appendInfo('Earlier dependency analysis');
  const controller=new SimulationTaskController({},services);
  await commands.get('veriflow.newSimulationTask')();assert.equal(JSON.parse(text).settings.waveform.filename,'sample_tb.vcd');assert.equal(opened.at(-1)[2],'veriflow.simulationTask');
  const originalText=text;await commands.get('veriflow.newSimulationTask')();assert.equal(text,originalText);assert.match(errors.at(-1)!,/Could not create/);
  fs.writeFileSync(path.join(root,'probe.v'),'module probe; initial $display("probe"); endmodule\n');
  const task=JSON.parse(text);task.instances.push({id:'probe',source:{kind:'hdl',path:'probe.v',module:'probe'},parameters:{}});text=JSON.stringify(task);version++;await document.save();
  saveTarget=exported;await controller.generate(document);assert.equal(JSON.parse(text).settings.exportPath,'sample_tb.v');assert.equal(disposed,1);
  const emitted=fs.readFileSync(exported.fsPath,'utf8');await controller.run(document);assert.equal(captured,emitted);assert.equal(disposed,2);assert.equal(controller.execution(target).status,'completed');
  assert.deepEqual(channels,['VeriFlow'],'ST must reuse the existing extension output channel');
  assert.ok(printed.includes('done'),'simulator stdout reaches the shared output');
  assert.equal(outputCleared,0,'simulation must retain earlier analysis output');assert.ok(shown.includes(true));
  await controller.openWave(target);assert.ok(fs.existsSync(openedWave));
  (mock.workspace as any).textDocuments=[{uri:Uri.file(target.fsPath.toUpperCase()),isDirty:true,getText:()=>text+' '}];
  if(process.platform!=='win32') {
   await controller.openWave(target);assert.equal(controller.execution(target).canOpenWave,true,'a differently cased POSIX path is a distinct source');
   (mock.workspace as any).textDocuments=[{uri:target,isDirty:true,getText:()=>text+' '}];
  }
  await assert.rejects(controller.openWave(target),/Sources changed/);assert.equal(controller.execution(target).canOpenWave,false);
  (mock.workspace as any).textDocuments=[];
  backendFailure=true;await assert.rejects(controller.run(document),/compile failed/);assert.equal(controller.execution(target).status,'failed');assert.equal(controller.execution(target).canOpenWave,false);assert.equal(disposed,3);
  assert.equal(printed.filter(line=>line.includes('compile failed')).length,1,'simulator stderr reaches the shared output exactly once');
  let cancellations=0;const lease=coordinator.acquire({kind:'st',uri:target.toString()},()=>cancellations++);controller.cancel(Uri.file(path.join(root,'other.st')));assert.equal(cancellations,0);controller.cancel(target);assert.equal(cancellations,1);lease.release();
  assert.equal(coordinator.active,undefined);controller.dispose();
  assert.equal(outputDisposed,0,'ST must not dispose the shared channel');output.dispose();assert.equal(outputDisposed,1);
  console.log('ST controller: same generated/run TB, safe creation, export ownership, no stale wave, cleanup and scoped cancellation passed');
 }finally{loader._load=original;}
}
void main().catch(error=>{console.error(error);process.exitCode=1;});
