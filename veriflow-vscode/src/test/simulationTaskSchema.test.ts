import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createSimulationTask, parseSimulationTask } from '@veriflow/hdl-runtime/simulationTask';
import { PROTOCOL_PRESET_TEMPLATES, createProtocolPreset } from '@veriflow/hdl-runtime/simulationTask/protocolPresets';

const Ajv = require('ajv');
const schema = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../schemas/simulation-task.schema.json'), 'utf8'));
const validate = new Ajv({ strict: false, allErrors: true }).compile(schema);
const task = createSimulationTask('schema.st');
task.instances.push({ id: 'clk_inst', preset: { kind: 'clock', frequencyMHz: 100, initial: 0 } },
    { id: 'reset_inst', preset: { kind: 'reset', active: 0, duration: 100 } },
    { id: 'stimulus_inst', preset: { kind: 'stimulus', width: 8, initial: "8'h00", transitions: [{ at: 120, value: "8'h5a" }] } });
assert.equal(validate(task), true, JSON.stringify(validate.errors));
parseSimulationTask(JSON.stringify(task));
for (const key of ['assets', 'cases', 'mode', 'verification', 'backend', 'runtimeFiles']) {
    assert.equal(validate({ ...task, [key]: [] }), false, `Retired ${key} must not be accepted by the editor schema`);
}
const invalid = structuredClone(task);
(invalid.instances[0] as any).preset.source = 'always #5 clk = ~clk;';
assert.equal(validate(invalid), false, 'preset cannot hide arbitrary HDL');
const externalPort = { ...task, connections: [{ name: 'bad', endpoints: [{ kind: 'port', port: 'clk' }] }] };
assert.equal(validate(externalPort), false, 'ST has no top-level ports');
const empty = createSimulationTask();
assert.equal(validate(empty), true, JSON.stringify(validate.errors));
console.log('Simulation Task schema and runtime shape tests passed');
for (const template of PROTOCOL_PRESET_TEMPLATES) {
    const preset = createProtocolPreset(template.protocol, template.role);
    const protocolTask = { ...empty, instances: [{ id: 'protocol_0', preset }] };
    assert.equal(validate(protocolTask), true, JSON.stringify(validate.errors));
    parseSimulationTask(JSON.stringify(protocolTask));
    assert.equal(validate({ ...protocolTask, instances: [{ id: 'protocol_0', preset: { ...preset, role: 'invalid' } }] }), false);
    assert.equal(validate({ ...protocolTask, instances: [{ id: 'protocol_0', preset: { ...preset, options: { code: 'always' } } }] }), false);
}
for (const protocol of ['apb','axi4lite','axi4'] as const) {
    const preset = createProtocolPreset(protocol);
    preset.transactions = [
        {operation:'write',address:"32'h10",data:["32'h1234"]},
        {operation:'read',address:"32'h20",data:[],expected:["32'h5678"]},
    ];
    const addressedTask = {...empty,instances:[{id:'bus',preset}]};
    assert.equal(validate(addressedTask),true,JSON.stringify(validate.errors));
    parseSimulationTask(JSON.stringify(addressedTask));
    preset.transactions[0].address='';preset.transactions[0].data=[];
    assert.equal(validate(addressedTask),true,'incomplete transaction drafts remain editable');
    parseSimulationTask(JSON.stringify(addressedTask));
    (preset.transactions[0] as any).operation='erase';
    assert.equal(validate(addressedTask),false);
}
const rgb = createProtocolPreset('rgb888');
Object.assign(rgb.options,{hTotal:2200,hActive:1920,hSyncStart:2008,hSyncEnd:2052,vTotal:1125,vActive:1080,vSyncStart:1084,vSyncEnd:1089});
const rgbTask = {...empty,instances:[{id:'video',preset:rgb}]};
assert.equal(validate(rgbTask),true,JSON.stringify(validate.errors));
parseSimulationTask(JSON.stringify(rgbTask));
