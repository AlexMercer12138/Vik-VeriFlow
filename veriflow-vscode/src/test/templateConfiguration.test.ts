import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { hdlTemplates } from '@veriflow/flow-core';
import { resolveHdlTemplates } from '../testbench/templateConfiguration';

test('default configuration retains built-in order and placeholder bodies without mutating built-ins', () => {
    const before = JSON.stringify(hdlTemplates);
    for (const value of [undefined, {}]) {
        const result = resolveHdlTemplates(value);
        assert.deepEqual(result.templates.map(template => template.id), [
            'clock', 'reset', 'timeout', 'waveform', 'initial', 'wait-cycles',
            'finish', 'timescale', 'combinational', 'sequential',
        ]);
        assert.equal(result.templates[0].body, "reg {{1:clk}} = 1'b0;\nalways #({{2:5}}) {{1}} = ~{{1}};\n");
        assert.deepEqual(result.templates[0].languages, ['verilog', 'systemverilog']);
        assert.deepEqual(result.issues, []);
    }
    resolveHdlTemplates({ clock: { label: 'Changed', body: 'changed' } });
    assert.equal(JSON.stringify(hdlTemplates), before);
});

test('overrides merge fields, new templates sort after built-ins, and removing overrides restores defaults', () => {
    const result = resolveHdlTemplates({
        zebra: { body: '$finish;' },
        clock: { body: ['always #5 clk = ~clk;', '{{0}}'] },
        alpha: { label: 'Alpha', description: 'SV only', body: '', languages: ['systemverilog'] },
    });
    assert.equal(result.templates[0].id, 'clock');
    assert.equal(result.templates[0].label, 'Clock');
    assert.equal(result.templates[0].description, 'Module scope; half period in the current timescale');
    assert.equal(result.templates[0].body, 'always #5 clk = ~clk;\n{{0}}');
    assert.deepEqual(result.templates.slice(-2), [
        { id: 'alpha', label: 'Alpha', description: 'SV only', body: '', languages: ['systemverilog'] },
        { id: 'zebra', label: 'zebra', description: '', body: '$finish;', languages: ['verilog', 'systemverilog'] },
    ]);
    assert.match(resolveHdlTemplates({}).templates[0].body, /\{\{1:clk\}\}/);
    assert.deepEqual(result.issues, []);
});

test('explicit disabling wins over malformed fields and templates can be re-enabled', () => {
    const result = resolveHdlTemplates({
        timeout: { enabled: false, body: 123, languages: [] },
        disabled: { enabled: false },
        clock: { enabled: true, label: 'My Clock' },
    });
    assert.equal(result.templates.some(template => template.id === 'timeout'), false);
    assert.equal(result.templates.some(template => template.id === 'disabled'), false);
    assert.equal(result.templates[0].label, 'My Clock');
    assert.deepEqual(result.issues, []);
    assert.equal(resolveHdlTemplates({ timeout: { enabled: true } }).templates.some(template => template.id === 'timeout'), true);
});

test('malformed entries are isolated with precise paths and invalid built-in overrides fall back', () => {
    const result = resolveHdlTemplates({
        clock: { label: 'Not applied', body: ['ok', 123] },
        good: { body: [] },
        missing: { label: 'Missing body' },
        'bad.id': { body: 'invalid' },
        nullItem: null,
        badFields: { body: 'ok', label: 1, description: false, enabled: 'false', languages: ['vhdl'], typo: true },
    });
    assert.equal(result.templates[0].label, 'Clock');
    assert.match(result.templates[0].body, /\{\{1:clk\}\}/);
    assert.deepEqual(result.templates.slice(hdlTemplates.length).map(template => [template.id, template.body]), [['good', '']]);
    assert.deepEqual(result.issues.map(issue => issue.path).sort(), [
        'veriflow.hdlTemplates.clock.body', 'veriflow.hdlTemplates.missing.body',
        'veriflow.hdlTemplates.bad.id', 'veriflow.hdlTemplates.nullItem',
        'veriflow.hdlTemplates.badFields.label', 'veriflow.hdlTemplates.badFields.description',
        'veriflow.hdlTemplates.badFields.enabled', 'veriflow.hdlTemplates.badFields.languages',
        'veriflow.hdlTemplates.badFields.typo',
    ].sort());
    assert.ok(result.issues.every(issue => issue.message.length > 0));
});

test('invalid root values, IDs, and duplicate or empty language lists are rejected', () => {
    for (const value of [null, [], 'text', 1]) {
        const result = resolveHdlTemplates(value);
        assert.equal(result.templates.length, hdlTemplates.length);
        assert.equal(result.issues[0].path, 'veriflow.hdlTemplates');
    }
    for (const id of ['', '1invalid', 'has space', 'has/slash']) {
        assert.equal(resolveHdlTemplates({ [id]: { body: '' } }).issues[0].path, `veriflow.hdlTemplates.${id}`);
    }
    for (const languages of [[], ['verilog', 'verilog'], ['verilog', 'vhdl'], 'verilog']) {
        const result = resolveHdlTemplates({ custom: { body: '', languages } });
        assert.equal(result.templates.some(template => template.id === 'custom'), false);
        assert.equal(result.issues[0].path, 'veriflow.hdlTemplates.custom.languages');
    }
});
