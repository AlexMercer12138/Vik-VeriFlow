import assert from 'node:assert/strict';
import Module = require('module');
import { createSimulationTask, createProtocolPreset } from '@veriflow/hdl-runtime/simulationTask';
const loader=Module as typeof Module & {_load:any}, original=loader._load;
loader._load=function(name:string,...args:any[]){return name==='vscode'?{}:original.call(this,name,...args);};
try {
 const {projectSimulationTask}=require('../simulationTask/taskProjection');
 const task=createSimulationTask('demo.st');
 task.instances.push({id:'missing',source:{kind:'hdl',path:'missing.v',module:'missing'},parameters:{WIDTH:'16'}},
 {id:'eight',preset:{kind:'stimulus',width:8,initial:"8'h00",transitions:[]}}, {id:'one',preset:{kind:'stimulus',width:1,initial:"1'b0",transitions:[]}});
 const projected=projectSimulationTask(task,[],'file:///demo.st');
 assert.equal(projected.graph.nodes.length,3);assert.ok(projected.projection.validation.diagnostics.length);
 assert.equal(projected.projection.catalog.find((m:any)=>m.key==='preset:eight').ports[0].width.bits,8);
 assert.equal(projected.projection.catalog.find((m:any)=>m.key==='preset:one').ports[0].width.bits,1);
 assert.equal(projected.projection.moduleChoices.length,0);assert.equal(projected.projection.design.module,'demo_tb');
 assert.deepEqual(projected.projection.design.instances[0].parameters,{WIDTH:'16'});
 const protocol=createProtocolPreset('axis');protocol.options.dataWidth=16;
 task.instances.push({id:'stream',preset:protocol});
 const stream=projectSimulationTask(task,[],'file:///demo.st');
 assert.equal(stream.graph.nodes.find((node:any)=>node.id==='instance:stream').subtitle,'AXI-STREAM source');
 assert.equal(stream.projection.catalog.find((item:any)=>item.key==='preset:stream').ports.find((port:any)=>port.name==='m_axis_tdata').width.bits,16);
 for (const protocol of ['apb', 'axis', 'axi4', 'axi4lite'] as const) {
  const busTask=createSimulationTask('bus.st'), family=protocol.startsWith('axi4')?'axi':protocol;
  busTask.instances=[{id:'sender',preset:createProtocolPreset(protocol)},
   {id:'receiver',preset:createProtocolPreset(protocol,protocol==='axis'?'sink':'responder')}];
  busTask.interfaceConnections=[{name:'bus',master:{kind:'instance',instance:'sender',interface:`m_${family}`},
   slave:{kind:'instance',instance:'receiver',interface:`s_${family}`}}];
  const bus=projectSimulationTask(busTask,[],'file:///bus.st');
  for(const [id,prefix,role] of [['sender','m','master'],['receiver','s','slave']]) {
   const node=bus.graph.nodes.find((node:any)=>node.id===`instance:${id}`);
   const pin=node.pins.find((pin:any)=>pin.id===`interface:instance:${id}:${prefix}_${family}`);
   assert.equal(pin.interface.kind,'aggregate'); assert.equal(pin.interface.role,role);
  }
  assert.ok(bus.graph.networks.some((network:any)=>network.id==='network:interface:bus'));
 }
 const legacy=createSimulationTask('legacy.st');
 legacy.instances=[{id:'sender',preset:createProtocolPreset('axis')},{id:'receiver',preset:createProtocolPreset('axis','sink')}];
 legacy.connections=[{name:'data',endpoints:[{kind:'instance',instance:'sender',port:'data'},{kind:'instance',instance:'receiver',port:'data'}]}];
 legacy.defaults={'receiver.valid':"1'b0",'sender.ready':"1'b1"};
 const saved=JSON.stringify(legacy), legacyProjection=projectSimulationTask(legacy,[],'file:///legacy.st');
 assert.deepEqual(legacyProjection.projection.design.connections[0].endpoints.map((endpoint:any)=>endpoint.port),['m_axis_tdata','s_axis_tdata']);
 assert.deepEqual(legacyProjection.projection.design.defaults,{'receiver.s_axis_tvalid':"1'b0",'sender.m_axis_tready':"1'b1"});
 assert.equal(JSON.stringify(legacy),saved);
 console.log('ST projection preserves invalid nodes and distinct preset widths; modules only in common add dialog');
} finally {loader._load=original;}
