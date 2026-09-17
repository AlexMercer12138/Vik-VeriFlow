import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { IverilogWasmBackend } from '@veriflow/simulator-iverilog-wasm';
import { createInterfaceProtocolCatalog } from '@veriflow/schematic-core/interfaces';
import { createSimulationTask, generateTestbench, describeArchDesignSource, type TaskModuleDefinition, type SimulationTaskDocument } from '../src/simulationTask';
import { createEmptyArchDesign } from '@veriflow/schematic-core/arch-design';

function connect(task: SimulationTaskDocument, name: string, a: string, ap: string, b: string, bp: string): void {
    task.connections = [...task.connections, { name, endpoints: [{ kind: 'instance', instance: a, port: ap }, { kind: 'instance', instance: b, port: bp }] }];
}

test('AD source metadata exposes physical grouped interface members and preserves symbolic widths', () => {
    const catalog = createInterfaceProtocolCatalog([{ source: 'custom.json', value: {
        format: 'veriflow-interface-protocol', schemaVersion: 1, id: 'project.link', name: 'Link', separator: '_', priority: 100,
        members: [{ name: 'request', direction: 'master-to-slave' }, { name: 'accept', direction: 'slave-to-master' }], recognitionGroups: [['request', 'accept']],
    } }]);
    const description = describeArchDesignSource({ ...createEmptyArchDesign('design'),
        ports: [{ name: 'clk', direction: 'input' }, { name: 'unknown_data', direction: 'input', width: { expression: 'WIDTH' } }],
        interfacePorts: [{ name: 'link', protocol: 'project.link', role: 'slave', memberPrefix: 'BUS', members: [{ member: 'request', width: 8 }, { member: 'accept', width: 1 }] }],
    }, 'design.ad', catalog);
    assert.deepEqual(description.ports, [{ name: 'clk', direction: 'input', width: 1 }, { name: 'unknown_data', direction: 'input', width: 'WIDTH' },
        { name: 'BUS_request', direction: 'input', width: 8 }, { name: 'BUS_accept', direction: 'output', width: 1 }]);
});

test('unwired editing is valid but generation rejects undriven, unknown widths and multiple definite drivers', () => {
    const task = createSimulationTask();
    task.instances.push({ id: 'dut', source: { kind: 'hdl', path: 'dut.v', module: 'dut' }, parameters: {} });
    const definition: TaskModuleDefinition = { source: 'dut.v', module: 'dut', ports: [{ name: 'a', direction: 'input', width: 1 }] };
    assert.throws(() => generateTestbench(task, 'demo_tb', [definition]), /undriven/i);
    task.defaults = { 'dut.a': "1'b0" };
    assert.doesNotThrow(() => generateTestbench(task, 'demo_tb', [definition]));
    assert.throws(() => generateTestbench(task, 'demo_tb', [{ ...definition, ports: [{ name: 'a', direction: 'input' }] }]), /width/);
    task.instances.push(...['a', 'b'].map(id => ({ id, preset: { kind: 'clock' as const, frequencyMHz: 100, initial: 0 as const } })));
    task.connections = [{ name: 'net', endpoints: [{ kind: 'instance', instance: 'a', port: 'clk' }, { kind: 'instance', instance: 'b', port: 'clk' }, { kind: 'instance', instance: 'dut', port: 'a' }] }];
    assert.throws(() => generateTestbench(task, 'demo_tb', [definition]), /driver/);
});

test('actual WASM simulation preserves two clocks, reset polarities, parameter width, stimulus and finish time', async () => {
    const task = createSimulationTask('core.st'); task.settings.duration = 40;
    task.instances = [
        { id: 'fast', preset: { kind: 'clock', frequencyMHz: 100, initial: 0 } },
        { id: 'slow', preset: { kind: 'clock', frequencyMHz: 50, initial: 1 } },
        { id: 'low_reset', preset: { kind: 'reset', active: 0, duration: 12 } },
        { id: 'high_reset', preset: { kind: 'reset', active: 1, duration: 7 } },
        { id: 'stim', preset: { kind: 'stimulus', width: 8, initial: "8'h00", transitions: [{ at: 3, value: "8'ha5" }, { at: 21, value: "8'h5a" }] } },
        { id: 'dut', source: { kind: 'hdl', path: 'dut.v', module: 'dut' }, parameters: { WIDTH: '8' } },
    ];
    for (const [a, ap, bp] of [['fast', 'clk', 'clk'], ['slow', 'clk', 'other_clk'], ['low_reset', 'reset', 'rst_n'], ['high_reset', 'reset', 'rst'], ['stim', 'out', 'data']]) connect(task, `net_${bp}`, a, ap, 'dut', bp);
    const definitions: TaskModuleDefinition[] = [{ source: 'dut.v', module: 'dut', parameters: [{ name: 'WIDTH', defaultValue: '1' }], ports: [
        ...['clk', 'other_clk', 'rst_n', 'rst'].map(name => ({ name, direction: 'input' as const, width: 1 })),
        { name: 'data', direction: 'input', width: 'WIDTH' },
    ] }];
    const generated = generateTestbench(task, 'core_tb', definitions);
    assert.equal(generated.text, generateTestbench(task, 'core_tb', definitions).text);
    const root = await mkdtemp(path.join(os.tmpdir(), 'vf-core-wasm-'));
    try {
        await writeFile(path.join(root, 'core_tb.v'), generated.text);
        await writeFile(path.join(root, 'dut.v'), `\`timescale 1ns/1ps
module dut #(parameter WIDTH=1)(input clk, input other_clk, input rst_n, input rst, input [WIDTH-1:0] data);
always @(clk) $display("FAST %0t %b", $time, clk);
always @(other_clk) $display("SLOW %0t %b", $time, other_clk);
always @(rst_n) $display("LOW %0t %b", $time, rst_n);
always @(rst) $display("HIGH %0t %b", $time, rst);
always @(data) $display("DATA %0t %h", $time, data);
initial begin #39 $display("WIDTH %0d", WIDTH); #2 $display("TOO_LATE"); end
endmodule`);
        const result = await new IverilogWasmBackend().compileAndRun({ files: [path.join(root, 'core_tb.v'), path.join(root, 'dut.v')], runtimeFiles: [], includeDirs: [], defines: {}, plusargs: [],
            artifacts: [{ kind: 'vcd', path: 'core_tb.vcd', destination: path.join(root, 'wave.vcd'), required: true }], output: path.join(root, 'core.out'), cwd: root, topModule: 'core_tb', timeoutMs: 30000 });
        assert.equal(result.success, true, result.stderr);
        for (const expected of ['FAST 5000 1', 'FAST 10000 0', 'SLOW 10000 0', 'SLOW 20000 1', 'LOW 0 0', 'LOW 12000 1', 'HIGH 0 1', 'HIGH 7000 0', 'DATA 3000 a5', 'DATA 21000 5a', 'WIDTH 8']) assert.ok(result.stdout.includes(expected), `${expected}\n${result.stdout}`);
        assert.doesNotMatch(result.stdout, /TOO_LATE/);
        const wave = await readFile(path.join(root, 'wave.vcd'), 'utf8');
        assert.match(wave, /#40000/);
    } finally { await rm(root, { recursive: true, force: true }); }
});

test('stimulus drives an inout wire then releases it to a DUT driver in real WASM', async () => {
    const task = createSimulationTask('tri.st'); task.settings.duration = 12; task.settings.waveform.enabled = false;
    task.instances = [{ id: 'stim', preset: { kind: 'stimulus', width: 1, initial: "1'b0", transitions: [{ at: 5, value: "1'bz" }] } },
        { id: 'dut', source: { kind: 'hdl', path: 'dut.v', module: 'dut' }, parameters: {} }];
    connect(task, 'bus', 'stim', 'out', 'dut', 'pin');
    const generated = generateTestbench(task, 'tri_tb', [{ source: 'dut.v', module: 'dut', ports: [{ name: 'pin', direction: 'inout', width: 1 }] }]);
    const root = await mkdtemp(path.join(os.tmpdir(), 'vf-core-tri-'));
    try {
        const tb = path.join(root, 'tri_tb.v'), dut = path.join(root, 'dut.v');
        await writeFile(tb, generated.text);
        await writeFile(dut, "`timescale 1ns/1ps\nmodule dut(inout pin); reg drive=0; assign pin=drive ? 1'b1 : 1'bz; initial begin #2 $display(\"LOW=%b\",pin); #4 drive=1; #1 $display(\"RELEASE=%b\",pin); end endmodule");
        const result = await new IverilogWasmBackend().compileAndRun({ files: [tb, dut], runtimeFiles: [], includeDirs: [], defines: {}, plusargs: [], artifacts: [], output: path.join(root, 'tri.out'), cwd: root, topModule: 'tri_tb', timeoutMs: 30000 });
        assert.equal(result.success, true, result.stderr);
        assert.match(result.stdout, /LOW=0/); assert.match(result.stdout, /RELEASE=1/);
    } finally { await rm(root, { recursive: true, force: true }); }
});

test('AD logic utility and grouped interface bindings use the shared resolver in real WASM', async () => {
    const catalog = createInterfaceProtocolCatalog([{ source: 'custom.json', value: {
        format: 'veriflow-interface-protocol', schemaVersion: 1, id: 'project.link', name: 'Link', separator: '_', priority: 100,
        members: [{ name: 'request', direction: 'master-to-slave' }, { name: 'accept', direction: 'slave-to-master' }], recognitionGroups: [['request', 'accept']],
    } }]);
    assert.deepEqual(catalog.diagnostics, []);
    const task = createSimulationTask('link.st'); task.settings.duration = 3; task.settings.waveform.enabled = false;
    task.instances = [{ id: 'master_inst', source: { kind: 'hdl', path: 'link.v', module: 'master' }, parameters: {} },
        { id: 'slave_inst', source: { kind: 'hdl', path: 'link.v', module: 'slave' }, parameters: {} }];
    task.logic = [{ name: 'constant', operation: 'constant', width: 8, expression: "8'h2a" }];
    task.connections = [{ name: 'data', endpoints: [{ kind: 'logic', logic: 'constant', port: 'out' }, { kind: 'instance', instance: 'master_inst', port: 'data' }] }];
    task.interfaceConnections = [{ name: 'link', master: { kind: 'instance', instance: 'master_inst', interface: 'BUS' }, slave: { kind: 'instance', instance: 'slave_inst', interface: 'LINK' } }];
    const definitions: TaskModuleDefinition[] = [
        { source: 'link.v', module: 'master', ports: [{ name: 'data', direction: 'input', width: 8 }, { name: 'BUS_REQUEST', direction: 'output', width: 8 }, { name: 'BUS_ACCEPT', direction: 'input', width: 1 }] },
        { source: 'link.v', module: 'slave', ports: [{ name: 'LINK_REQUEST', direction: 'input', width: 8 }, { name: 'LINK_ACCEPT', direction: 'output', width: 1 }] },
    ];
    const output = generateTestbench(task, 'link_tb', definitions, catalog);
    const root = await mkdtemp(path.join(os.tmpdir(), 'vf-core-link-'));
    try {
        const tb = path.join(root, 'link_tb.v'), hdl = path.join(root, 'link.v');
        await writeFile(tb, output.text);
        await writeFile(hdl, '`timescale 1ns/1ps\nmodule master(input [7:0] data, output [7:0] BUS_REQUEST, input BUS_ACCEPT); assign BUS_REQUEST=data; initial #1 $display("ACCEPT=%b",BUS_ACCEPT); endmodule\nmodule slave(input [7:0] LINK_REQUEST, output LINK_ACCEPT); assign LINK_ACCEPT=1; initial #1 $display("REQUEST=%h",LINK_REQUEST); endmodule');
        const result = await new IverilogWasmBackend().compileAndRun({ files: [tb, hdl], runtimeFiles: [], includeDirs: [], defines: {}, plusargs: [], artifacts: [], output: path.join(root, 'link.out'), cwd: root, topModule: 'link_tb', timeoutMs: 30000 });
        assert.equal(result.success, true, result.stderr);
        assert.match(result.stdout, /ACCEPT=1/); assert.match(result.stdout, /REQUEST=2a/);
    } finally { await rm(root, { recursive: true, force: true }); }
});
