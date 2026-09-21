import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { formatHdl } from '../src/formatter';

const options = { indentSize: 4, alignmentColumns: [4, 12, 20, 44, 56] as const };
const row = (source: string, text: string): string => source.split('\n').find(line => line.includes(text))!;

test('five columns include header parameters, localparams and signal declarations', async () => {
    const source = `module demo #(parameter [63:0] NAME="VIK_HDTV", parameter ADDR_WIDTH=28,
parameter [31:0] CONFIG_WIDTH=32)(input wire clk,input wire [15:0] data,output reg valid,output [7:0] dout);
localparam [31:0] BAUD_RATE=115200;
parameter integer COUNT=3, OTHER=4;
wire [1:0] net1; reg signed [7:0] ff; reg [15:0] ram [0:255];
assign net1=data[1:0]; assign dout=data[7:0]; endmodule`;
    const result = await formatHdl(source, options);
    for (const name of ['NAME', 'ADDR_WIDTH', 'CONFIG_WIDTH', 'BAUD_RATE', 'COUNT', 'OTHER']) {
        assert.equal(row(result, name).indexOf(name), 44, name);
        assert.equal(row(result, name).indexOf('='), name === 'CONFIG_WIDTH' ? 57 : 56, name);
    }
    assert.equal(row(result, 'NAME').indexOf('[63:0]'), 20);
    assert.equal(row(result, 'COUNT').indexOf('integer'), 14, 'parameter occupies C2, so retain one separating space');
    assert.equal(row(result, 'clk').indexOf('input'), 4);
    assert.equal(row(result, 'clk').indexOf('wire'), 12);
    assert.equal(row(result, 'clk').indexOf('clk'), 44);
    assert.equal(row(result, 'clk').indexOf(','), 56);
    assert.equal(row(result, 'data').indexOf('[15:0]'), 20);
    assert.equal(row(result, 'ff').indexOf('signed'), 12);
    assert.equal(row(result, 'ff').indexOf('[7:0]'), 20);
    assert.equal(row(result, 'ram [').indexOf('[15:0]'), 12);
    assert.equal(row(result, 'ram [').indexOf('ram'), 44);
    assert.equal(row(result, 'ram [').indexOf(';'), 56);
    const assignment = result.split('\n').find(line => line.includes('assign') && line.includes('net1'))!;
    assert.equal(assignment.indexOf('='), 44);
    assert.equal(assignment.indexOf(';'), 56);
    assert.ok(result.includes('"VIK_HDTV",'));
    assert.equal(await formatHdl(result, options), result);
});

test('instance lists share their header columns and close on the last connection', async () => {
    const result = await formatHdl('module m; fifo #(.DATA_WIDTH(16),.FIFO_DEPTH(1024)) u_fifo(.clk(clk),.din(data)); clk_wiz u_clk_wiz(.clk(clk)); endmodule', options);
    assert.equal(row(result, 'fifo ').indexOf('#('), 44);
    assert.equal(row(result, 'u_fifo').indexOf('('), 44);
    assert.equal(row(result, '.DATA_WIDTH').indexOf('.'), 8);
    assert.equal(row(result, '.DATA_WIDTH').indexOf('('), 44);
    assert.equal(row(result, '.DATA_WIDTH').indexOf(')'), 56);
    assert.match(row(result, '.FIFO_DEPTH'), /\)\)$/);
    assert.match(row(result, '.din'), /\)\);$/);
    assert.equal(await formatHdl(result, options), result);
});

test('columns move with outer scopes but never expand due to long content', async () => {
    const custom = { alignmentColumns: [2, 8, 16, 28, 40] as const, indentSize: 2 };
    const result = await formatHdl(`module m; localparam VERY_LONG_PARAMETER_NAME=1; wire this_signal_name_exceeds_the_semicolon_column;
assign short_name = expression_that_exceeds_the_last_column;
generate if (1) begin : g
localparam [7:0] X=1; x u(.a(a));
end endgenerate endmodule`, custom);
    assert.match(row(result, 'VERY_LONG_PARAMETER_NAME'), /VERY_LONG_PARAMETER_NAME = 1;/);
    assert.match(row(result, 'expression_that'), /expression_that_exceeds_the_last_column;$/);
    assert.equal(row(result, ' X').indexOf('X'), 32);
    assert.equal(row(result, ' X').indexOf('='), 44);
    assert.equal(row(result, '.a').indexOf('('), 32);
    assert.equal(await formatHdl(result, custom), result);
});

test('fixed columns preserve macros, comments, escaped identifiers and CRLF', async () => {
    const source = '`define SIZE 8\r\nmodule m;\r\nparameter [7:0] P="a=b;"; // keep = ;\r\nwire \\a.b ;\r\nassign \\a.b = 1;\r\nendmodule\r\n';
    const result = await formatHdl(source, options);
    assert.ok(result.startsWith('`define SIZE 8\r\n'));
    assert.ok(result.includes('"a=b;"; // keep = ;'));
    assert.ok(result.includes('\\a.b '));
    assert.equal(result.replace(/\r\n/g, '').includes('\n'), false);
    assert.equal(await formatHdl(result, options), result);
});

test('invalid or conflicting columns fail before formatting', async () => {
    for (const columns of [[4, 12], [0, 12, 20, 44, 56], [4, 12, 12, 44, 56], [4, 12, 20.5, 44, 56], [4, 12, 20, 44, 241]]) {
        await assert.rejects(formatHdl('module m; endmodule', { ...options, alignmentColumns: columns } as unknown as typeof options), /columns/i);
    }
    await assert.rejects(formatHdl('module m; endmodule', { ...options, indentSize: 2 }), /indent/i);
});

test('multiple instances each start a header even without parameter overrides', async () => {
    const result = await formatHdl('module m; fifo u(.a(1)), v(.a(2)); endmodule', options);
    const second = result.split('\n').find(line => line.trimStart().startsWith('v'));
    assert.ok(second, 'second instance must not attach to the previous connection row');
    assert.equal(second.indexOf('v'), 4);
    assert.equal(second.indexOf('('), 44);
    assert.equal(await formatHdl(result, options), result);
});

test('parameter headers without explicit keyword still align names and equals', async () => {
    const result = await formatHdl('module m #(A=1,B=2)(); endmodule', options);
    for (const name of ['A', 'B']) {
        assert.equal(row(result, name).indexOf(name), 44);
        assert.equal(row(result, name).indexOf('='), 56);
    }
    assert.ok(!result.includes('parameter'), 'formatting must not add omitted syntax');
    assert.equal(await formatHdl(result, options), result);
});

test('the complete development-plan example formats to the reviewed fixture', async () => {
    const fixtures = path.resolve(__dirname, '../../test/fixtures');
    const input = readFileSync(path.join(fixtures, 'formatter-columns-input.v'), 'utf8').replace(/\r\n/g, '\n');
    // The printer retains one blank after a module; represent it explicitly to keep the fixture whitespace-clean.
    const expected = readFileSync(path.join(fixtures, 'formatter-columns-expected.v'), 'utf8').replace(/\r\n/g, '\n') + '\n';
    const result = await formatHdl(input, options);
    assert.equal(result, expected);
    assert.equal(await formatHdl(result, options), expected);
    assert.equal(await formatHdl(input.replace(/\n/g, '\r\n'), options), expected.replace(/\n/g, '\r\n'));
});
