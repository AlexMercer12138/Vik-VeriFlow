import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { hdlTemplates, renderHdlTemplate } from '../src/hdlTemplates';

test('HDL snippets preserve simulator system tasks as literal text', () => {
    const wave = renderHdlTemplate('waveform');
    assert.ok(wave.includes('$dumpfile("waves.vcd")'));
    assert.ok(wave.includes('$dumpvars(0, tb_top)'));
    assert.ok(renderHdlTemplate('timeout').includes('$finish'));
});
test('templates include general HDL constructs and no position-dependent edits', () => {
    assert.ok(hdlTemplates.some(item => item.id === 'combinational'));
    assert.ok(renderHdlTemplate('clock').includes('always #(5) clk = ~clk'));
    assert.throws(() => renderHdlTemplate('missing'), /Unknown HDL template/);
});
