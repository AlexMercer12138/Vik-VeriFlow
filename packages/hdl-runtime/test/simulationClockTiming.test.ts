import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { IverilogWasmBackend } from '@veriflow/simulator-iverilog-wasm';
import { createSimulationTask, generateTestbench, parseSimulationTask, renderPreset, validatePreset } from '../src/simulationTask';

const clock = (frequencyMHz: number) => ({ kind: 'clock' as const, frequencyMHz, initial: 0 as const });

for (const [frequency, unit, precision, delay] of [
    [148.5, '1ns', '1ps', '3.367'],
    [148.5, '1ns', '10ps', '3.37'],
    [148.5, '10ns', '100ps', '0.34'],
    [148.5, '100ns', '1ps', '0.03367'],
    [100, '1ns', '1ps', '5'],
    [200, '1ns', '1ns', '3'], // 2.5 ticks: ties round up.
    [1e9, '1fs', '1fs', '1'], // 0.5 ticks remains a nonzero clock.
    [1e-8, '100s', '1s', '0.5'],
    [1e-3, '1ms', '1us', '0.5'],
    [1, '1us', '1ns', '0.5'],
] as const) {
    test(`${frequency} MHz generates rounded ${delay} delay in ${unit}/${precision}`, () => {
        const task = createSimulationTask();
        task.settings = { ...task.settings, timeUnit: unit, timePrecision: precision };
        task.instances = [{ id: 'clock', preset: clock(frequency) }];
        assert.doesNotThrow(() => parseSimulationTask(JSON.stringify(task)));
        assert.match(renderPreset(clock(frequency), 'clock_gen', unit, precision), new RegExp(`always #\\(${delay.replace('.', '\\.')}\\)`));
    });
}

test('clock delays that round to zero explain how to choose a usable precision', () => {
    const settings = createSimulationTask().settings;
    for (const frequency of [1000000.1, Number.MAX_VALUE]) {
        assert.throws(() => validatePreset(clock(frequency), settings), /rounds to zero.*finer.*precision/i);
        assert.throws(() => renderPreset(clock(frequency), 'clock_gen', '1ns', '1ps'), /rounds to zero.*finer.*precision/i);
    }
});

test('invalid and excessively slow clocks fail with an actionable error', () => {
    const settings = createSimulationTask().settings;
    for (const frequency of [0, -1, NaN, Infinity]) assert.throws(() => validatePreset(clock(frequency), settings), /positive/i);
    for (const frequency of [Number.MIN_VALUE, 1e-20]) {
        assert.throws(() => validatePreset(clock(frequency), settings), /safe.*range.*coarser.*precision/i);
    }
});

for (const [precision, edgeTimes] of [
    ['1ps', [0, 3367, 6734, 10101, 13468, 16835]],
    ['10ps', [0, 337, 674, 1011, 1348, 1685]],
    ['100ps', [0, 34, 68, 102, 136, 170]],
] as const) {
    test(`148.5 MHz generated testbench has rounded VCD edges at ${precision} in Icarus WASM`, async () => {
        const task = createSimulationTask('clock.st');
        task.settings.duration = 20;
        task.settings.timePrecision = precision;
        task.instances = [{ id: 'clock', preset: clock(148.5) }];
        const generated = generateTestbench(task, 'clock_tb', []);
        const root = await mkdtemp(path.join(os.tmpdir(), 'vf-clock-rounding-'));
        try {
            const source = path.join(root, 'clock_tb.v');
            const wave = path.join(root, 'wave.vcd');
            await writeFile(source, generated.text);
            const result = await new IverilogWasmBackend().compileAndRun({
                files: [source], runtimeFiles: [], includeDirs: [], defines: {}, plusargs: [],
                artifacts: [{ kind: 'vcd', path: task.settings.waveform.filename, destination: wave, required: true }],
                output: path.join(root, 'clock.out'), cwd: root, topModule: 'clock_tb', timeoutMs: 30000,
            });
            assert.equal(result.success, true, result.stderr);
            const vcd = await readFile(wave, 'utf8');
            assert.match(vcd, new RegExp(`\\$timescale\\s+${precision}\\s+\\$end`));
            const symbol = /\$var reg 1 (\S+) clk \$end/.exec(vcd)?.[1];
            assert.ok(symbol, vcd);
            let time = 0;
            const actual: number[] = [];
            for (const line of vcd.split(/\r?\n/)) {
                if (line.startsWith('#')) time = Number(line.slice(1));
                else if (line === `0${symbol}` || line === `1${symbol}`) actual.push(time);
            }
            assert.deepEqual(actual, edgeTimes);
        } finally { await rm(root, { recursive: true, force: true }); }
    });
}
