import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
    createEmptyArchDesign,
    exportArchDesignRtl,
    parseArchDesignValue,
    parseArchDesignRtlMarker,
    type ArchDesign,
    type ArchDesignModuleDefinition,
} from '../src/archDesign';
import { createInterfaceProtocolCatalog } from '../src/interfaces';

function designOf(overrides: Partial<ArchDesign>): ArchDesign {
    const parsed = parseArchDesignValue({
        ...createEmptyArchDesign('soc_top'),
        ...overrides,
    });
    if (parsed.status !== 'editable') throw new Error('expected editable design');
    return parsed.design;
}

function interfaceProtocol(defaultTag = '0'): Record<string, unknown> {
    return {
        format: 'veriflow-interface-protocol',
        schemaVersion: 1,
        id: 'project.link',
        name: 'Project Link',
        separator: '_',
        priority: 100,
        members: [
            { name: 'request', direction: 'master-to-slave' },
            { name: 'accept', direction: 'slave-to-master', default: "1'b0" },
            { name: 'tag', direction: 'master-to-slave', default: defaultTag },
        ],
        recognitionGroups: [['request', 'accept']],
    };
}

function interfaceCatalog(defaultTag = '0') {
    return createInterfaceProtocolCatalog([{
        source: '/workspace/link.json',
        value: interfaceProtocol(defaultTag),
    }]);
}

const interfaceMaster: ArchDesignModuleDefinition = {
    key: 'rtl/interface_master.v#interface_master',
    name: 'interface_master',
    parameters: [],
    ports: [
        { name: 'BUS_REQUEST', direction: 'output', width: { kind: 'known', bits: 32 } },
        { name: 'BUS_ACCEPT', direction: 'input', width: { kind: 'known', bits: 1 } },
        { name: 'BUS_TAG', direction: 'output', width: { kind: 'known', bits: 4 } },
    ],
};

const interfaceMasterWithoutTag: ArchDesignModuleDefinition = {
    ...interfaceMaster,
    key: 'rtl/interface_master_without_tag.v#interface_master_without_tag',
    name: 'interface_master_without_tag',
    ports: interfaceMaster.ports.slice(0, 2),
};

const interfaceSlave: ArchDesignModuleDefinition = {
    key: 'rtl/interface_slave.v#interface_slave',
    name: 'interface_slave',
    parameters: [],
    ports: [
        { name: 'LINK_REQUEST', direction: 'input', width: { kind: 'known', bits: 16 } },
        { name: 'LINK_ACCEPT', direction: 'output', width: { kind: 'known', bits: 1 } },
        { name: 'LINK_TAG', direction: 'input', width: { kind: 'known', bits: 4 } },
    ],
};

test('exports a deterministic empty Verilog module with an owned marker', () => {
    const result = exportArchDesignRtl(createEmptyArchDesign('soc_top'), [], {
        sourcePath: 'designs/soc_top.ad',
    });

    assert.equal(result.status, 'generated');
    if (result.status !== 'generated') return;
    assert.equal(result.language, 'verilog');
    assert.equal(result.extension, '.v');
    assert.match(result.fingerprint, /^ad-v1-[0-9a-f]{16}$/);
    assert.equal(result.marker,
        `// vik-veriflow:generated arch-design schema=2 fingerprint=${result.fingerprint} language=verilog`);
    assert.equal(result.text, [
        result.marker,
        '// vik-veriflow:source "designs/soc_top.ad"',
        '',
        'module soc_top;',
        'endmodule',
        '',
    ].join('\n'));
    assert.deepEqual(parseArchDesignRtlMarker(result.text), {
        schemaVersion: 2,
        fingerprint: result.fingerprint,
        language: 'verilog',
    });
});

test('escapes source paths before placing them in generated comments', () => {
    const sourcePath = 'designs/top.ad\r\nendmodule\nmodule injected;';
    const result = exportArchDesignRtl(createEmptyArchDesign('safe_top'), [], { sourcePath });

    assert.equal(result.status, 'generated');
    if (result.status !== 'generated') return;
    assert.ok(result.text.includes(`// vik-veriflow:source ${JSON.stringify(sourcePath)}`));
    assert.equal(result.text.includes('\nmodule injected;'), false);
    assert.equal(result.text.match(/^module /gm)?.length, 1);
});

test('ignores malformed or non-leading generated markers', () => {
    assert.equal(parseArchDesignRtlMarker('module handwritten;\nendmodule\n'), undefined);
    assert.equal(parseArchDesignRtlMarker([
        '',
        '// vik-veriflow:generated arch-design schema=1 fingerprint=ad-v1-0000000000000000 language=verilog',
    ].join('\n')), undefined);
});

test('exports ordered ports, collision-safe nets, and boundary assignments', () => {
    const design = designOf({
        ports: [
            { name: 'clk', direction: 'input' },
            { name: 'data', direction: 'input', width: 8 },
            { name: 'result', direction: 'output', width: 8 },
        ],
        connections: [{
            name: 'clock',
            endpoints: [{ kind: 'port', port: 'clk' }],
        }, {
            name: 'result',
            endpoints: [
                { kind: 'port', port: 'data' },
                { kind: 'port', port: 'result' },
            ],
        }],
    });

    const result = exportArchDesignRtl(design, [], { sourcePath: 'soc_top.ad' });

    assert.equal(result.status, 'generated');
    if (result.status !== 'generated') return;
    const body = result.text.slice(result.text.indexOf('module'));
    assert.equal(body, [
        'module soc_top (',
        '    input wire clk,',
        '    input wire [7:0] data,',
        '    output wire [7:0] result',
        ');',
        '',
        'wire clock;',
        '',
        'assign clock = clk;',
        'assign result = data;',
        '',
        'endmodule',
        '',
    ].join('\n'));
});

test('uses an explicit language override for extension, marker, and fingerprint', () => {
    const design = createEmptyArchDesign('language_top');
    const verilog = exportArchDesignRtl(design, []);
    const systemVerilog = exportArchDesignRtl(design, [], { language: 'systemverilog' });

    assert.equal(verilog.status, 'generated');
    assert.equal(systemVerilog.status, 'generated');
    if (verilog.status !== 'generated' || systemVerilog.status !== 'generated') return;
    assert.equal(systemVerilog.language, 'systemverilog');
    assert.equal(systemVerilog.extension, '.sv');
    assert.match(systemVerilog.marker, / language=systemverilog$/);
    assert.notEqual(systemVerilog.fingerprint, verilog.fingerprint);
});

test('exports explicit ordered instances, parameters, and effective defaults', () => {
    const producer: ArchDesignModuleDefinition = {
        key: 'rtl/producer.v#producer',
        name: 'producer',
        parameters: [
            { name: 'MODE' },
            { name: 'WIDTH' },
            { name: 'ENABLE' },
        ],
        ports: [
            { name: 'clk', direction: 'input', width: { kind: 'known', bits: 1 } },
            { name: 'data_o', direction: 'output', width: { kind: 'known', bits: 8 } },
            { name: 'unused_o', direction: 'output', width: { kind: 'known', bits: 1 } },
            { name: 'io', direction: 'inout', width: { kind: 'known', bits: 1 } },
        ],
    };
    const sink: ArchDesignModuleDefinition = {
        key: 'rtl/sink.v#sink',
        name: 'sink',
        parameters: [],
        ports: [
            { name: 'data_i', direction: 'input', width: { kind: 'known', bits: 8 } },
            { name: 'enable', direction: 'input', width: { kind: 'known', bits: 1 } },
            { name: 'spare_o', direction: 'output', width: { kind: 'known', bits: 1 } },
            { name: 'io', direction: 'inout', width: { kind: 'known', bits: 1 } },
        ],
    };
    const design = designOf({
        ports: [
            { name: 'clk', direction: 'input' },
            { name: 'result', direction: 'output', width: 8 },
        ],
        instances: [{
            name: 'u_prod',
            module: 'producer',
            parameters: { ENABLE: true, WIDTH: 8, MODE: "2'b10" },
        }, {
            name: 'u_sink',
            module: 'sink',
        }],
        connections: [{
            name: 'clock',
            endpoints: [
                { kind: 'port', port: 'clk' },
                { kind: 'instance', instance: 'u_prod', port: 'clk' },
            ],
        }, {
            name: 'result',
            endpoints: [
                { kind: 'instance', instance: 'u_prod', port: 'data_o' },
                { kind: 'port', port: 'result' },
            ],
        }, {
            name: 'fallback',
            endpoints: [{ kind: 'instance', instance: 'u_sink', port: 'data_i' }],
            defaults: { 'u_sink.data_i': "8'h5a" },
        }],
        defaults: {
            'u_sink.data_i': "8'h00",
            'u_sink.enable': "1'b0",
        },
    });

    const result = exportArchDesignRtl(design, [producer, sink]);

    assert.equal(result.status, 'generated');
    if (result.status !== 'generated') return;
    const body = result.text.slice(result.text.indexOf('module'));
    assert.equal(body, [
        'module soc_top (',
        '    input wire clk,',
        '    output wire [7:0] result',
        ');',
        '',
        'wire clock;',
        'wire [7:0] fallback;',
        '',
        'assign clock = clk;',
        'assign fallback = 8\'h5a;',
        '',
        'producer #(',
        '    .MODE(2\'b10),',
        '    .WIDTH(8),',
        '    .ENABLE(1\'b1)',
        ') u_prod (',
        '    .clk(clock),',
        '    .data_o(result),',
        '    .unused_o(),',
        '    .io()',
        ');',
        '',
        'sink u_sink (',
        '    .data_i(fallback),',
        '    .enable(1\'b0),',
        '    .spare_o(),',
        '    .io()',
        ');',
        '',
        'endmodule',
        '',
    ].join('\n'));
});

test('resolves parameterized instance port widths to numeric RTL ranges', () => {
    const producer: ArchDesignModuleDefinition = {
        key: 'rtl/parameterized_producer.v#parameterized_producer',
        name: 'parameterized_producer',
        parameters: [
            { name: 'WIDTH', defaultExpression: '8' },
            { name: 'LANES', defaultExpression: '2' },
        ],
        ports: [{
            name: 'data_o',
            direction: 'output',
            width: { kind: 'symbolic', expression: '[WIDTH * LANES - 1:0]' },
        }],
    };
    const design = designOf({
        ports: [{ name: 'data_o', direction: 'output', width: 24 }],
        instances: [{
            name: 'u_producer',
            module: 'parameterized_producer',
            parameters: { WIDTH: 12 },
        }],
        connections: [{
            name: 'data_o',
            endpoints: [
                { kind: 'instance', instance: 'u_producer', port: 'data_o' },
                { kind: 'port', port: 'data_o' },
            ],
        }],
    });

    const result = exportArchDesignRtl(design, [producer]);

    assert.equal(result.status, 'generated');
    if (result.status !== 'generated') return;
    assert.match(result.text, /output wire \[23:0\] data_o/);
    assert.match(result.text, /output wire \[23:0\] data_o/);
    assert.doesNotMatch(result.text, /wire \[[^\n]*WIDTH/);
});

test('exports implicit zero and explicit overrides for open instance inputs', () => {
    const sink: ArchDesignModuleDefinition = {
        key: 'rtl/sink.v#sink',
        name: 'sink',
        parameters: [],
        ports: [
            { name: 'data_i', direction: 'input', width: { kind: 'known', bits: 8 } },
            { name: 'enable', direction: 'input', width: { kind: 'known', bits: 1 } },
        ],
    };
    const design = designOf({
        instances: [{ name: 'u_sink', module: 'sink' }],
        defaults: { 'u_sink.enable': "1'b1" },
    });

    const result = exportArchDesignRtl(design, [sink]);

    assert.equal(result.status, 'generated');
    if (result.status !== 'generated') return;
    assert.ok(result.text.includes([
        'sink u_sink (',
        '    .data_i(0),',
        "    .enable(1'b1)",
        ');',
    ].join('\n')));
});

test('exports every Logic Utility as deterministic continuous assignments', () => {
    const logic = [
        { name: 'u_constant', operation: 'constant', width: 8, expression: "8'h5a" },
        { name: 'u_not', operation: 'not', width: 8 },
        { name: 'u_and', operation: 'and', width: 8, inputCount: 2 },
        { name: 'u_or', operation: 'or', width: 8, inputCount: 2 },
        { name: 'u_xor', operation: 'xor', width: 8, inputCount: 2 },
        { name: 'u_nand', operation: 'nand', width: 8, inputCount: 2 },
        { name: 'u_nor', operation: 'nor', width: 8, inputCount: 2 },
        { name: 'u_xnor', operation: 'xnor', width: 8, inputCount: 2 },
        { name: 'u_mux', operation: 'mux', width: 8 },
        { name: 'u_concat', operation: 'concat', inputWidths: [8, 8] },
        { name: 'u_slice', operation: 'slice', inputWidth: 16, msb: 7, lsb: 0 },
        { name: 'u_replicate', operation: 'replicate', inputWidth: 8, count: 2 },
        { name: 'u_zero_extend', operation: 'zero-extend', inputWidth: 16, outputWidth: 24 },
        { name: 'u_sign_extend', operation: 'sign-extend', inputWidth: 24, outputWidth: 32 },
        { name: 'u_reduce_and', operation: 'reduce-and', inputWidth: 32 },
        { name: 'u_reduce_or', operation: 'reduce-or', inputWidth: 1 },
        { name: 'u_reduce_xor', operation: 'reduce-xor', inputWidth: 1 },
    ] as const;
    const links = [
        ['const_to_not', 'u_constant', 'u_not', 'in'],
        ['not_to_and', 'u_not', 'u_and', 'in0'],
        ['and_to_or', 'u_and', 'u_or', 'in0'],
        ['or_to_xor', 'u_or', 'u_xor', 'in0'],
        ['xor_to_nand', 'u_xor', 'u_nand', 'in0'],
        ['nand_to_nor', 'u_nand', 'u_nor', 'in0'],
        ['nor_to_xnor', 'u_nor', 'u_xnor', 'in0'],
        ['xnor_to_mux', 'u_xnor', 'u_mux', 'in0'],
        ['mux_to_concat', 'u_mux', 'u_concat', 'in0'],
        ['concat_to_slice', 'u_concat', 'u_slice', 'in'],
        ['slice_to_replicate', 'u_slice', 'u_replicate', 'in'],
        ['replicate_to_zext', 'u_replicate', 'u_zero_extend', 'in'],
        ['zext_to_sext', 'u_zero_extend', 'u_sign_extend', 'in'],
        ['sext_to_reduce_and', 'u_sign_extend', 'u_reduce_and', 'in'],
        ['reduce_and_to_reduce_or', 'u_reduce_and', 'u_reduce_or', 'in'],
        ['reduce_or_to_reduce_xor', 'u_reduce_or', 'u_reduce_xor', 'in'],
    ] as const;
    const design = designOf({
        ports: [
            { name: '__vf_net_const_to_not', direction: 'input' },
            { name: 'result', direction: 'output' },
        ],
        logic,
        connections: [
            ...links.map(([name, source, target, port]) => ({
                name,
                endpoints: [
                    { kind: 'logic' as const, logic: source, port: 'out' },
                    { kind: 'logic' as const, logic: target, port },
                ],
            })),
            {
                name: 'concat_default',
                endpoints: [{ kind: 'logic', logic: 'u_concat', port: 'in1' }],
                defaults: { 'u_concat.in1': "8'hf0" },
            },
            {
                name: 'reduce_xor_to_result',
                endpoints: [
                    { kind: 'logic', logic: 'u_reduce_xor', port: 'out' },
                    { kind: 'port', port: 'result' },
                ],
            },
        ],
        defaults: {
            'u_mux.in1': "8'h3c",
            'u_mux.select': "1'b1",
        },
    });

    const verilog = exportArchDesignRtl(design, [], { language: 'verilog' });
    const systemVerilog = exportArchDesignRtl(design, [], { language: 'systemverilog' });

    assert.equal(verilog.status, 'generated');
    assert.equal(systemVerilog.status, 'generated');
    if (verilog.status !== 'generated' || systemVerilog.status !== 'generated') return;
    const body = verilog.text.slice(verilog.text.indexOf('module'));
    assert.equal(body, [
        'module soc_top (',
        '    input wire __vf_net_const_to_not,',
        '    output wire result',
        ');',
        '',
        'wire [7:0] const_to_not;',
        'wire [7:0] not_to_and;',
        'wire [7:0] and_to_or;',
        'wire [7:0] or_to_xor;',
        'wire [7:0] xor_to_nand;',
        'wire [7:0] nand_to_nor;',
        'wire [7:0] nor_to_xnor;',
        'wire [7:0] xnor_to_mux;',
        'wire [7:0] mux_to_concat;',
        'wire [15:0] concat_to_slice;',
        'wire [7:0] slice_to_replicate;',
        'wire [15:0] replicate_to_zext;',
        'wire [23:0] zext_to_sext;',
        'wire [31:0] sext_to_reduce_and;',
        'wire reduce_and_to_reduce_or;',
        'wire reduce_or_to_reduce_xor;',
        'wire [7:0] concat_default;',
        'wire reduce_xor_to_result;',
        '',
        'assign result = reduce_xor_to_result;',
        "assign concat_default = 8'hf0;",
        "assign const_to_not = 8'h5a;",
        'assign not_to_and = ~const_to_not;',
        'assign and_to_or = not_to_and & 0;',
        'assign or_to_xor = and_to_or | 0;',
        'assign xor_to_nand = or_to_xor ^ 0;',
        'assign nand_to_nor = ~(xor_to_nand & 0);',
        'assign nor_to_xnor = ~(nand_to_nor | 0);',
        'assign xnor_to_mux = ~(nor_to_xnor ^ 0);',
        "assign mux_to_concat = 1'b1 ? 8'h3c : xnor_to_mux;",
        'assign concat_to_slice = {mux_to_concat, concat_default};',
        'assign slice_to_replicate = concat_to_slice[7:0];',
        'assign replicate_to_zext = {2{slice_to_replicate}};',
        "assign zext_to_sext = {{(24-16){1'b0}}, replicate_to_zext};",
        'assign sext_to_reduce_and = {{(32-24){zext_to_sext[23]}}, zext_to_sext};',
        'assign reduce_and_to_reduce_or = &sext_to_reduce_and;',
        'assign reduce_or_to_reduce_xor = |reduce_and_to_reduce_or;',
        'assign reduce_xor_to_result = ^reduce_or_to_reduce_xor;',
        '',
        'endmodule',
        '',
    ].join('\n'));
    assert.equal(
        systemVerilog.text.slice(systemVerilog.text.indexOf('module')),
        body
    );
});

test('uses a direct assignment for equal-width extensions', () => {
    const design = designOf({
        ports: [{ name: 'result', direction: 'output', width: 8 }],
        logic: [{
            name: 'u_extend',
            operation: 'zero-extend',
            inputWidth: 8,
            outputWidth: 8,
        }],
        connections: [{
            name: 'result',
            endpoints: [
                { kind: 'logic', logic: 'u_extend', port: 'out' },
                { kind: 'port', port: 'result' },
            ],
        }],
        defaults: { 'u_extend.in': "8'ha5" },
    });

    const result = exportArchDesignRtl(design, []);

    assert.equal(result.status, 'generated');
    if (result.status !== 'generated') return;
    assert.match(result.text, /assign result = 8'ha5;/);
    assert.doesNotMatch(result.text, /\{\{/);
});

test('exports scalar tri-state control and inout readback assignments', () => {
    const io: ArchDesignModuleDefinition = {
        key: 'rtl/io.v#io_core',
        name: 'io_core',
        parameters: [],
        ports: [
            { name: 'gpio_o', direction: 'output', width: { kind: 'known', bits: 8 } },
            { name: 'gpio_t', direction: 'output', width: { kind: 'known', bits: 1 } },
            { name: 'gpio_i', direction: 'input', width: { kind: 'known', bits: 8 } },
        ],
    };
    const design = designOf({
        ports: [{ name: 'gpio', direction: 'inout', width: 8 }],
        instances: [{ name: 'u_io', module: 'io_core' }],
        connections: [{
            name: 'gpio_o',
            endpoints: [
                { kind: 'instance', instance: 'u_io', port: 'gpio_o' },
                { kind: 'port', port: 'gpio', signal: 'o' },
            ],
        }, {
            name: 'gpio_t',
            endpoints: [
                { kind: 'instance', instance: 'u_io', port: 'gpio_t' },
                { kind: 'port', port: 'gpio', signal: 't' },
            ],
        }, {
            name: 'gpio_i',
            endpoints: [
                { kind: 'port', port: 'gpio', signal: 'i' },
                { kind: 'instance', instance: 'u_io', port: 'gpio_i' },
            ],
        }],
    });

    const result = exportArchDesignRtl(design, [io]);

    assert.equal(result.status, 'generated');
    if (result.status !== 'generated') return;
    assert.match(result.text, /assign gpio_i = gpio;/);
    assert.match(
        result.text,
        /assign gpio = gpio_t \? \{8\{1'bz\}\} : gpio_o;/
    );
});

test('uses the implicit high-impedance default for an unconnected scalar inout t', () => {
    const io: ArchDesignModuleDefinition = {
        key: 'rtl/bit_io.v#bit_io',
        name: 'bit_io',
        parameters: [],
        ports: [{ name: 'pin_o', direction: 'output', width: { kind: 'known', bits: 1 } }],
    };
    const design = designOf({
        ports: [{ name: 'pin', direction: 'inout' }],
        instances: [{ name: 'u_io', module: 'bit_io' }],
        connections: [{
            name: 'pin_o',
            endpoints: [
                { kind: 'instance', instance: 'u_io', port: 'pin_o' },
                { kind: 'port', port: 'pin', signal: 'o' },
            ],
        }],
    });

    const result = exportArchDesignRtl(design, [io]);

    assert.equal(result.status, 'generated');
    if (result.status !== 'generated') return;
    assert.match(result.text, /assign pin = 1'b1 \? 1'bz : pin_o;/);
});

test('exports per-bit inout control with collision-safe Verilog generate identifiers', () => {
    const io: ArchDesignModuleDefinition = {
        key: 'rtl/vector_io.v#vector_io',
        name: 'vector_io',
        parameters: [],
        ports: [
            { name: 'gpio_o', direction: 'output', width: { kind: 'known', bits: 8 } },
            { name: 'gpio_t', direction: 'output', width: { kind: 'known', bits: 8 } },
        ],
    };
    const design = designOf({
        ports: [
            { name: '__vf_gpio_index', direction: 'input' },
            { name: '__vf_gpio_tristate', direction: 'input' },
            { name: 'gpio', direction: 'inout', width: 8 },
        ],
        instances: [{ name: 'u_io', module: 'vector_io' }],
        connections: [{
            name: 'gpio_o',
            endpoints: [
                { kind: 'instance', instance: 'u_io', port: 'gpio_o' },
                { kind: 'port', port: 'gpio', signal: 'o' },
            ],
        }, {
            name: 'gpio_t',
            endpoints: [
                { kind: 'instance', instance: 'u_io', port: 'gpio_t' },
                { kind: 'port', port: 'gpio', signal: 't' },
            ],
        }],
    });

    const result = exportArchDesignRtl(design, [io]);

    assert.equal(result.status, 'generated');
    if (result.status !== 'generated') return;
    assert.match(result.text, /genvar __vf_gpio_index_2;/);
    assert.ok(result.text.includes([
        'generate',
        '    for (__vf_gpio_index_2 = 0; __vf_gpio_index_2 < 8; __vf_gpio_index_2 = __vf_gpio_index_2 + 1) begin : __vf_gpio_tristate_2',
        "        assign gpio[__vf_gpio_index_2] = gpio_t[__vf_gpio_index_2] ? 1'bz : gpio_o[__vf_gpio_index_2];",
        '    end',
        'endgenerate',
    ].join('\n')));
});

test('blocks invalid interface connections with frozen endpoint diagnostics', () => {
    const design = designOf({
        interfaceConnections: [{
            name: 'axi',
            master: { kind: 'instance', instance: 'u_master', interface: 'm_axi' },
            slave: { kind: 'instance', instance: 'u_slave', interface: 's_axi' },
        }],
    });

    const result = exportArchDesignRtl(design, []);

    assert.equal(result.status, 'invalid');
    if (result.status !== 'invalid') return;
    assert.deepEqual(result.diagnostics.map(item => [item.path, item.code]), [
        ['$.interfaceConnections[0].master', 'AD_INTERFACE_ENDPOINT_UNKNOWN'],
        ['$.interfaceConnections[0].slave', 'AD_INTERFACE_ENDPOINT_UNKNOWN'],
    ]);
    assert.equal(Object.isFrozen(result), true);
    assert.equal(Object.isFrozen(result.diagnostics), true);
    assert.equal(Object.isFrozen(result.diagnostics[0]), true);
    assert.equal('text' in result, false);
});

test('exports interface bindings as ordinary collision-safe Verilog nets', () => {
    const design = designOf({
        instances: [
            { name: 'u_master', module: 'interface_master' },
            { name: 'u_slave', module: 'interface_slave' },
        ],
        interfaceConnections: [{
            name: 'control',
            master: { kind: 'instance', instance: 'u_master', interface: 'BUS' },
            slave: { kind: 'instance', instance: 'u_slave', interface: 'LINK' },
        }],
    });

    const result = exportArchDesignRtl(design, [interfaceMaster, interfaceSlave], {
        interfaceCatalog: interfaceCatalog(),
    });

    assert.equal(result.status, 'generated');
    if (result.status !== 'generated') return;
    assert.match(result.text, /wire \[31:0\] control_request;/);
    assert.match(result.text, /wire control_accept;/);
    assert.match(result.text, /wire \[3:0\] control_tag;/);
    assert.match(result.text, /\.BUS_REQUEST\(control_request\)/);
    assert.match(result.text, /\.LINK_REQUEST\(control_request\)/);
    assert.match(result.text, /\.LINK_ACCEPT\(control_accept\)/);
    assert.match(result.text, /\.BUS_ACCEPT\(control_accept\)/);
    assert.match(result.text, /\.BUS_TAG\(control_tag\)/);
    assert.match(result.text, /\.LINK_TAG\(control_tag\)/);
    assert.equal(result.text.includes('interface '), false);
    assert.equal(result.text.includes('adapter'), false);
});

test('exports promoted interface members as deterministic scalar top-level ports', () => {
    const design = designOf({
        instances: [{ name: 'u_master', module: 'interface_master' }],
        interfacePorts: [{
            name: 'm_link',
            protocol: 'project.link',
            role: 'master',
            memberPrefix: 'M_LINK',
            members: [
                { member: 'request', width: 32 },
                { member: 'accept', width: 1 },
                { member: 'tag', width: 4 },
            ],
        }],
        interfaceConnections: [{
            name: 'control',
            master: { kind: 'instance', instance: 'u_master', interface: 'BUS' },
            slave: { kind: 'port', port: 'm_link' },
        }],
    });

    const result = exportArchDesignRtl(design, [interfaceMaster], {
        language: 'systemverilog',
        interfaceCatalog: interfaceCatalog(),
    });

    assert.equal(result.status, 'generated');
    if (result.status !== 'generated') return;
    assert.equal(result.extension, '.sv');
    assert.match(result.text, /output wire \[31:0\] M_LINK_request,/);
    assert.match(result.text, /input wire M_LINK_accept,/);
    assert.match(result.text, /output wire \[3:0\] M_LINK_tag/);
    assert.match(result.text, /assign M_LINK_request = control_request;/);
    assert.match(result.text, /assign control_accept = M_LINK_accept;/);
    assert.match(result.text, /assign M_LINK_tag = control_tag;/);
});

test('binds receiver-only members to explicit defaults and leaves sender-only outputs open', () => {
    const receiverOnly = designOf({
        instances: [
            { name: 'u_master', module: 'interface_master_without_tag' },
            { name: 'u_slave', module: 'interface_slave' },
        ],
        interfaceConnections: [{
            name: 'control',
            master: { kind: 'instance', instance: 'u_master', interface: 'BUS' },
            slave: { kind: 'instance', instance: 'u_slave', interface: 'LINK' },
            defaults: { tag: "4'ha" },
        }],
    });
    const defaulted = exportArchDesignRtl(
        receiverOnly,
        [interfaceMasterWithoutTag, interfaceSlave],
        { interfaceCatalog: interfaceCatalog() }
    );
    assert.equal(defaulted.status, 'generated');
    if (defaulted.status !== 'generated') return;
    assert.match(defaulted.text, /\.LINK_TAG\(4'ha\)/);
    assert.equal(defaulted.text.includes('control_tag'), false);

    const senderOnly = designOf({
        instances: [
            { name: 'u_master', module: 'interface_master' },
            { name: 'u_slave', module: 'interface_slave' },
        ],
        interfaceConnections: [{
            name: 'control',
            master: { kind: 'instance', instance: 'u_master', interface: 'BUS' },
            slave: { kind: 'instance', instance: 'u_slave', interface: 'LINK' },
        }],
    });
    const slaveWithoutTag = { ...interfaceSlave, ports: interfaceSlave.ports.slice(0, 2) };
    const opened = exportArchDesignRtl(senderOnly, [interfaceMaster, slaveWithoutTag], {
        interfaceCatalog: interfaceCatalog(),
    });
    assert.equal(opened.status, 'generated');
    if (opened.status !== 'generated') return;
    assert.match(opened.text, /\.BUS_TAG\(\)/);
    assert.equal(opened.text.includes('control_tag'), false);
});

test('permits interface width warnings and fingerprints the effective protocol', () => {
    const design = designOf({
        instances: [
            { name: 'u_master', module: 'interface_master_without_tag' },
            { name: 'u_slave', module: 'interface_slave' },
        ],
        interfaceConnections: [{
            name: 'control',
            master: { kind: 'instance', instance: 'u_master', interface: 'BUS' },
            slave: { kind: 'instance', instance: 'u_slave', interface: 'LINK' },
        }],
    });

    const zero = exportArchDesignRtl(
        design,
        [interfaceMasterWithoutTag, interfaceSlave],
        { interfaceCatalog: interfaceCatalog('0') }
    );
    const one = exportArchDesignRtl(
        design,
        [interfaceMasterWithoutTag, interfaceSlave],
        { interfaceCatalog: interfaceCatalog("4'h1") }
    );

    assert.equal(zero.status, 'generated');
    assert.equal(one.status, 'generated');
    if (zero.status !== 'generated' || one.status !== 'generated') return;
    assert.match(zero.text, /wire \[31:0\] control_request;/);
    assert.match(zero.text, /\.LINK_TAG\(0\)/);
    assert.match(one.text, /\.LINK_TAG\(4'h1\)/);
    assert.notEqual(one.text, zero.text);
    assert.notEqual(one.fingerprint, zero.fingerprint);
});

test('keeps output deterministic across presentation and output-path changes', () => {
    const original = designOf({
        export: { output: 'generated/first.v' },
        presentation: { collapsedInterfaces: { first: true } },
    });
    const moved = designOf({
        export: { output: 'elsewhere/second.v' },
        presentation: { collapsedInterfaces: { first: false } },
    });

    const first = exportArchDesignRtl(original, [], { sourcePath: 'soc_top.ad' });
    const repeated = exportArchDesignRtl(original, [], { sourcePath: 'soc_top.ad' });
    const afterMove = exportArchDesignRtl(moved, [], { sourcePath: 'soc_top.ad' });

    assert.equal(first.status, 'generated');
    assert.equal(repeated.status, 'generated');
    assert.equal(afterMove.status, 'generated');
    if (first.status !== 'generated'
        || repeated.status !== 'generated'
        || afterMove.status !== 'generated') return;
    assert.equal(repeated.text, first.text);
    assert.equal(afterMove.text, first.text);
    assert.equal(afterMove.fingerprint, first.fingerprint);
    assert.equal(Object.isFrozen(first), true);
});

test('snapshots getter-backed declarations once before validation and fingerprinting', () => {
    let nameReads = 0;
    let directionReads = 0;
    let widthReads = 0;
    const port = {} as ArchDesign['ports'][number];
    Object.defineProperties(port, {
        name: {
            enumerable: true,
            get: () => {
                nameReads += 1;
                return 'clk';
            },
        },
        direction: {
            enumerable: true,
            get: () => {
                directionReads += 1;
                return 'input';
            },
        },
        width: {
            enumerable: true,
            get: () => {
                widthReads += 1;
                return undefined;
            },
        },
    });
    const design = {
        ...createEmptyArchDesign('getter_top'),
        ports: [port],
    } as ArchDesign;

    const result = exportArchDesignRtl(design, []);

    assert.equal(result.status, 'generated');
    assert.deepEqual({ nameReads, directionReads, widthReads }, {
        nameReads: 1,
        directionReads: 1,
        widthReads: 1,
    });
    assert.equal(result.status === 'generated' && result.text.includes('input wire clk'), true);
});

test('generated Verilog and SystemVerilog compile with Icarus when available', t => {
    const probe = spawnSync('iverilog', ['-V'], { encoding: 'utf8' });
    if (probe.error && (probe.error as NodeJS.ErrnoException).code === 'ENOENT') {
        t.skip('iverilog is not installed');
        return;
    }
    assert.equal(probe.status, 0, probe.stdout + probe.stderr);

    const io: ArchDesignModuleDefinition = {
        key: 'rtl/vector_io.v#vector_io',
        name: 'vector_io',
        parameters: [],
        ports: [
            { name: 'gpio_o', direction: 'output', width: { kind: 'known', bits: 8 } },
            { name: 'gpio_t', direction: 'output', width: { kind: 'known', bits: 8 } },
        ],
    };
    const design = designOf({
        ports: [{ name: 'gpio', direction: 'inout', width: 8 }],
        instances: [{ name: 'u_io', module: 'vector_io' }],
        connections: [{
            name: 'gpio_o',
            endpoints: [
                { kind: 'instance', instance: 'u_io', port: 'gpio_o' },
                { kind: 'port', port: 'gpio', signal: 'o' },
            ],
        }, {
            name: 'gpio_t',
            endpoints: [
                { kind: 'instance', instance: 'u_io', port: 'gpio_t' },
                { kind: 'port', port: 'gpio', signal: 't' },
            ],
        }],
    });
    const root = mkdtempSync(path.join(os.tmpdir(), 'veriflow-ad-rtl-'));
    try {
        const childPath = path.join(root, 'vector_io.v');
        writeFileSync(childPath, [
            'module vector_io(output wire [7:0] gpio_o, output wire [7:0] gpio_t);',
            "assign gpio_o = 8'h00;",
            "assign gpio_t = 8'hff;",
            'endmodule',
            '',
        ].join('\n'));
        const interfaceChildPath = path.join(root, 'interface_children.v');
        writeFileSync(interfaceChildPath, [
            'module interface_master(',
            '    output wire [31:0] BUS_REQUEST,',
            '    input wire BUS_ACCEPT,',
            '    output wire [3:0] BUS_TAG',
            ');',
            "assign BUS_REQUEST = 32'h0;",
            "assign BUS_TAG = 4'h0;",
            'endmodule',
            'module interface_slave(',
            '    input wire [15:0] LINK_REQUEST,',
            '    output wire LINK_ACCEPT,',
            '    input wire [3:0] LINK_TAG',
            ');',
            "assign LINK_ACCEPT = 1'b1;",
            'endmodule',
            '',
        ].join('\n'));
        const interfaceDesignValue = designOf({
            instances: [
                { name: 'u_master', module: 'interface_master' },
                { name: 'u_slave', module: 'interface_slave' },
            ],
            interfaceConnections: [{
                name: 'control',
                master: { kind: 'instance', instance: 'u_master', interface: 'BUS' },
                slave: { kind: 'instance', instance: 'u_slave', interface: 'LINK' },
            }],
        });
        for (const [language, generation] of [
            ['verilog', '2001'],
            ['systemverilog', '2012'],
        ] as const) {
            const exported = exportArchDesignRtl(design, [io], { language });
            assert.equal(exported.status, 'generated');
            if (exported.status !== 'generated') continue;
            const generatedPath = path.join(root, `soc_top${exported.extension}`);
            writeFileSync(generatedPath, exported.text);
            const compiled = spawnSync('iverilog', [
                `-g${generation}`,
                '-s',
                'soc_top',
                '-o',
                path.join(root, `soc_top-${language}.out`),
                childPath,
                generatedPath,
            ], { encoding: 'utf8' });
            assert.equal(compiled.status, 0, compiled.stdout + compiled.stderr);

            const interfaceExported = exportArchDesignRtl(
                interfaceDesignValue,
                [interfaceMaster, interfaceSlave],
                { language, interfaceCatalog: interfaceCatalog() }
            );
            assert.equal(interfaceExported.status, 'generated');
            if (interfaceExported.status !== 'generated') continue;
            const interfaceGeneratedPath = path.join(
                root,
                `interface-top-${language}${interfaceExported.extension}`
            );
            writeFileSync(interfaceGeneratedPath, interfaceExported.text);
            const interfaceCompiled = spawnSync('iverilog', [
                `-g${generation}`,
                '-s',
                'soc_top',
                '-o',
                path.join(root, `interface-top-${language}.out`),
                interfaceChildPath,
                interfaceGeneratedPath,
            ], { encoding: 'utf8' });
            assert.equal(
                interfaceCompiled.status,
                0,
                interfaceCompiled.stdout + interfaceCompiled.stderr
            );
        }
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
});

test('prefers a renderable definite driver width over an unknown bidirectional peer', () => {
    const bridge: ArchDesignModuleDefinition = {
        key: 'rtl/bridge.v#bridge',
        name: 'bridge',
        parameters: [],
        ports: [{ name: 'io', direction: 'inout', width: { kind: 'unknown' } }],
    };
    const design = designOf({
        ports: [{ name: 'data', direction: 'input', width: 8 }],
        instances: [{ name: 'u_bridge', module: 'bridge' }],
        connections: [{
            name: 'bus',
            endpoints: [
                { kind: 'instance', instance: 'u_bridge', port: 'io' },
                { kind: 'port', port: 'data' },
            ],
        }],
    });

    const result = exportArchDesignRtl(design, [bridge]);

    assert.equal(result.status, 'generated');
    if (result.status !== 'generated') return;
    assert.match(result.text, /wire \[7:0\] bus;/);
});

test('changes the RTL fingerprint when a referenced module interface changes', () => {
    const withoutPort: ArchDesignModuleDefinition = {
        key: 'rtl/leaf.v#leaf',
        name: 'leaf',
        parameters: [],
        ports: [],
    };
    const withPort: ArchDesignModuleDefinition = {
        ...withoutPort,
        ports: [{ name: 'extra_o', direction: 'output', width: { kind: 'known', bits: 1 } }],
    };
    const design = designOf({
        instances: [{ name: 'u_leaf', module: 'leaf' }],
    });

    const first = exportArchDesignRtl(design, [withoutPort]);
    const changed = exportArchDesignRtl(design, [withPort]);

    assert.equal(first.status, 'generated');
    assert.equal(changed.status, 'generated');
    if (first.status !== 'generated' || changed.status !== 'generated') return;
    assert.notEqual(changed.text, first.text);
    assert.notEqual(changed.fingerprint, first.fingerprint);
});

test('rejects a top port and instance that collide in the RTL module namespace', () => {
    const leaf: ArchDesignModuleDefinition = {
        key: 'rtl/leaf.v#leaf',
        name: 'leaf',
        parameters: [],
        ports: [],
    };
    const design = designOf({
        ports: [{ name: 'u_leaf', direction: 'input' }],
        instances: [{ name: 'u_leaf', module: 'leaf' }],
    });

    const result = exportArchDesignRtl(design, [leaf]);

    assert.equal(result.status, 'invalid');
    if (result.status !== 'invalid') return;
    assert.deepEqual(result.diagnostics.map(item => [item.path, item.code]), [
        ['$.instances[0].name', 'AD_RTL_NAME_COLLISION'],
    ]);
});

test('reuses matching interface member names and diagnoses unrelated RTL namespace collisions', () => {
    const design = designOf({
        instances: [{ name: 'u_master', module: 'interface_master' }],
        interfacePorts: [{ name: 'm_link', protocol: 'project.link', role: 'master',
            memberPrefix: 'control', members: [
                { member: 'request', width: 32 }, { member: 'accept', width: 1 }, { member: 'tag', width: 4 },
            ] }],
        interfaceConnections: [{ name: 'control',
            master: { kind: 'instance', instance: 'u_master', interface: 'BUS' },
            slave: { kind: 'port', port: 'm_link' } }],
    });
    const result = exportArchDesignRtl(design, [interfaceMaster], { interfaceCatalog: interfaceCatalog() });
    assert.equal(result.status, 'generated');
    if (result.status === 'generated') {
        assert.match(result.text, /\.BUS_REQUEST\(control_request\)/);
        assert.doesNotMatch(result.text, /^wire .*control_|assign control_\w+ = control_/m);
    }
    for (const overrides of [
        { instances: [{ name: 'control_request', module: 'interface_master' }],
            interfaceConnections: [{ ...design.interfaceConnections[0], master: {
                kind: 'instance' as const, instance: 'control_request', interface: 'BUS' } }] },
        { ports: [{ name: 'control_request', direction: 'input' as const }],
            interfacePorts: [{ ...design.interfacePorts[0], memberPrefix: 'external' }] },
        { ports: [{ name: 'spare', direction: 'input' as const }],
            connections: [{ name: 'control_request', endpoints: [{ kind: 'port' as const, port: 'spare' }] }] },
    ]) {
        const collided = exportArchDesignRtl({ ...design, ...overrides }, [interfaceMaster], {
            interfaceCatalog: interfaceCatalog(),
        });
        assert.equal(collided.status, 'invalid');
        if (collided.status === 'invalid') assert.ok(collided.diagnostics.some(item =>
            item.code === 'AD_RTL_NAME_COLLISION'));
    }
});

test('rejects HDL keywords instead of emitting invalid unprefixed signal names', () => {
    for (const name of ['wire', 'and', 'logic', 'interface', 'module', 'always_comb', 'checker']) {
        const design = designOf({ ports: [{ name: 'a', direction: 'input' }],
            connections: [{ name, endpoints: [{ kind: 'port', port: 'a' }] }] });
        const result = exportArchDesignRtl(design, []);
        assert.equal(result.status, 'invalid');
        if (result.status === 'invalid') assert.ok(result.diagnostics.some(item =>
            item.path === '$.connections[0].name' && item.code === 'AD_RTL_RESERVED_NAME'));
    }
});
