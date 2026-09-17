import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { IverilogWasmBackend } from '@veriflow/simulator-iverilog-wasm';
import { createProtocolPreset, describeProtocolPreset, renderProtocolPreset, validateProtocolPreset, type ProtocolPreset } from '../src/simulationTask';

type Row = { operation: 'write' | 'read'; address: string; data: string[]; expected?: string[] };
function schedule(preset: ProtocolPreset, rows: Row[]): ProtocolPreset {
    return Object.assign(preset, { transactions: rows, data: [] });
}

async function referenceSimulation(preset: ProtocolPreset, reference: string, success = true): Promise<string> {
    const ports = describeProtocolPreset(preset).ports;
    const localName = (name: string) => {
        const member = name.replace(/^[ms]_(apb|axi)_/, '');
        return ({ psel: 'select', penable: 'enable', paddr: 'address', pwrite: 'write', pwdata: 'wdata',
            prdata: 'rdata', pready: 'ready', pslverr: 'error' } as Record<string, string>)[member] ?? member;
    };
    const declarations = ports.map(port => port.name === 'clk' ? "reg clk = 0; always #5 clk = ~clk;"
        : `${port.direction === 'output' ? 'wire' : 'reg'} ${Number(port.width) > 1 ? `[${Number(port.width) - 1}:0] ` : ''}${localName(port.name)}${port.direction === 'output' ? '' : ' = 0'};`);
    const text = `\`timescale 1ns/1ps\nmodule reference_tb;\n${declarations.join('\n')}\n` +
        `preset dut(${ports.map(port => `.${port.name}(${localName(port.name)})`).join(',')});\n` +
        `${reference}\ninitial #10000 $fatal(1, "Reference timeout");\nendmodule\n${renderProtocolPreset(preset, 'preset', 0.001)}`;
    const root = await mkdtemp(path.join(os.tmpdir(), 'vf-reference-'));
    try {
        const file = path.join(root, 'reference_tb.v'); await writeFile(file, text);
        const result = await new IverilogWasmBackend().compileAndRun({ files: [file], runtimeFiles: [], includeDirs: [], defines: {}, plusargs: [], artifacts: [],
            output: path.join(root, 'reference.out'), cwd: root, topModule: 'reference_tb', timeoutMs: 30000 });
        assert.equal(result.success, success, `${result.stderr}\n${result.stdout}\n${text}`);
        return result.stdout;
    } finally { await rm(root, { recursive: true, force: true }); }
}

const requests = [['write', '16', '85'], ['read', '32', '166'], ['write', '48', '119'], ['read', '16', '85']] as const;
for (const protocol of ['apb', 'axi4lite', 'axi4'] as const) for (const role of ['initiator', 'responder'] as const) {
    test(`${protocol} ${role} follows mixed operations and addresses against independent reference`, async () => {
        const preset = createProtocolPreset(protocol, role);
        schedule(preset, requests.map(([operation, address, value]) => ({ operation, address,
            data: (role === 'initiator') === (operation === 'write') ? [value] : [],
            ...((role === 'initiator') === (operation === 'write') ? {} : { expected: [value] }) })));
        let reference: string;
        if (protocol === 'apb') {
            reference = role === 'initiator' ? `
task transfer;
 input op; input [31:0] addr; input [31:0] value;
 begin
  @(posedge clk); while (!(select === 1'b1 && enable === 1'b0)) @(posedge clk);
  if (write !== op || address !== addr) $fatal(1, "APB request mismatch");
  @(negedge clk); rdata <= value;
  repeat (2) @(negedge clk); ready <= 1;
  @(posedge clk); if (op && wdata !== value) $fatal(1, "APB write mismatch");
  @(negedge clk); ready <= 0;
 end
endtask` : `
task transfer;
 input op; input [31:0] addr; input [31:0] value;
 begin
  @(negedge clk); select <= 1; enable <= 0; write <= op; address <= addr; wdata <= value;
  @(negedge clk); enable <= 1;
  @(posedge clk); while (ready !== 1'b1) @(posedge clk);
  if (!op && rdata !== value) $fatal(1, "APB read mismatch");
  @(negedge clk); select <= 0; enable <= 0;
 end
endtask`;
        } else {
            const full = protocol === 'axi4';
            reference = role === 'initiator' ? `
task transfer;
 input op; input [31:0] addr; input [31:0] value;
 begin
  if (op) begin
   @(negedge clk); awready <= 1;
   @(posedge clk); while (awvalid !== 1'b1) @(posedge clk);
   if (awaddr !== addr ${full ? '|| awlen !== 0 || awsize !== 2 || awburst !== 1 || awid !== 0' : ''}) $fatal(1, "AXI write address mismatch");
   @(negedge clk); awready <= 0; wready <= 1;
   @(posedge clk); while (wvalid !== 1'b1) @(posedge clk);
   if (wdata !== value || wstrb !== 15 ${full ? '|| wlast !== 1' : ''}) $fatal(1, "AXI write data mismatch");
   @(negedge clk); wready <= 0; bvalid <= 1;
   @(posedge clk); while (bready !== 1'b1) @(posedge clk);
   @(negedge clk); bvalid <= 0;
  end else begin
   @(negedge clk); arready <= 1;
   @(posedge clk); while (arvalid !== 1'b1) @(posedge clk);
   if (araddr !== addr ${full ? '|| arlen !== 0 || arsize !== 2 || arburst !== 1 || arid !== 0' : ''}) $fatal(1, "AXI read address mismatch");
   @(negedge clk); arready <= 0; rdata <= value; rvalid <= 1; ${full ? 'rlast <= 1;' : ''}
   @(posedge clk); while (rready !== 1'b1) @(posedge clk);
   @(negedge clk); rvalid <= 0;
  end
 end
endtask` : `
task transfer;
 input op; input [31:0] addr; input [31:0] value;
 begin
  if (op) begin
   @(negedge clk); awaddr <= addr; awvalid <= 1; ${full ? 'awsize <= 2; awburst <= 1;' : ''}
   @(posedge clk); while (awready !== 1'b1) @(posedge clk);
   @(negedge clk); awvalid <= 0; wdata <= value; wstrb <= 15; wvalid <= 1; ${full ? 'wlast <= 1;' : ''}
   @(posedge clk); while (wready !== 1'b1) @(posedge clk);
   @(negedge clk); wvalid <= 0; bready <= 1;
   @(posedge clk); while (bvalid !== 1'b1) @(posedge clk);
   if (bresp !== 0 ${full ? '|| bid !== 0' : ''}) $fatal(1, "AXI response mismatch");
   @(negedge clk); bready <= 0;
  end else begin
   @(negedge clk); araddr <= addr; arvalid <= 1; ${full ? 'arsize <= 2; arburst <= 1;' : ''}
   @(posedge clk); while (arready !== 1'b1) @(posedge clk);
   @(negedge clk); arvalid <= 0; rready <= 1;
   @(posedge clk); while (rvalid !== 1'b1) @(posedge clk);
   if (rdata !== value || rresp !== 0 ${full ? '|| rlast !== 1 || rid !== 0' : ''}) $fatal(1, "AXI read mismatch");
   @(negedge clk); rready <= 0;
  end
 end
endtask`;
        }
        reference += `\ninitial begin\n${requests.map(([op, addr, value]) => `transfer(1'b${op === 'write' ? 1 : 0}, ${addr}, ${value});`).join('\n')}\n#1; if (!dut.vf_completed) $fatal(1, "Incomplete schedule"); $display("REFERENCE_PASS"); $finish; end`;
        assert.match(await referenceSimulation(preset, reference), /REFERENCE_PASS/);
        if (role === 'responder') {
            // The independently driven first request still uses address 16.
            preset.transactions![0].address = '64';
            assert.match(await referenceSimulation(preset, reference, false), /Protocol expectation failed/);
        }
    });
}

test('transaction drafts save safely but generation requires complete single-beat APB/Lite rows', () => {
    for (const protocol of ['apb', 'axi4lite', 'axi4'] as const) {
        const preset = schedule(createProtocolPreset(protocol), [{ operation: 'write', address: '', data: [] }]);
        assert.deepEqual(validateProtocolPreset(preset), []);
        assert.throws(() => renderProtocolPreset(preset, 'preset', 0.001), /address|data|transaction/i);
        schedule(preset, []); assert.deepEqual(validateProtocolPreset(preset), []);
        assert.throws(() => renderProtocolPreset(preset, 'preset', 0.001), /transaction/i);
        schedule(preset, [{ operation: 'write', address: '0', data: ['1', '2'] }]);
        if (protocol !== 'axi4') assert.throws(() => renderProtocolPreset(preset, 'preset', 0.001), /single|one|beat/i);
    }
});

test('transaction shape and all address/data widths reject truncation and unsupported fields', () => {
    assert.deepEqual(validateProtocolPreset(schedule(createProtocolPreset('apb'), [{ operation: 'write', address: '0', data: ['1'] }])), []);
    for (const row of [{ operation: 'bogus', address: '0', data: ['1'] }, { operation: 'write', address: "4'hff", data: ['1'] },
        { operation: 'write', address: '0', data: ["4'hff"] }, { operation: 'write', address: '0', data: ['1'], injected: true }]) {
        const preset = Object.assign(createProtocolPreset('apb'), { transactions: [row] });
        assert.notDeepEqual(validateProtocolPreset(preset), []);
    }
});

test('empty unused row payload and stale legacy payload do not block generation', () => {
    const apb = schedule(createProtocolPreset('apb'), [{ operation: 'write', address: '0', data: ['1'], expected: [] }]);
    assert.doesNotThrow(() => renderProtocolPreset(apb, 'preset', 0.001));
    const legacy = createProtocolPreset('axi4lite'); delete legacy.transactions;
    Object.assign(legacy, { data: ['1'], expected: ['2'] });
    Object.assign(legacy.options, { write: true, address: '0' });
    assert.doesNotThrow(() => renderProtocolPreset(legacy, 'preset', 0.001));
});

test('address, ID and byte-strobe literals cannot truncate during bus generation', () => {
    for (const [key, value] of [['address', "4'hff"], ['id', "2'h7"], ['strobe', "4'h1f"]] as const) {
        const preset = createProtocolPreset('axi4');
        if (key === 'address') preset.transactions![0].address = value;
        else preset.options[key] = value;
        assert.notDeepEqual(validateProtocolPreset(preset), []);
        assert.throws(() => renderProtocolPreset(preset, 'preset', 0.001), /fit|truncat/i);
    }
});

test('RGB source independently produces explicit total/active/sync boundaries for two frames', async () => {
    const preset = createProtocolPreset('rgb888');
    Object.assign(preset.options, { hTotal: 13, hActive: 3, hSyncStart: 7, hSyncEnd: 10, vTotal: 7, vActive: 2, vSyncStart: 4, vSyncEnd: 6, frames: 2, hsyncPolarity: 0, vsyncPolarity: 1 });
    const stdout = await referenceSimulation(preset, `
integer sample = 0; integer x; integer y; integer active_count = 0; integer hs_count = 0; integer vs_count = 0;
always @(posedge pclk) begin
 x = sample % 13; y = (sample / 13) % 7;
 if (de !== ((x < 3) && (y < 2))) $fatal(1, "DE geometry mismatch");
 if (hsync !== !((x >= 7) && (x < 10))) $fatal(1, "HSYNC geometry mismatch");
 if (vsync !== ((y >= 4) && (y < 6))) $fatal(1, "VSYNC geometry mismatch");
 if (de) active_count = active_count + 1;
 if (!hsync) hs_count = hs_count + 1;
 if (vsync) vs_count = vs_count + 1;
 sample = sample + 1;
end
initial begin
 wait (dut.vf_completed); #1;
 if (sample !== 182 || active_count !== 12 || hs_count !== 42 || vs_count !== 52) $fatal(1, "RGB frame counts mismatch");
 $display("RGB_REFERENCE_PASS"); $finish;
end`);
    assert.match(stdout, /RGB_REFERENCE_PASS/);
});

test('RGB timing geometry can be edited temporarily but must be valid before generation', () => {
    for (const geometry of [{ hTotal: 8 }, { hSyncStart: 7 }, { hSyncEnd: 9 }, { vSyncEnd: 5 }]) {
        const preset = createProtocolPreset('rgb888'); Object.assign(preset.options, geometry);
        assert.deepEqual(validateProtocolPreset(preset), []);
        assert.throws(() => renderProtocolPreset(preset, 'preset', 0.001), /timing|Sync|Total|Active/);
    }
});

test('RGB monitor checks an independently generated custom timing raster', async () => {
    const preset = createProtocolPreset('rgb888', 'monitor');
    Object.assign(preset.options, { hTotal: 7, hActive: 1, hSyncStart: 3, hSyncEnd: 5,
        vTotal: 6, vActive: 1, vSyncStart: 2, vSyncEnd: 5, hsyncPolarity: 0, vsyncPolarity: 0 });
    const stdout = await referenceSimulation(preset, `
integer x; integer y;
initial begin
 for (y = 0; y < 6; y = y + 1) begin
  for (x = 0; x < 7; x = x + 1) begin
   #5; pclk <= 0;
   hsync <= !((x >= 3) && (x < 5)); vsync <= !((y >= 2) && (y < 5));
   de <= ((x == 0) && (y == 0));
   r <= ((x == 0) && (y == 0)) ? 255 : 0;
   g <= ((x == 0) && (y == 0)) ? 255 : 0;
   b <= ((x == 0) && (y == 0)) ? 255 : 0;
   #5; pclk <= 1;
  end
 end
 #1; if (!dut.vf_completed) $fatal(1, "Monitor incomplete");
 $display("MONITOR_REFERENCE_PASS"); $finish;
end`);
    assert.match(stdout, /MONITOR_REFERENCE_PASS/);
});
