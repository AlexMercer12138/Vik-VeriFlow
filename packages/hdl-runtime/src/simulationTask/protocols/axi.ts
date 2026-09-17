import type { ProtocolCompileResult } from '../protocols';
import { checkLine, knownInteger, responseBits, transactionBlock, type AdvancedCompileInput } from './types';

const SCALAR_SUFFIXES = ['valid', 'ready', 'last'];

export function compileAxiProtocol(input: AdvancedCompileInput): ProtocolCompileResult {
    const { step, context, observed: s, driven: w, fail, fits, numeric } = input;
    const full = step.protocol === 'axi4';
    const options = step.options!;
    const clock = step.clock!;
    const rise = `@(posedge ${clock});`;
    const fall = `@(negedge ${clock});`;
    const width = context.netWidths[s.wdata];
    const bytes = width / 8;
    if (!Number.isInteger(bytes) || bytes < 1 || bytes > 128 || (bytes & (bytes - 1)) !== 0) fail('signals.wdata', 'AXI data width must be a power-of-two number of bytes from 8 through 1024 bits.');
    if (context.netWidths[s.rdata] !== width) fail('signals.rdata', 'AXI write and read data widths must match.');
    if (context.netWidths[s.wstrb] !== bytes) fail('signals.wstrb', 'AXI WSTRB width must equal the data width in bytes.');
    if (context.netWidths[s.awaddr] !== context.netWidths[s.araddr]) fail('signals.araddr', 'AXI read and write address widths must match.');
    for (const [key, net] of Object.entries(s)) {
        const scalar = SCALAR_SUFFIXES.some(suffix => key.endsWith(suffix));
        if (scalar && context.netWidths[net] !== 1) fail(`signals.${key}`, 'AXI handshake and LAST signals must be scalar.');
    }
    if (context.netWidths[s.bresp] !== 2 || context.netWidths[s.rresp] !== 2) fail('signals.bresp', 'AXI response signals must be 2 bits.');
    if (full) {
        if (context.netWidths[s.awid] !== context.netWidths[s.arid] || context.netWidths[s.awid] !== context.netWidths[s.bid] || context.netWidths[s.awid] !== context.netWidths[s.rid]) fail('signals.awid', 'All AXI4 ID widths must match.');
        if (context.netWidths[s.awlen] !== 8 || context.netWidths[s.arlen] !== 8) fail('signals.awlen', 'AXI4 LEN signals must be 8 bits.');
        if (context.netWidths[s.awsize] !== 3 || context.netWidths[s.arsize] !== 3) fail('signals.awsize', 'AXI4 SIZE signals must be 3 bits.');
        if (context.netWidths[s.awburst] !== 2 || context.netWidths[s.arburst] !== 2) fail('signals.awburst', 'AXI4 BURST signals must be 2 bits.');
    }
    const transmitting = step.role === 'initiator' ? options.write === true : options.write === false;
    const values = (transmitting ? step.data : step.expected)!;
    const beats = values.length;
    values.forEach((value, index) => { if (!fits(value, width)) fail(`${transmitting ? 'data' : 'expected'}[${index}]`, `Value must fit the ${width}-bit AXI data width.`); });
    if (!fits(options.strobe!, bytes)) fail('options.strobe', `Byte strobe must fit ${bytes} bits.`);
    const addressWidth = context.netWidths[s.awaddr];
    if (!fits(options.address!, addressWidth)) fail('options.address', 'Address must fit the mapped AXI address width.');
    if (full && !fits(options.id!, context.netWidths[s.awid])) fail('options.id', 'Transaction ID must fit the mapped AXI ID width.');
    const address = knownInteger(options.address!);
    if (address % BigInt(bytes) !== 0n) fail('options.address', `AXI transfers must be aligned to the full ${bytes}-byte data width.`);
    const burstBytes = bytes * beats;
    if (options.burst === 'wrap') {
        if (![2, 4, 8, 16].includes(beats)) fail(transmitting ? 'data' : 'expected', 'AXI4 WRAP bursts require 2, 4, 8 or 16 beats.');
    }
    const wrapBoundary = options.burst === 'wrap' ? (address / BigInt(burstBytes)) * BigInt(burstBytes) : address;
    const boundaryOffset = Number(wrapBoundary & 0xfffn);
    const boundarySpan = options.burst === 'fixed' ? bytes : burstBytes;
    if (boundaryOffset + boundarySpan > 4096) fail('options.address', 'AXI transactions must not cross a 4 KiB boundary.');
    const prefix = context.prefix;
    const actual = `${prefix}_actual`;
    const declarations = [`reg [${width - 1}:0] ${actual};`];
    const constants = values.map((value, index) => {
        const name = `${prefix}_word_${index}`; declarations.push(`localparam [${width - 1}:0] ${name} = ${numeric(value, width)};`); return name;
    });
    const addressConstant = `${prefix}_address`; declarations.push(`localparam [${addressWidth - 1}:0] ${addressConstant} = ${numeric(options.address!, addressWidth)};`);
    const idConstant = `${prefix}_id`;
    if (full) declarations.push(`localparam [${context.netWidths[s.awid] - 1}:0] ${idConstant} = ${numeric(options.id!, context.netWidths[s.awid])};`);
    const strobeConstant = `${prefix}_strobe`; declarations.push(`localparam [${bytes - 1}:0] ${strobeConstant} = ${numeric(options.strobe!, bytes)};`);
    const response = responseBits(options.response);
    const size = Math.log2(bytes);
    const burst = options.burst === 'fixed' ? "2'b00" : options.burst === 'wrap' ? "2'b10" : "2'b01";
    const wait = options.waitCycles ?? 0;
    const lines: string[] = [];
    const display = (suffix: string, expected: string, received: string, controls = "1'b1") => { lines.push(checkLine(context.path, suffix, expected, received, controls)); };
    const init = (keys: string[]) => keys.forEach(key => lines.push(`${w[key]} <= 0;`));
    const addressControls = (write: boolean) => {
        const channel = write ? 'aw' : 'ar';
        const controls = [`${s[`${channel}addr`]} === ${addressConstant}`];
        if (full) controls.push(`${s[`${channel}id`]} === ${idConstant}`, `${s[`${channel}len`]} === 8'd${beats - 1}`, `${s[`${channel}size`]} === 3'd${size}`, `${s[`${channel}burst`]} === ${burst}`);
        return controls.map(value => `(${value})`).join(' && ');
    };

    if (step.role === 'initiator') {
        init(full ? ['awid', 'awaddr', 'awlen', 'awsize', 'awburst', 'awvalid', 'wdata', 'wstrb', 'wlast', 'wvalid', 'bready', 'arid', 'araddr', 'arlen', 'arsize', 'arburst', 'arvalid', 'rready']
            : ['awaddr', 'awvalid', 'wdata', 'wstrb', 'wvalid', 'bready', 'araddr', 'arvalid', 'rready']);
        if (options.write) {
            lines.push('fork', '    begin', `        ${fall}`, `        ${w.awaddr} <= ${addressConstant};`, `        ${w.awvalid} <= 1'b1;`);
            if (full) lines.push(`        ${w.awid} <= ${idConstant};`, `        ${w.awlen} <= 8'd${beats - 1};`, `        ${w.awsize} <= 3'd${size};`, `        ${w.awburst} <= ${burst};`);
            lines.push(`        ${rise}`, `        while (${s.awready} !== 1'b1) begin ${rise} end`, `        ${fall}`, `        ${w.awvalid} <= 1'b0;`, '    end', '    begin');
            constants.forEach((constant, index) => {
                lines.push(`        ${fall}`, `        ${w.wdata} <= ${constant};`, `        ${w.wstrb} <= ${strobeConstant};`, `        ${w.wvalid} <= 1'b1;`);
                if (full) lines.push(`        ${w.wlast} <= 1'b${index === beats - 1 ? 1 : 0};`);
                lines.push(`        ${rise}`, `        while (${s.wready} !== 1'b1) begin ${rise} end`);
            });
            lines.push(`        ${fall}`, `        ${w.wvalid} <= 1'b0;`);
            if (full) lines.push(`        ${w.wlast} <= 1'b0;`);
            lines.push('    end', 'join', `${fall}`, `${w.bready} <= 1'b1;`, `${rise}`, `while (${s.bvalid} !== 1'b1) begin ${rise} end`);
            display('response', response, s.bresp, full ? `${s.bid} === ${idConstant}` : "1'b1");
            lines.push(`${fall}`, `${w.bready} <= 1'b0;`);
        } else {
            lines.push(fall, `${w.araddr} <= ${addressConstant};`, `${w.arvalid} <= 1'b1;`);
            if (full) lines.push(`${w.arid} <= ${idConstant};`, `${w.arlen} <= 8'd${beats - 1};`, `${w.arsize} <= 3'd${size};`, `${w.arburst} <= ${burst};`);
            lines.push(rise, `while (${s.arready} !== 1'b1) begin ${rise} end`, fall, `${w.arvalid} <= 1'b0;`, `${w.rready} <= 1'b1;`);
            constants.forEach((constant, index) => {
                lines.push(rise, `while (${s.rvalid} !== 1'b1) begin ${rise} end`, `${actual} = ${s.rdata};`);
                const controls = [`${s.rresp} === ${response}`];
                if (full) controls.push(`${s.rid} === ${idConstant}`, `${s.rlast} === 1'b${index === beats - 1 ? 1 : 0}`);
                display(`transaction[${index}]`, constant, actual, controls.map(value => `(${value})`).join(' && '));
            });
            lines.push(fall, `${w.rready} <= 1'b0;`);
        }
    } else {
        init(full ? ['awready', 'wready', 'bid', 'bresp', 'bvalid', 'arready', 'rid', 'rdata', 'rresp', 'rlast', 'rvalid']
            : ['awready', 'wready', 'bresp', 'bvalid', 'arready', 'rdata', 'rresp', 'rvalid']);
        if (options.write) {
            lines.push('fork', '    begin', `        repeat (${wait}) ${fall}`, `        ${w.awready} <= 1'b1;`, `        ${rise}`, `        while (${s.awvalid} !== 1'b1) begin ${rise} end`);
            display('address', addressConstant, s.awaddr, addressControls(true));
            lines.push(`        ${fall}`, `        ${w.awready} <= 1'b0;`, '    end', '    begin');
            constants.forEach((constant, index) => {
                lines.push(`        repeat (${wait}) ${fall}`, `        ${w.wready} <= 1'b1;`, `        ${rise}`, `        while (${s.wvalid} !== 1'b1) begin ${rise} end`, `        ${actual} = ${s.wdata};`);
                display(`transaction[${index}]`, constant, actual, `(${s.wstrb} === ${strobeConstant})${full ? ` && (${s.wlast} === 1'b${index === beats - 1 ? 1 : 0})` : ''}`);
                lines.push(`        ${fall}`, `        ${w.wready} <= 1'b0;`);
            });
            lines.push('    end', 'join', fall);
            if (full) lines.push(`${w.bid} <= ${idConstant};`);
            lines.push(`${w.bresp} <= ${response};`, `${w.bvalid} <= 1'b1;`, rise, `while (${s.bready} !== 1'b1) begin ${rise} end`, fall, `${w.bvalid} <= 1'b0;`);
        } else {
            lines.push(`repeat (${wait}) ${fall}`, `${w.arready} <= 1'b1;`, rise, `while (${s.arvalid} !== 1'b1) begin ${rise} end`);
            display('address', addressConstant, s.araddr, addressControls(false));
            lines.push(fall, `${w.arready} <= 1'b0;`);
            constants.forEach((constant, index) => {
                lines.push(`repeat (${wait}) ${fall}`, `${w.rdata} <= ${constant};`, `${w.rresp} <= ${response};`, `${w.rvalid} <= 1'b1;`);
                if (full) lines.push(`${w.rid} <= ${idConstant};`, `${w.rlast} <= 1'b${index === beats - 1 ? 1 : 0};`);
                lines.push(rise, `while (${s.rready} !== 1'b1) begin ${rise} end`, fall, `${w.rvalid} <= 1'b0;`);
            });
            if (full) lines.push(`${w.rlast} <= 1'b0;`);
        }
    }
    return { declarations, statements: transactionBlock(prefix, 0, step.timeout, lines) };
}
