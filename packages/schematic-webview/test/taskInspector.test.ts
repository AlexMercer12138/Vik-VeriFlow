import { strict as assert } from 'node:assert';
import { defaultSimulationPreset, projectSimulationTaskInspector, TransitionValidationError } from '../src/authoring/taskInspector';
import { createSimulationTask } from '../../hdl-runtime/src/simulationTask/model';
const task = createSimulationTask('demo.st');
assert.deepEqual(defaultSimulationPreset('clock'), {kind:'clock',frequencyMHz:100,initial:0});
assert.deepEqual(defaultSimulationPreset('reset'), {kind:'reset',active:0,duration:100});
assert.deepEqual(defaultSimulationPreset('stimulus'), {kind:'stimulus',width:1,initial:"1'b0",transitions:[]});
const root = projectSimulationTaskInspector(task, 'demo_tb', { kind:'design', title:'demo', fields:[] });
const field = (model: any, id: string) => model.fields.find((field: any) => field.id === id);
assert.equal(field(root, 'task-module').value, 'demo_tb');
assert.equal(field(root, 'task-module').control, 'readonly');
assert.equal(field(root, 'task-duration').commit('123').payload.settings.duration, 123);
assert.throws(() => field(root, 'task-duration').commit('0'), /positive/i);
task.instances.push({id:'clk',preset:{kind:'clock',frequencyMHz:100,initial:0}});
const selected = {kind:'instance',title:'clk',fields:[{id:'instance-name',control:'text',label:'Name',value:'clk'}],deleteEdit:{type:'removeInstance',name:'clk'}} as any;
const clock = projectSimulationTaskInspector(task, 'demo_tb', selected);
assert.equal(field(clock, 'preset-period').value, '10 (1ns)');
assert.equal(field(clock, 'preset-frequency').commit('50').payload.preset.frequencyMHz,50);
assert.throws(() => field(clock, 'preset-frequency').commit('-1'), /positive/i);
assert.equal(clock.deleteEdit, selected.deleteEdit);
task.instances = [{id:'clk',preset:{kind:'clock',frequencyMHz:148.5,initial:0}}];
assert.equal(field(projectSimulationTaskInspector(task, 'demo_tb', selected), 'preset-period').value, '6.734 (1ns)');
task.settings.timePrecision = '10ps';
assert.equal(field(projectSimulationTaskInspector(task, 'demo_tb', selected), 'preset-period').value, '6.74 (1ns)');
task.settings.timeUnit = '10ns';
task.settings.timePrecision = '100ps';
assert.equal(field(projectSimulationTaskInspector(task, 'demo_tb', selected), 'preset-period').value, '0.68 (10ns)');
task.settings.timeUnit = '1ns';
task.settings.timePrecision = '1ps';
task.instances = [{id:'clk',preset:{kind:'stimulus',width:8,initial:"8'h00",transitions:[{at:10,value:"8'hff"}]}}];
const stimulus = projectSimulationTaskInspector(task, 'demo_tb', selected);
assert.equal(stimulus.transitions.rows[0].at,10);
assert.equal(stimulus.transitions.commit([{at:20,value:"8'h12"}]).payload.preset.transitions[0].at,20);
assert.throws(() => stimulus.transitions.commit([{at:20,value:"8'h12"},{at:20,value:"8'h11"}]), /increasing/i);
assert.throws(() => field(stimulus, 'preset-initial').commit("8'h100"), /width/i);
assert.throws(() => field(stimulus, 'preset-width').commit('0'), /positive/i);
assert.throws(() => stimulus.transitions.commit([{at:1,value:'9'},{at:2,value:"7'd9"}]), error =>
    error instanceof TransitionValidationError && error.rowIndex === 0 && error.field === 'value');
assert.throws(() => stimulus.transitions.commit([{at:2,value:"7'd9"},{at:1,value:"7'd9"}]), error =>
    error instanceof TransitionValidationError && error.rowIndex === 1 && error.field === 'time');
const common = {kind:'logic',title:'Constant',fields:[]} as any;
assert.equal(projectSimulationTaskInspector(task,'demo_tb',common),common);
console.log('Simulation preset and task inspector behavior passed');

for (const protocol of ['uart', 'spi', 'apb', 'axis', 'i2c', 'axi4', 'axi4lite', 'rgb888'] as const) {
    const preset = defaultSimulationPreset(protocol);
    assert.equal(preset.kind, 'protocol');
    assert.equal((preset as any).protocol, protocol);
    task.instances = [{ id: 'clk', preset }];
    const inspector = projectSimulationTaskInspector(task, 'demo_tb', selected);
    assert.equal(field(inspector, 'preset-role').control, 'select');
    assert.ok(field(inspector, 'preset-start'));
    assert.ok(field(inspector, 'preset-timeout'));
    if (['apb','axi4','axi4lite'].includes(protocol)) {
        assert.ok(inspector.transactions, protocol + ' exposes addressed read/write transactions');
        assert.equal(field(inspector, 'preset-option-write'), undefined);
        assert.equal(field(inspector, 'preset-option-address'), undefined);
        const rows = [
            { operation: 'write', address: "32'h10", data: ["32'h1234"] },
            { operation: 'read', address: "32'h20", data: [], expected: ["32'h5678"] },
        ];
        assert.deepEqual((inspector.transactions!.commit(rows as any).payload as any).preset.transactions, rows);
        assert.throws(() => inspector.transactions!.commit([{ operation:'read', address:'$finish', data:[], expected:['0'] }]), /address|literal/i);
    } else if (protocol !== 'rgb888') assert.ok(inspector.valueTables?.length, protocol + ' exposes editable values');
    assert.throws(() => field(inspector, 'preset-role').commit('invalid'), /role/i);
    for (const table of inspector.valueTables ?? []) {
        assert.throws(() => table.commit(['$finish;']), /literal|value/i);
    }
}
task.instances = [{ id: 'clk', preset: defaultSimulationPreset('rgb888') }];
let rgb = projectSimulationTaskInspector(task, 'demo_tb', selected);
assert.equal(rgb.valueTables?.length, 0, 'Color bars need no pixel values');
const pixels = field(rgb, 'preset-option-pattern').commit('pixels').payload.preset;
task.instances = [{ id: 'clk', preset: pixels }];
rgb = projectSimulationTaskInspector(task, 'demo_tb', selected);
assert.equal(rgb.valueTables?.[0].label, 'Transmit values');
assert.deepEqual((rgb.valueTables![0].commit(["24'h123456"]).payload as any).preset.data, ["24'h123456"]);
assert.throws(() => field(rgb, 'preset-option-hActive').commit('9000'), /range/i);
const monitor = field(rgb, 'preset-role').commit('monitor').payload.preset;
assert.equal(monitor.role, 'monitor');
const oldApb = defaultSimulationPreset('apb') as any;
delete oldApb.transactions;
oldApb.data=['65535'];oldApb.options.address='65535';oldApb.options.write=true;
task.instances=[{id:'clk',preset:oldApb}];
const oldInspector=projectSimulationTaskInspector(task,'demo_tb',selected);
const converted=(oldInspector.transactions!.commit([{operation:'write',address:'0',data:['1']}]).payload as any).preset;
assert.deepEqual(converted.data,[],'committing explicit rows clears hidden legacy payload');
assert.equal(converted.options.address,undefined);
assert.equal(converted.options.write,undefined);
task.instances=[{id:'clk',preset:converted}];
const convertedInspector=projectSimulationTaskInspector(task,'demo_tb',selected);
assert.doesNotThrow(()=>field(convertedInspector,'preset-option-dataWidth').commit('8'));
assert.doesNotThrow(()=>field(convertedInspector,'preset-option-addressWidth').commit('8'));
assert.equal(field(rgb, 'preset-option-hFrontPorch'), undefined);
for (const key of ['hTotal','hActive','hSyncStart','hSyncEnd','vTotal','vActive','vSyncStart','vSyncEnd']) {
    assert.ok(field(rgb, 'preset-option-'+key), key);
}
