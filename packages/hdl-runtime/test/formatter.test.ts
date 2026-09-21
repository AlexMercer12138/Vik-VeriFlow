import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { formatHdl } from '../src/formatter';

test('formatting preserves operators, strings and comments', async () => {
    const source = 'module m; reg q; initial begin q<=1; if(q===1) $display("a=b, [x] <="); // keep = , []\nend endmodule\n';
    const result = await formatHdl(source);
    assert.match(result, /q\s*<=\s*1/);
    assert.match(result, /q\s*===\s*1/);
    assert.ok(result.includes('"a=b, [x] <="'));
    assert.ok(result.includes('// keep = , []'));
});

test('formats one-line RTL into structured source and is idempotent', async () => {
    const source = 'module m(input clk,input [7:0] data,output reg q);always @(posedge clk) begin if(data!=0) begin q<=1;end else begin q<=0;end end endmodule';
    const result = await formatHdl(source);
    assert.match(result, /module m \(\n/);
    assert.match(result, /\n    always @\(posedge clk\) begin\n/);
    assert.match(result, /\n        if\(data != 0\) begin\n/);
    assert.match(result, /\n            q <= 1;\n/);
    assert.match(result, /end else begin/);
    assert.equal(await formatHdl(result), result);
});

test('keeps multiline comments and compiler directives verbatim', async () => {
    const source = '`define SUM(a,b) ((a) + \\\n (b))\n/* header\n   preserve this  = ,\n */\nmodule m; endmodule\n';
    const result = await formatHdl(source);
    assert.ok(result.startsWith('`define SUM(a,b) ((a) + \\\n (b))\n/* header\n   preserve this  = ,\n */'));
    assert.equal(await formatHdl(result), result);
});

 test('aligns named connections and parameter headers', async () => {
    const result = await formatHdl('module m; x #(.W(8),.A(1)) u(.a(a),.long_name(b)); endmodule');
    assert.ok(result.includes('x #(\n'));
    const rows = result.split('\n').filter(line => /^\s*\./.test(line));
    assert.equal(rows[2].indexOf('('), rows[3].indexOf('('));
    assert.equal(rows[2].indexOf(')'), rows[3].indexOf(')'));
    assert.equal(await formatHdl(result), result);
});

test('handles SystemVerilog packages, types, interfaces and procedural blocks', async () => {
    const source = 'package p; typedef struct packed {logic a; logic [7:0] b;} t; endpackage\ninterface i(input clk); logic a; modport m(input a); endinterface\nmodule m; logic [7:0] q; always_comb begin for(int i=0;i<8;i++) q[i]=0; end endmodule';
    const result = await formatHdl(source);
    assert.match(result, /struct packed \{\n        logic/);
    assert.equal(await formatHdl(result), result);
});

test('refuses malformed input and invalid formatting options', async () => {
    await assert.rejects(formatHdl('module m( ;'), /syntax/);
    await assert.rejects(formatHdl('module m; endmodule', {indentSize: -1}), /indentation/);
});

test('preserves escaped identifiers and CRLF comments', async () => {
    const source = 'module m;\r\nwire \\a.b ; // 中文\r\nassign \\a.b = 1;\r\nendmodule\r\n';
    const result = await formatHdl(source);
    assert.ok(result.includes('\\a.b '));
    assert.equal(await formatHdl(result), result);
    assert.equal(result.replace(/\r\n/g, '').includes('\n'), false);
});

test('separates declaration and assign groups and each HDL block', async () => {
    const source = 'module m; wire a; reg b; assign a=b; assign c=a; always @* begin b=0; end always @* b=1; x u(); x v(); endmodule module n; endmodule';
    const result = await formatHdl(source);
    assert.match(result, /wire[^\n]*a;\n    reg[^\n]*b;\n\n    assign/);
    assert.match(result, /assign a = b;\n    assign c = a;\n\n    always/);
    assert.match(result, /    end\n\n    always/);
    assert.match(result, /b = 1;\n\n    x u/);
    assert.match(result, /u[^;]*;\n\n    x v/);
    assert.match(result, /v[^;]*;\n\nendmodule\n\nmodule n/);
    assert.ok(result.endsWith('endmodule\n\n'));
    assert.equal(await formatHdl(result), result);
});

test('blank lines follow trailing comments and precede next block comments', async () => {
    const source = 'module m; wire a; // signal\n// assignment\nassign a=1; // driven\nalways @* begin $display(a); end // process\nendmodule\n';
    const result = await formatHdl(source);
    assert.match(result, /a; \/\/ signal\n\n/);
    assert.match(result, /assign a = 1; \/\/ driven\n\n/);
    assert.match(result, /end \/\/ process\n\nendmodule/);
    assert.equal(await formatHdl(result), result);
});

test('separates parameter, signal, assign groups and every process or instance without accumulating blanks', async () => {
    const source = `module m;
parameter P=1; localparam Q=2;
wire a; reg b;
assign a=b; assign c=a;
initial begin b=0; end // initialization
// update
always @* b=a;
initial begin b=1; end
generate if (P) begin : g x u(); x v(); end endgenerate
final begin $display("done"); end
x w(); x z();
endmodule`;
    for (const options of [{}, { alignmentColumns: [4, 12, 20, 44, 56] as const }]) {
        const result = await formatHdl(source, options);
        const normalized = result.split('\n').map(line => line.trim().replace(/ +/g, ' ')).join('\n');
        assert.match(normalized, /parameter[^\n]*\nlocalparam[^\n]*;\n\nwire/);
        assert.match(normalized, /wire[^\n]*\nreg[^\n]*;\n\nassign/);
        assert.match(normalized, /assign[^\n]*\nassign[^\n]*;\n\ninitial/);
        assert.match(normalized, /end \/\/ initialization\n\n\/\/ update\nalways/);
        assert.match(normalized, /b = a;\n\ninitial/);
        assert.match(normalized, /end\n\ngenerate/);
        assert.match(normalized, /endgenerate\n\nfinal/);
        assert.match(normalized, /end\n\nx w/);
        assert.match(normalized, /x u[^;]*;\n\nx v/);
        assert.match(normalized, /x w[^;]*;\n\nx z/);
        assert.ok(!result.includes('\n\n\n'));
        assert.equal(await formatHdl(result, options), result);
        assert.equal(await formatHdl(source.replace(/\n/g, '\r\n'), options), result.replace(/\n/g, '\r\n'));
    }
});

test('separates task and function bodies without inserting whitespace inside literal text', async () => {
    const source = 'module m; function f; input a; begin f=a; end endfunction task t; begin $display("initial; end; assign"); end endtask initial t; endmodule';
    const result = await formatHdl(source);
    assert.match(result, /endfunction\n\n    task/);
    assert.match(result, /endtask\n\n    initial/);
    assert.ok(result.includes('"initial; end; assign"'));
    assert.equal(await formatHdl(result), result);
});
