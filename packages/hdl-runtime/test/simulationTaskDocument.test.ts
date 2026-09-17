import assert from 'node:assert/strict';
import test from 'node:test';
import { createSimulationTask, parseSimulationTask, describePreset, generateTestbench } from '../src/simulationTask';

test('empty task is editable and old product fields are rejected', () => {
    const task = createSimulationTask();
    assert.equal(task.settings.duration, 1000000);
    assert.deepEqual(parseSimulationTask(JSON.stringify(task)), task);
    for (const field of ['cases', 'assets', 'verification', 'backend', 'defaults', 'environment']) {
        assert.throws(() => parseSimulationTask(JSON.stringify({ ...task, [field]: [] })), /unsupported/i);
    }
    task.settings.exportPath = '../exports/demo.v';
    assert.equal(parseSimulationTask(JSON.stringify(task)).settings.exportPath, '../exports/demo.v');
});

test('preset metadata and generation express rounded clock ticks in task time units', () => {
    assert.deepEqual(describePreset({ kind: 'clock', frequencyMHz: 100, initial: 0 }).ports,
        [{ name: 'clk', direction: 'output', width: 1 }]);
    const task = createSimulationTask();
    task.instances.push({ id: 'clock_inst', preset: { kind: 'clock', frequencyMHz: 100, initial: 0 } });
    assert.match(generateTestbench(task, 'demo_tb', []).text, /always #\(5\)/);
    task.settings.timeUnit = '1ps';
    assert.match(generateTestbench(task, 'demo_tb', []).text, /always #\(5000\)/);
    task.instances[0] = { id: 'clock_inst', preset: { kind: 'clock', frequencyMHz: 123, initial: 0 } };
    assert.match(generateTestbench(task, 'demo_tb', []).text, /always #\(4065\)/);
});

test('invalid stimulus times and values fail before generation', () => {
    const task = createSimulationTask();
    task.instances.push({ id: 'stim', preset: { kind: 'stimulus', width: 8, initial: "8'h00", transitions: [{ at: 1, value: "8'hff" }, { at: 1, value: "8'h00" }] } });
    assert.throws(() => parseSimulationTask(JSON.stringify(task)), /increasing/);
    task.instances[0] = { id: 'stim', preset: { kind: 'stimulus', width: 8, initial: "9'h100", transitions: [] } };
    assert.throws(() => parseSimulationTask(JSON.stringify(task)), /width/);
});

test('nested unknown fields, external endpoints, coarser precision and inexact times are rejected', () => {
    const task = createSimulationTask();
    assert.throws(() => parseSimulationTask(JSON.stringify({ ...task, settings: { ...task.settings, timeoutMs: 50 } })), /unsupported/);
    assert.throws(() => parseSimulationTask(JSON.stringify({ ...task, presentation: { assets: [] } })), /unsupported/);
    assert.throws(() => parseSimulationTask(JSON.stringify({ ...task, connections: [{ name: 'bad', endpoints: [{ kind: 'port', port: 'external' }] }] })), /endpoint/i);
    task.settings.timePrecision = '10ns';
    assert.throws(() => parseSimulationTask(JSON.stringify(task)), /coarser/);
    task.settings.timePrecision = '1ps'; task.settings.duration = 0.0001;
    assert.throws(() => parseSimulationTask(JSON.stringify(task)), /precision/);
});

test('narrow literals extend without permitting truncation and decimal transitions keep exact delay', () => {
    const task = createSimulationTask();
    task.instances = [{ id: 'stim', preset: { kind: 'stimulus', width: 8, initial: "1'b0", transitions: [{ at: 0.1, value: "8'h01" }, { at: 0.3, value: "8'h02" }] } }];
    assert.match(generateTestbench(task, 'exact_tb', []).text, /#\(0\.2\) out <= 8'h02/);
    task.instances[0] = { id: 'stim', preset: { kind: 'stimulus', width: 8, initial: "1'hff", transitions: [] } };
    assert.throws(() => parseSimulationTask(JSON.stringify(task)), /declared width/);
});
