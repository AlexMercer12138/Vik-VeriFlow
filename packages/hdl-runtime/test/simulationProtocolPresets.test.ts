import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { IverilogWasmBackend } from '@veriflow/simulator-iverilog-wasm';
import { createInterfaceProtocolCatalog, recognizeModuleInterfaces } from '@veriflow/schematic-core/interfaces';
import { createSimulationTask, createProtocolPreset, describeProtocolPreset, generateTestbench,
    PROTOCOL_PRESET_TEMPLATES, renderProtocolPreset, protocolPresetPayloadFields, validatePreset, validateProtocolPreset, type ProtocolPreset, type SimulationTaskDocument } from '../src/simulationTask';

test('all protocol role defaults validate and expose concrete automatic ports', () => {
    assert.equal(PROTOCOL_PRESET_TEMPLATES.length, 17);
    for (const { protocol, role } of PROTOCOL_PRESET_TEMPLATES) {
        const preset = createProtocolPreset(protocol, role);
        assert.doesNotThrow(() => validatePreset(preset, createSimulationTask().settings), `${protocol}/${role}`);
        for (const port of describeProtocolPreset(preset).ports) assert.ok(Number.isInteger(port.width) && Number(port.width) > 0);
    }
});

test('protocol shape, widths, literals and clock precision reject invalid values before export', () => {
    const settings = createSimulationTask().settings;
    for (const change of [{ role: 'bogus' }, { signals: { data: 'injected' } }, { start: -1 }, { timeout: 0 },
        { options: { width: 10, period: 100 } }, { data: ["8'h1ff"] }, { data: ["4'hff"] }, { options: { width: 8, period: 0.001 } }]) {
        assert.throws(() => validatePreset({ ...createProtocolPreset('uart'), ...change } as ProtocolPreset, settings));
    }
    for (const protocol of ['apb', 'axis', 'axi4', 'axi4lite'] as const) {
        const preset = createProtocolPreset(protocol);
        const width = protocol === 'axi4lite' ? 64 : 16; preset.options.dataWidth = width;
        if (protocol.startsWith('axi4')) { preset.options.strobe = '3'; preset.transactions![0].data = ["16'h1234"]; }
        assert.doesNotThrow(() => validatePreset(preset, settings));
        assert.equal(describeProtocolPreset(preset).ports.find(p => p.name === (protocol === 'axis' ? 'm_axis_tdata' : protocol === 'apb' ? 'm_apb_pwdata' : 'm_axi_wdata'))?.width, width);
    }
});

function pair(a: ProtocolPreset, b: ProtocolPreset, duration = 5000): SimulationTaskDocument {
    const task = createSimulationTask('protocol.st'); task.settings.duration = duration; task.settings.waveform.enabled = false;
    task.instances = [{ id: 'sender', preset: a }, { id: 'receiver', preset: b }];
    const aPorts = describeProtocolPreset(a).ports, bPorts = describeProtocolPreset(b).ports;
    const sync = aPorts.some(p => p.name === 'clk') || bPorts.some(p => p.name === 'clk');
    if (sync) task.instances.push({ id: 'clock', preset: { kind: 'clock', frequencyMHz: 100, initial: 0 } });
    for (const port of aPorts) {
        if (port.name === 'clk') continue;
        const peer = bPorts.find(p => p.name.replace(/^[ms]_/, '') === port.name.replace(/^[ms]_/, ''));
        if (peer) task.connections = [...task.connections, { name: `bus_${port.name}`, endpoints: [
            { kind: 'instance', instance: 'sender', port: port.name }, { kind: 'instance', instance: 'receiver', port: peer.name } ] }];
    }
    if (sync) task.connections = [...task.connections, { name: 'clock_net', endpoints: [
        { kind: 'instance', instance: 'clock', port: 'clk' }, ...[['sender', aPorts], ['receiver', bPorts]].flatMap(([id, ports]) =>
            (ports as typeof aPorts).some(p => p.name === 'clk') ? [{ kind: 'instance' as const, instance: id as string, port: 'clk' }] : []) ] }];
    return task;
}

async function simulate(task: SimulationTaskDocument, success = true): Promise<string> {
    const text = generateTestbench(task, 'protocol_tb', []).text;
    assert.doesNotMatch(text, /VFST_|cases\[/);
    const root = await mkdtemp(path.join(os.tmpdir(), 'vf-protocol-'));
    try {
        const file = path.join(root, 'protocol_tb.v'); await writeFile(file, text);
        const result = await new IverilogWasmBackend().compileAndRun({ files: [file], runtimeFiles: [], includeDirs: [], defines: {}, plusargs: [], artifacts: [],
            output: path.join(root, 'protocol.out'), cwd: root, topModule: 'protocol_tb', timeoutMs: 30000 });
        assert.equal(result.success, success, `${result.stderr}\n${text}`);
        return result.stdout;
    } finally { await rm(root, { recursive: true, force: true }); }
}

for (const [protocol, sourceRole, receiverRole] of [ ['uart', 'tx', 'rx'], ['spi', 'controller', 'peripheral'], ['apb', 'initiator', 'responder'],
    ['axis', 'source', 'sink'], ['i2c', 'controller', 'target'], ['axi4', 'initiator', 'responder'], ['axi4lite', 'initiator', 'responder'],
    ['rgb888', 'source', 'monitor'] ] as const) {
    test(`${protocol} presets transfer and check actual transactions in Icarus WASM`, async () => {
        const sender = createProtocolPreset(protocol, sourceRole), receiver = createProtocolPreset(protocol, receiverRole);
        if (protocol === 'spi') { receiver.data = ["8'ha6"]; receiver.expected = sender.data; sender.expected = receiver.data; }
        if ('waitCycles' in receiver.options) receiver.options.waitCycles = 2;
        const stdout = await simulate(pair(sender, receiver));
        assert.match(stdout, /ST_PROTOCOL_CHECK\|.*\|1\|/);
        assert.doesNotMatch(stdout, /ST_PROTOCOL_TIMEOUT|ST_PROTOCOL_CHECK\|[^|\n]*\|[^|\n]*\|0\|/);
    });
}

test('receiver mismatches are visible and isolated to their preset instance', async () => {
    const sender = createProtocolPreset('uart'), receiver = createProtocolPreset('uart', 'rx'); receiver.expected = ["8'h56"];
    assert.match(await simulate(pair(sender, receiver), false), /ST_PROTOCOL_CHECK\|protocol_tb\.receiver[^\n]*\|0\|/);
});

test('incomplete payloads remain editable while generation rejects them', () => {
    const sender = createProtocolPreset('axis'), receiver = createProtocolPreset('axis', 'sink'); sender.data = [];
    assert.deepEqual(validateProtocolPreset(sender), []);
    assert.throws(() => generateTestbench(pair(sender, receiver), 'protocol_tb', []), /Provide transmitted data/);
    sender.data = [3 as unknown as string]; assert.notDeepEqual(validateProtocolPreset(sender), []);
    sender.data = ["8'h55"]; sender.start = 0.000001;
    assert.deepEqual(validateProtocolPreset(sender), []);
    assert.notDeepEqual(validateProtocolPreset(sender, 0.001), []);
});

for (const protocol of ['apb', 'i2c', 'axi4', 'axi4lite'] as const) {
    test(`${protocol} read transfer checks data and wait states in WASM`, async () => {
        const sender = createProtocolPreset(protocol), receiver = createProtocolPreset(protocol, protocol === 'i2c' ? 'target' : 'responder');
        if (protocol === 'i2c') {
            sender.options.write = receiver.options.write = false;
            sender.expected = sender.data; receiver.data = receiver.expected!; delete receiver.expected; sender.data = [];
        } else {
            sender.transactions = [{ operation: 'read', address: '32', data: [], expected: ['85'] }];
            receiver.transactions = [{ operation: 'read', address: '32', data: ['85'] }];
        }
        if (protocol === 'i2c') receiver.options.stretchCycles = 2;
        else receiver.options.waitCycles = 2;
        const stdout = await simulate(pair(sender, receiver));
        assert.match(stdout, /ST_PROTOCOL_CHECK\|protocol_tb\.sender[^\n]*\|1\|/);
        assert.doesNotMatch(stdout, /ST_PROTOCOL_TIMEOUT/);
    });
}

for (const [width, parity, stopBits] of [[5, 'even', 2], [9, 'odd', 1]] as const) {
    test(`UART ${width}-bit ${parity} parity frames`, async () => {
        const sender = createProtocolPreset('uart'), receiver = createProtocolPreset('uart', 'rx');
        for (const preset of [sender, receiver]) Object.assign(preset.options, { width, parity, stopBits });
        sender.data = [width === 5 ? "5'h15" : "9'h155"]; receiver.expected = sender.data;
        assert.match(await simulate(pair(sender, receiver)), /ST_PROTOCOL_CHECK\|[^|]*\|transaction\[0\]\|1\|/);
    });
}

for (const [cpol, cpha, width] of [[0, 1, 1], [1, 0, 16], [1, 1, 32]] as const) {
    test(`SPI mode ${cpol}/${cpha}, ${width}-bit full duplex`, async () => {
        const sender = createProtocolPreset('spi'), receiver = createProtocolPreset('spi', 'peripheral');
        for (const preset of [sender, receiver]) Object.assign(preset.options, { cpol, cpha, width });
        sender.data = [`${width}'h1`]; receiver.data = [`${width}'h0`]; sender.expected = receiver.data; receiver.expected = sender.data;
        assert.match(await simulate(pair(sender, receiver)), /ST_PROTOCOL_CHECK\|[^|]*\|transaction\[0\]\|1\|/);
    });
}

test('AXI-Stream passive monitor samples actual handshakes alongside sink', async () => {
    const sender = createProtocolPreset('axis'), receiver = createProtocolPreset('axis', 'sink'), monitor = createProtocolPreset('axis', 'monitor');
    sender.data = ["32'h1", "32'h2", "32'h3"]; receiver.expected = monitor.expected = sender.data; receiver.options.waitCycles = 3;
    const task = pair(sender, receiver); task.instances.push({ id: 'monitor', preset: monitor });
    task.connections = task.connections.map(connection => ({ ...connection, endpoints: [...connection.endpoints,
        { kind: 'instance', instance: 'monitor', port: connection.name === 'clock_net' ? 'clk' : connection.name!.slice(4).replace(/^m_/, 's_') }] }));
    const stdout = await simulate(task);
    assert.equal(stdout.split('\n').filter(line => line.startsWith('ST_PROTOCOL_CHECK|protocol_tb.monitor')).length, 3);
});

test('I2C repeated START with stretching and AXI4 burst transfers', async () => {
    const controller = createProtocolPreset('i2c'), target = createProtocolPreset('i2c', 'target');
    controller.options.repeatedStart = target.options.repeatedStart = true;
    controller.data = ["8'h10"]; controller.expected = ["8'hab", "8'hcd"];
    target.expected = controller.data; target.data = controller.expected; target.options.stretchCycles = 1;
    assert.match(await simulate(pair(controller, target)), /ST_PROTOCOL_CHECK\|.*\|1\|/);
    const initiator = createProtocolPreset('axi4'), responder = createProtocolPreset('axi4', 'responder');
    initiator.options.dataWidth = responder.options.dataWidth = 64;
    initiator.options.strobe = responder.options.strobe = '255';
    initiator.options.idWidth = responder.options.idWidth = 8;
    initiator.options.id = responder.options.id = "8'ha5";
    initiator.transactions![0].data = ["64'h123456789abcdef0", "64'hfedcba9876543210"];
    responder.transactions![0].expected = initiator.transactions![0].data; responder.options.waitCycles = 2;
    assert.match(await simulate(pair(initiator, responder)), /ST_PROTOCOL_CHECK\|.*\|transaction\[1\]\|1\|/);
});

test('RGB888 pixel geometry is sampled from the connected canvas clock', async () => {
    const sender = createProtocolPreset('rgb888'), receiver = createProtocolPreset('rgb888', 'monitor');
    for (const preset of [sender, receiver]) Object.assign(preset.options, { hActive: 2, hTotal: 5, hSyncStart: 3, hSyncEnd: 4,
        vActive: 2, vTotal: 5, vSyncStart: 3, vSyncEnd: 4, pattern: 'pixels', frames: 2, hsyncPolarity: 0, vsyncPolarity: 0 });
    sender.data = ["24'hff0000", "24'h00ff00", "24'h0000ff", "24'habcdef"]; receiver.expected = sender.data;
    const task = pair(sender, receiver); const clock = task.instances.find(instance => instance.id === 'clock')!;
    if ('preset' in clock && clock.preset.kind === 'clock') clock.preset.frequencyMHz = 25;
    const stdout = await simulate(task);
    assert.equal(stdout.split('\n').filter(line => line.startsWith('ST_PROTOCOL_CHECK')).length, 10);
});

test('duplicate preset modules remain independent and timeout fails the backend run', async () => {
    const first = pair(createProtocolPreset('uart'), createProtocolPreset('uart', 'rx'));
    const sender = createProtocolPreset('uart'), receiver = createProtocolPreset('uart', 'rx');
    sender.start = receiver.start = 2000; sender.data = receiver.expected = ["8'h9a"];
    const second = pair(sender, receiver);
    first.instances.push(...second.instances.map(instance => ({ ...instance, id: `other_${instance.id}` })));
    first.connections = [...first.connections, ...second.connections.map(connection => ({ ...connection, name: `other_${connection.name}`, endpoints: connection.endpoints.map(endpoint =>
        endpoint.kind === 'instance' ? { ...endpoint, instance: `other_${endpoint.instance}` } : endpoint) }))];
    assert.equal((await simulate(first)).split('\n').filter(line => line.startsWith('ST_PROTOCOL_CHECK')).length, 2);
    receiver.start = 0; receiver.timeout = 20; sender.start = 100;
    assert.match(await simulate(pair(sender, receiver), false), /ST_PROTOCOL_TIMEOUT/);
});

test('bus presets expose standard AD-recognized interfaces with the correct directions', () => {
    const catalog = createInterfaceProtocolCatalog();
    for (const protocol of ['apb', 'axis', 'axi4', 'axi4lite'] as const) {
        for (const role of protocol === 'axis' ? ['source', 'sink', 'monitor'] : ['initiator', 'responder']) {
            const ports = describeProtocolPreset(createProtocolPreset(protocol, role)).ports;
            const result = recognizeModuleInterfaces(ports.map(port => ({ ...port, width: { kind: 'known', bits: Number(port.width) } })), catalog);
            assert.equal(result.interfaces.length, 1, `${protocol}/${role} must form one bus`);
            const bus = result.interfaces[0];
            const master = role === 'source' || role === 'initiator';
            const family = protocol.startsWith('axi4') ? 'axi' : protocol;
            assert.equal(bus.key, `${master ? 'm' : 's'}_${family}`);
            assert.equal(bus.protocol, `amba.${protocol === 'axi4lite' ? 'axi4' : protocol}`);
            assert.equal(bus.role, master ? 'master' : 'slave');
            assert.equal(bus.members.length, ports.length - 1);
            for (const member of bus.members) assert.equal(member.portDirection, role === 'monitor' ? 'input'
                : (member.direction === 'master-to-slave') === master ? 'output' : 'input');
            assert.deepEqual(result.diagnostics, []);
        }
    }
});

for (const [protocol, role, option, pin] of [['axis', 'sink', 'includeLast', 'axis_tlast'], ['apb', 'responder', 'includeError', 'apb_pslverr']] as const) {
    test(`${protocol} optional ${pin} pin can be omitted in an actual transfer`, async () => {
        const sender = createProtocolPreset(protocol), receiver = createProtocolPreset(protocol, role);
        for (const preset of [sender, receiver]) {
            assert.ok(describeProtocolPreset(preset).ports.some(port => port.name.endsWith(pin)));
            preset.options[option] = false;
            assert.ok(!describeProtocolPreset(preset).ports.some(port => port.name.endsWith(pin)));
            assert.deepEqual(validateProtocolPreset(preset), []);
        }
        const stdout = await simulate(pair(sender, receiver));
        assert.match(stdout, /ST_PROTOCOL_CHECK\|.*\|1\|/);
        sender.options[option] = 'false' as unknown as boolean;
        assert.match(validateProtocolPreset(sender).join('\n'), /must be a boolean/);
    });
}

for (const protocol of ['apb', 'axis', 'axi4', 'axi4lite'] as const) {
    test(`${protocol} grouped canvas interface connections generate and simulate standard HDL pins`, async () => {
        const sender = createProtocolPreset(protocol), receiver = createProtocolPreset(protocol, protocol === 'axis' ? 'sink' : 'responder');
        const task = pair(sender, receiver);
        task.connections = task.connections.filter(connection => connection.name === 'clock_net');
        const family = protocol.startsWith('axi4') ? 'axi' : protocol;
        task.interfaceConnections = [{ name: 'bus', master: { kind: 'instance', instance: 'sender', interface: `m_${family}` },
            slave: { kind: 'instance', instance: 'receiver', interface: `s_${family}` } }];
        const stdout = await simulate(task);
        assert.match(stdout, /ST_PROTOCOL_CHECK\|protocol_tb\.receiver[^\n]*\|1\|/);
        assert.doesNotMatch(stdout, /ST_PROTOCOL_TIMEOUT/);
    });

    test(`${protocol} old scalar pin references still simulate without modifying the saved document`, async () => {
        const task = pair(createProtocolPreset(protocol), createProtocolPreset(protocol, protocol === 'axis' ? 'sink' : 'responder'));
        const legacyName = (name: string) => {
            const member = name.replace(/^[ms]_(apb|axis|axi)_/, '');
            return ({ psel: 'select', penable: 'enable', paddr: 'address', pwrite: 'write', pwdata: 'wdata', prdata: 'rdata',
                pready: 'ready', pslverr: 'error', tdata: 'data', tvalid: 'valid', tready: 'ready', tlast: 'last' } as Record<string, string>)[member] ?? member;
        };
        task.connections = task.connections.map(connection => ({ ...connection,
            endpoints: connection.endpoints.map(endpoint => ({ ...endpoint, port: legacyName(endpoint.port) })) }));
        const saved = JSON.stringify(task);
        assert.match(await simulate(task), /ST_PROTOCOL_CHECK\|protocol_tb\.receiver[^\n]*\|1\|/);
        assert.equal(JSON.stringify(task), saved);
    });
}

test('task duration rejects pending protocols even before their start or local timeout', async () => {
    const sender = createProtocolPreset('uart'), receiver = createProtocolPreset('uart', 'rx');
    sender.start = 200;
    assert.match(await simulate(pair(sender, receiver, 100), false), /ST_PROTOCOL_INCOMPLETE\|sender/);
    sender.start = 0;
    assert.match(await simulate(pair(sender, receiver, 500), false), /ST_PROTOCOL_INCOMPLETE/);
    assert.match(await simulate(pair(sender, receiver, 2000)), /ST_PROTOCOL_CHECK\|.*\|1\|/);
});

test('task duration checks every independent protocol instance', async () => {
    const task = pair(createProtocolPreset('uart'), createProtocolPreset('uart', 'rx'), 2000);
    const late = createProtocolPreset('uart'); late.start = 2500;
    task.instances.push({ id: 'late_sender', preset: late });
    const stdout = await simulate(task, false);
    assert.match(stdout, /ST_PROTOCOL_CHECK\|.*\|1\|/);
    assert.match(stdout, /ST_PROTOCOL_INCOMPLETE\|late_sender/);
});

test('protocol completion exactly at task duration is accepted deterministically', async () => {
    const task = pair(createProtocolPreset('uart'), createProtocolPreset('uart', 'rx'), 1100);
    assert.match(await simulate(task), /ST_PROTOCOL_CHECK\|.*\|1\|/);
});

test('bare x and z payloads compile as sized literals for all protocol roles in WASM', async () => {
    const modules: string[] = [], instances: string[] = [];
    for (const { protocol, role } of PROTOCOL_PRESET_TEMPLATES) for (const value of ['x', 'z']) {
        const preset = createProtocolPreset(protocol, role); preset.start = 10;
        if (protocol === 'rgb888') Object.assign(preset.options, { pattern: 'pixels', hActive: 1, vActive: 1 });
        const fields = protocolPresetPayloadFields(preset);
        if (preset.transactions) {
            if (role === 'initiator') preset.transactions[0].data = [value];
            else preset.transactions[0].expected = [value];
        } else {
            if (fields.data) preset.data = [value];
            if (fields.expected) preset.expected = [value];
        }
        const name = `preset_${protocol}_${role}_${value}`;
        modules.push(renderProtocolPreset(preset, name, 0.001));
        instances.push(`${name} ${name}_inst();`);
    }
    const root = await mkdtemp(path.join(os.tmpdir(), 'vf-four-state-'));
    try {
        const file = path.join(root, 'four_state_tb.v');
        await writeFile(file, `\`timescale 1ns/1ps\nmodule four_state_tb;\n${instances.join('\n')}\ninitial #1 $finish;\nendmodule\n${modules.join('\n')}`);
        const result = await new IverilogWasmBackend().compileAndRun({ files: [file], runtimeFiles: [], includeDirs: [], defines: {}, plusargs: [], artifacts: [],
            output: path.join(root, 'four_state.out'), cwd: root, topModule: 'four_state_tb', timeoutMs: 30000 });
        assert.equal(result.success, true, result.stderr);
    } finally { await rm(root, { recursive: true, force: true }); }
});

test('legacy scalar bus documents and porch timing still simulate without migration', async () => {
    for (const protocol of ['apb', 'axi4lite', 'axi4'] as const) {
        const sender = createProtocolPreset(protocol), receiver = createProtocolPreset(protocol, 'responder');
        for (const preset of [sender, receiver]) {
            delete preset.transactions;
            Object.assign(preset.options, { address: '16', write: true });
        }
        sender.data = protocol === 'apb' ? ['85', '166'] : ['85']; receiver.expected = sender.data;
        assert.match(await simulate(pair(sender, receiver)), /ST_PROTOCOL_CHECK\|.*\|1\|/);
    }
    const sender = createProtocolPreset('rgb888'), receiver = createProtocolPreset('rgb888', 'monitor');
    for (const preset of [sender, receiver]) {
        for (const key of ['hTotal', 'hSyncStart', 'hSyncEnd', 'vTotal', 'vSyncStart', 'vSyncEnd'] as const) delete preset.options[key];
        Object.assign(preset.options, { hFrontPorch: 1, hSync: 1, hBackPorch: 1, vFrontPorch: 1, vSync: 1, vBackPorch: 1 });
    }
    assert.match(await simulate(pair(sender, receiver)), /ST_PROTOCOL_CHECK\|.*\|1\|/);
});
