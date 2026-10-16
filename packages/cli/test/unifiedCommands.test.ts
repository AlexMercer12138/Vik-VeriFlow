import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { runCli } from '../src/main';

test('canonical arch/task authoring builds documents and failed batches preserve the source', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'veriflow-commands-'));
    let stdout = '', stderr = '';
    const run = (argv: string[]) => { stdout = ''; stderr = ''; return runCli(argv, { cwd: dir, homeDir: dir, stdout: text => { stdout += text; }, stderr: text => { stderr += text; } }); };
    try {
        assert.equal(await run(['arch', 'new', 'top']), 0, stderr);
        const operations = path.join(dir, 'ops.json');
        await writeFile(operations, JSON.stringify({ format: 'veriflow-arch-edits', schemaVersion: 1, operations: [
            { type: 'addPort', port: { name: 'led', direction: 'output' } },
            { type: 'setDefault', endpoint: 'led.value', expression: "1'b0" },
        ] }));
        assert.equal(await run(['arch', 'apply', 'top.ad', '--ops', 'ops.json', '--in-place']), 0, stderr);
        const original = await readFile(path.join(dir, 'top.ad'), 'utf8');
        await writeFile(operations, JSON.stringify({ format: 'veriflow-arch-edits', schemaVersion: 1, operations: [{ type: 'removePort', name: 'missing' }] }));
        assert.equal(await run(['arch', 'apply', 'top.ad', '--ops', 'ops.json', '--in-place']), 1);
        assert.match(stderr, /operations\[0\]/);
        assert.equal(await readFile(path.join(dir, 'top.ad'), 'utf8'), original);
        assert.equal(await run(['arch', 'build', 'top.ad']), 0, stderr);
        assert.match(await readFile(path.join(dir, 'top.v'), 'utf8'), /module top/);
        assert.equal(await run(['task', 'new', '-o', 'sim.st']), 0, stderr);
        assert.equal(await run(['task', 'tb', 'sim.st']), 0, stderr);
        assert.match(stdout, /module sim_tb/);
    } finally { await rm(dir, { recursive: true, force: true }); }
});

test('scripted ST resolves HDL, connects presets, renames the DUT and runs the generated TB', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'veriflow-task-script-'));
    let stdout = '', stderr = '';
    const run = (argv: string[]) => { stdout = ''; stderr = ''; return runCli(argv, { cwd: dir, homeDir: dir, stdout: text => { stdout += text; }, stderr: text => { stderr += text; } }); };
    try {
        await writeFile(path.join(dir, 'dut.v'), 'module dut(input clk, input reset, input value); initial begin #25; $display("SCRIPT_VALUE=%b", value); end endmodule');
        assert.equal(await run(['task', 'new', '-o', 'sim.st']), 0, stderr);
        await writeFile(path.join(dir, 'ops.json'), JSON.stringify({ format: 'veriflow-task-edits', schemaVersion: 1, operations: [
            { type: 'addSourceInstance', id: 'dut', source: { kind: 'hdl', path: 'dut.v', module: 'dut' } },
            { type: 'addPreset', id: 'clock', preset: { kind: 'clock', frequencyMHz: 100, initial: 0 } },
            { type: 'addPreset', id: 'reset', preset: { kind: 'reset', active: 1, duration: 10 } },
            { type: 'addPreset', id: 'stim', preset: { kind: 'stimulus', width: 1, initial: "1'b0", transitions: [{ at: 15, value: "1'b1" }] } },
            ...[['clock', 'clk', 'clk'], ['reset', 'reset', 'reset'], ['stim', 'out', 'value']].map(([instance, port, target]) => ({
                type: 'connect', source: { kind: 'instance', instance, port }, target: { kind: 'instance', instance: 'dut', port: target },
            })),
            { type: 'renameInstance', name: 'dut', nextName: 'top_under_test' },
            { type: 'updatePreset', id: 'reset', preset: { kind: 'reset', active: 1, duration: 5 } },
            { type: 'updateTaskSettings', settings: { duration: 30, waveform: { enabled: false, filename: 'sim.vcd' } } },
        ] }));
        assert.equal(await run(['task', 'apply', 'sim.st', '--ops', 'ops.json', '--in-place']), 0, stderr);
        const persisted = JSON.parse(await readFile(path.join(dir, 'sim.st'), 'utf8'));
        assert.equal(persisted.instances[0].id, 'top_under_test');
        assert.equal(persisted.connections.length, 3);
        assert.equal(await run(['task', 'tb', 'sim.st', '-o', 'sim_tb.v']), 0, stderr);
        assert.match(await readFile(path.join(dir, 'sim_tb.v'), 'utf8'), /top_under_test/);
        assert.equal(await run(['task', 'run', 'sim.st']), 0, stderr);
        assert.match(stdout, /SCRIPT_VALUE=1/);
    } finally { await rm(dir, { recursive: true, force: true }); }
});

test('AD build integrates XDC, pins exports agree, and board dry-run preserves other user settings', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'veriflow-board-build-'));
    let stdout = '', stderr = '';
    const run = (argv: string[]) => { stdout = ''; stderr = ''; return runCli(argv, { cwd: dir, homeDir: dir, stdout: text => { stdout += text; }, stderr: text => { stderr += text; } }); };
    try {
        const config = path.join(dir, '.veriflow_config.json');
        await writeFile(config, JSON.stringify({ libDirs: [], customSetting: { preserve: true } }));
        await writeFile(path.join(dir, 'board.json'), JSON.stringify({
            model: { kind: 'board', vendor: 'amd', device: 'xcau15p-ffvb676-2-i',
                rails: [{ id: 'v', millivolts: 1800 }], banks: [{ id: '64', supplyRail: 'v' }],
                fpgaPins: [{ id: 'A1', bank: '64' }], interfaces: [{ id: 'GPIO', definition: 'gpio.json' }],
                routes: [{ interface: 'GPIO', member: 'led', pin: 'A1' }] },
            definitions: { 'gpio.json': { kind: 'expansion', signals: ['led'] } },
        }));
        const original = await readFile(config, 'utf8');
        assert.equal(await run(['board', 'import', 'board.json', '--id', 'demo', '--dry-run']), 0, stderr);
        assert.equal(await readFile(config, 'utf8'), original);
        assert.equal(await run(['board', 'import', 'board.json', '--id', 'demo']), 0, stderr);
        assert.equal(JSON.parse(await readFile(config, 'utf8')).customSetting.preserve, true);
        assert.equal(await run(['arch', 'new', 'top']), 0, stderr);
        const physical = { board: 'user:demo', bindings: [{ source: { interface: 'GPIO', member: 'led' }, port: { name: 'led' } }],
            ioStandards: [{ interface: 'GPIO', member: 'led', standard: 'LVCMOS18' }] };
        await writeFile(path.join(dir, 'ops.json'), JSON.stringify({ format: 'veriflow-arch-edits', schemaVersion: 1, operations: [
            { type: 'addPort', port: { name: 'led', direction: 'output' } },
            { type: 'setDefault', endpoint: 'led.value', expression: "1'b0" },
            { type: 'setPhysical', physical },
        ] }));
        assert.equal(await run(['arch', 'apply', 'top.ad', '--ops', 'ops.json', '--in-place']), 0, stderr);
        await writeFile(path.join(dir, 'top.xdc'), 'handwritten');
        assert.equal(await run(['arch', 'build', 'top.ad', '--dry-run']), 1);
        await assert.rejects(readFile(path.join(dir, 'top.v')), { code: 'ENOENT' });
        await rm(path.join(dir, 'top.xdc'));
        assert.equal(await run(['arch', 'build', 'top.ad']), 0, stderr);
        const constraints = await readFile(path.join(dir, 'top.xdc'), 'utf8');
        assert.match(constraints, /PACKAGE_PIN A1/);
        assert.equal(await run(['pins', 'export', 'top.ad', '-o', 'pins.xdc']), 0, stderr);
        assert.equal(await readFile(path.join(dir, 'pins.xdc'), 'utf8'), constraints);
        await writeFile(path.join(dir, 'top.pins.json'), JSON.stringify(physical));
        assert.equal(await run(['pins', 'export', 'top.v', '--config', 'top.pins.json', '-o', 'rtl.xdc']), 0, stderr);
        assert.equal((await readFile(path.join(dir, 'rtl.xdc'), 'utf8')).split('\n').slice(1).join('\n'), constraints.split('\n').slice(1).join('\n'));
    } finally { await rm(dir, { recursive: true, force: true }); }
});

test('HDL quick actions format, generate TB and run a literal dumpfile with a custom destination', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'veriflow-hdl-actions-'));
    let stdout = '', stderr = '';
    const run = (argv: string[]) => { stdout = ''; stderr = ''; return runCli(argv, { cwd: dir, homeDir: dir, stdout: text => { stdout += text; }, stderr: text => { stderr += text; } }); };
    try {
        await writeFile(path.join(dir, 'dut.v'), 'module dut(input clk, output value);assign value=clk;endmodule');
        assert.equal(await run(['hdl', 'format', 'dut.v', '--in-place']), 0, stderr);
        assert.equal(await run(['hdl', 'format', 'dut.v', '--check']), 0, stderr);
        assert.equal(await run(['hdl', 'instantiate', 'dut.v']), 0, stderr);
        assert.match(stdout, /dut\s+\w+\s*\(/);
        assert.equal(await run(['hdl', 'tb', 'dut.v', '-o', 'dut_tb.v']), 0, stderr);
        assert.match(await readFile(path.join(dir, 'dut_tb.v'), 'utf8'), /module dut_tb/);
        await writeFile(path.join(dir, 'run.v'), 'module run; initial begin /* $dumpfile("wrong.vcd"); */ $dumpfile("actual.vcd"); $dumpvars(0,run); #1; $display("QUICK_RUN"); $finish; end endmodule');
        assert.equal(await run(['hdl', 'run', 'run.v', '--wave-output', 'copied.vcd', '--json']), 0, stderr);
        const result = JSON.parse(stdout);
        assert.match(result.execution.stdout, /QUICK_RUN/);
        assert.ok(result.execution.artifacts.some((artifact: { written: boolean; destination: string }) => artifact.written && artifact.destination === path.join(dir, 'copied.vcd')));
        assert.match(await readFile(path.join(dir, 'copied.vcd'), 'utf8'), /\$enddefinitions/);
    } finally { await rm(dir, { recursive: true, force: true }); }
});
