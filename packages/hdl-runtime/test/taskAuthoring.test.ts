import assert from 'node:assert/strict';
import test from 'node:test';
import { applyTaskEdit, createSimulationTask } from '../src/simulationTask';

test('script instances preserve exact source identity and reject duplicate IDs without mutation', () => {
    const empty = createSimulationTask();
    const task = applyTaskEdit(empty, [], { type: 'addSourceInstance', id: 'dut', source: { kind: 'hdl', path: 'rtl/dut.v', module: 'dut' } });
    assert.deepEqual(task.instances, [{ id: 'dut', source: { kind: 'hdl', path: 'rtl/dut.v', module: 'dut' }, parameters: {} }]);
    assert.equal(empty.instances.length, 0);
    assert.throws(() => applyTaskEdit(task, [], { type: 'addPreset', id: 'dut', preset: { kind: 'clock', initial: 0, frequencyMHz: 100 } }));
    assert.equal(task.instances.length, 1);
});
