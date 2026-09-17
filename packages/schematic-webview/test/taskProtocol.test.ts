import { strict as assert } from 'node:assert';
import { parseWebviewCommand } from '../../../veriflow-vscode/src/schematic/protocol';
import { createProtocolPreset } from '../../hdl-runtime/src/simulationTask/protocolPresets';

const preset = { kind: 'clock', frequencyMHz: 100, initial: 0 };
const add = { type: 'simulationTaskCommand', revision: 'r1', command: 'addPreset', payload: { id: 'clock_0', preset } };
assert.deepEqual(parseWebviewCommand(add), add);
for (const command of ['generateTestbench', 'run', 'cancel', 'openWave']) {
    const action = { type: 'simulationTaskCommand', revision: 'r1', command };
    assert.equal(parseWebviewCommand(action)?.type, 'simulationTaskCommand');
}
const addressed = { ...createProtocolPreset('apb'), transactions: [
    { operation:'write',address:"32'h10",data:["32'h12"] },
    { operation:'read',address:"32'h20",data:[],expected:["32'h34"] },
] };
const busAction = { ...add, payload:{ id:'bus',preset:addressed } };
assert.deepEqual(parseWebviewCommand(busAction),busAction);
assert.equal(parseWebviewCommand({...busAction,payload:{id:'bus',preset:{...addressed,transactions:[{operation:'erase',address:'0',data:['0']}]}}}),undefined);
for (const command of ['addModule', 'addBuiltin', 'createStimulus', 'addEnvironment', 'editHdl', 'updateTask', 'rerunFailed', 'artifact', 'compare', 'previewScenarios', 'selectCase', 'json', 'save']) {
    assert.equal(parseWebviewCommand({ type: 'simulationTaskCommand', revision: 'r1', command }), undefined, command);
}
for (const payload of [{ id: 'bad name', preset }, { id: 'clock', preset: { ...preset, frequencyMHz: -1 } }, { id: 'clock', preset: { ...preset, source: 'arbitrary code' } }, { id: 'stim', preset: { kind: 'stimulus', width: 1, initial: "1'b0", transitions: [{at: -1,value:"1'b1"}] } }]) {
    assert.equal(parseWebviewCommand({ ...add, payload }), undefined);
}
console.log('Simulation task command contract passed');
for (const protocol of ['uart', 'spi', 'apb', 'axis', 'i2c', 'axi4', 'axi4lite', 'rgb888'] as const) {
    const protocolPreset = createProtocolPreset(protocol);
    const action = { ...add, payload: { id: 'protocol_0', preset: protocolPreset } };
    assert.deepEqual(parseWebviewCommand(action), action);
    for (const invalid of [{ ...protocolPreset, role: 'bad' }, { ...protocolPreset, code: 'always' }, { ...protocolPreset, data: ['$finish;'] }]) {
        assert.equal(parseWebviewCommand({ ...action, payload: { id: 'protocol_0', preset: invalid } }), undefined);
    }
}
