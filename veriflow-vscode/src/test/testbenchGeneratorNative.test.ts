import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { TestbenchGenerator, TbConfig } from '../core/testbenchGenerator';
const base: TbConfig = { name: 'tb_top', time_unit: '1ns', time_precision: '1ps', clocks_mhz: ['100'], reset_active_high: false, reset_duration: '100', modules: [], wave_file: 'waves.vcd', timeout: '1000' };
test('clock period follows physical frequency across timescales', () => {
 for (const [unit, delay] of [['1ns','5'], ['1ps','5000'], ['1us','0.005']]) {
  assert.ok(new TestbenchGenerator().render({...base, time_unit: unit}).includes(`always #(${delay})`));
 }
 assert.throws(() => new TestbenchGenerator().render({...base,time_precision:'10ns'}), /precision|represent/);
});
test('parameter widths retain expressions and independent DUT signals', () => {
 const mod = {definitionKey:'dut',module_name:'dut',instance_name:'u0',parameters:[{name:'W',value:'8'},{name:'D',value:'W * 2'}],ports:[{name:'data',direction:'input' as const,width:'[$clog2(D)-1:0]'}],param_values:{},port_signals:{}};
 const text = new TestbenchGenerator().render({...base,modules:[mod,{...mod,instance_name:'u1'}]});
 assert.ok(text.includes('$clog2((8) * 2)-1:0') || text.includes('$clog2(((8) * 2))-1:0'));
 assert.ok(text.includes('dut_0_data'));
 assert.ok(text.includes('dut_1_data'));
 assert.ok(!text.includes('[0:0]'));
});
test('waveform filenames escape HDL string literals', () => {
 assert.ok(new TestbenchGenerator().render({...base,wave_file:'a"b\\c.vcd'}).includes('$dumpfile("a\\"b\\\\c.vcd")'));
});
