import type { ProtocolCompileResult } from '../protocols';
import { checkLine, transactionBlock, type AdvancedCompileInput } from './types';

export function compileRgb888Protocol(input: AdvancedCompileInput): ProtocolCompileResult {
    const { step, context, observed: s, driven: w, fail, fits, numeric } = input;
    for (const key of ['pclk', 'hsync', 'vsync', 'de']) if (context.netWidths[s[key]] !== 1) fail(`signals.${key}`, `RGB888 ${key} must be scalar.`);
    for (const key of ['r', 'g', 'b']) if (context.netWidths[s[key]] !== 8) fail(`signals.${key}`, `RGB888 ${key.toUpperCase()} must be 8 bits.`);
    const options = step.options!;
    const hActive = options.hActive!; const hTotal = options.hTotal!;
    const vActive = options.vActive!; const vTotal = options.vTotal!;
    const pixels = hActive * vActive;
    const prefix = context.prefix;
    const x = `${prefix}_x`; const y = `${prefix}_y`; const frame = `${prefix}_frame`; const pixel = `${prefix}_pixel`;
    const expected = `${prefix}_expected`; const ok = `${prefix}_ok`; const lineOk = `${prefix}_line_ok`; const firstX = `${prefix}_first_x`;
    const firstExpected = `${prefix}_first_expected`; const firstActual = `${prefix}_first_actual`;
    const declarations = [`integer ${x};`, `integer ${y};`, `integer ${frame};`, `integer ${firstX};`,
        `reg [23:0] ${pixel};`, `reg [23:0] ${expected};`, `reg [23:0] ${firstExpected};`, `reg [23:0] ${firstActual};`, `reg ${ok};`, `reg ${lineOk};`];
    const values = step.role === 'source' ? step.data : step.expected ?? [];
    values.forEach((value, index) => { if (!fits(value, 24)) fail(`${step.role === 'source' ? 'data' : 'expected'}[${index}]`, 'RGB888 pixels must fit packed 24-bit RRGGBB values.'); });
    if (options.pattern === 'pixels') {
        declarations.push(`reg [23:0] ${prefix}_pixels [0:${pixels - 1}];`);
    } else {
        declarations.push(`function [23:0] ${prefix}_colorbar;`, '    input integer color_x;', '    begin', `        case ((color_x * 8) / ${hActive})`,
            `            0: ${prefix}_colorbar = 24'hffffff;`, `            1: ${prefix}_colorbar = 24'hffff00;`,
            `            2: ${prefix}_colorbar = 24'h00ffff;`, `            3: ${prefix}_colorbar = 24'h00ff00;`,
            `            4: ${prefix}_colorbar = 24'hff00ff;`, `            5: ${prefix}_colorbar = 24'hff0000;`,
            `            6: ${prefix}_colorbar = 24'h0000ff;`, `            default: ${prefix}_colorbar = 24'h000000;`,
            '        endcase', '    end', 'endfunction');
    }
    const active = `((${x} < ${hActive}) && (${y} < ${vActive}))`;
    const hsync = `((${x} >= ${options.hSyncStart!}) && (${x} < ${options.hSyncEnd!}))`;
    const vsync = `((${y} >= ${options.vSyncStart!}) && (${y} < ${options.vSyncEnd!}))`;
    const expectedPixel = options.pattern === 'pixels' ? `${prefix}_pixels[${y} * ${hActive} + ${x}]` : `${prefix}_colorbar(${x})`;
    const lines: string[] = [];
    if (options.pattern === 'pixels') values.forEach((value, index) => lines.push(`${prefix}_pixels[${index}] = ${numeric(value, 24)};`));
    if (step.role === 'source') {
        declarations.push('reg vf_pixel_clock_enable = 0;', `assign ${w.pclk} = clk & vf_pixel_clock_enable;`);
        lines.push( `${w.hsync} <= 1'b${1 - options.hsyncPolarity!};`, `${w.vsync} <= 1'b${1 - options.vsyncPolarity!};`, `${w.de} <= 1'b0;`, `${w.r} <= 8'b0;`, `${w.g} <= 8'b0;`, `${w.b} <= 8'b0;`,
            `for (${frame} = 0; ${frame} < ${options.frames}; ${frame} = ${frame} + 1) begin`,
            `    for (${y} = 0; ${y} < ${vTotal}; ${y} = ${y} + 1) begin`,
            `        for (${x} = 0; ${x} < ${hTotal}; ${x} = ${x} + 1) begin`,
            `            @(negedge clk);`, `            vf_pixel_clock_enable <= 1;`, `            ${w.hsync} <= ${hsync} ? 1'b${options.hsyncPolarity} : 1'b${1 - options.hsyncPolarity!};`,
            `            ${w.vsync} <= ${vsync} ? 1'b${options.vsyncPolarity} : 1'b${1 - options.vsyncPolarity!};`,
            `            ${w.de} <= ${active};`, `            if (${active}) begin`, `                ${pixel} = ${expectedPixel};`,
            `                ${w.r} <= ${pixel}[23:16];`, `                ${w.g} <= ${pixel}[15:8];`, `                ${w.b} <= ${pixel}[7:0];`,
            '            end else begin', `                ${w.r} <= 8'b0;`, `                ${w.g} <= 8'b0;`, `                ${w.b} <= 8'b0;`, '            end',
            `            @(posedge clk);`,
            '        end', '    end', 'end', '@(negedge clk);', 'vf_pixel_clock_enable <= 0;', `${w.de} <= 1'b0;`);
        return { declarations, statements: transactionBlock(prefix, 0, step.timeout, lines) };
    }
    const actual = `{${s.r}, ${s.g}, ${s.b}}`;
    lines.push(`for (${frame} = 0; ${frame} < ${options.frames}; ${frame} = ${frame} + 1) begin`,
        `    for (${y} = 0; ${y} < ${vTotal}; ${y} = ${y} + 1) begin`,
        `        ${lineOk} = 1'b1;`, `        ${firstX} = -1;`,
        `        for (${x} = 0; ${x} < ${hTotal}; ${x} = ${x} + 1) begin`, `            @(posedge ${s.pclk});`,
        `            ${pixel} = ${active} ? ${actual} : 24'b0;`, `            ${expected} = ${active} ? ${expectedPixel} : 24'b0;`,
        `            ${ok} = (${s.hsync} === (${hsync} ? 1'b${options.hsyncPolarity} : 1'b${1 - options.hsyncPolarity!}));`,
        `            ${ok} = ${ok} && (${s.vsync} === (${vsync} ? 1'b${options.vsyncPolarity} : 1'b${1 - options.vsyncPolarity!}));`,
        `            ${ok} = ${ok} && (${s.de} === ${active});`,
        `            if (!((${pixel} === ${expected}) && ${ok})) begin`, `                if (${lineOk}) begin`, `                    ${firstX} = ${x};`,
        `                    ${firstExpected} = ${expected};`, `                    ${firstActual} = ${pixel};`, '                end', `                ${lineOk} = 1'b0;`, '            end',
        '        end', `        if (!${lineOk}) $display("ST_PROTOCOL_DETAIL|%m|line|frame=%0d|y=%0d|x=%0d|expected=%h|actual=%h", ${frame}, ${y}, ${firstX}, ${firstExpected}, ${firstActual});`,
        `        ${checkLine(context.path, 'line', "1'b1", lineOk)}`, '    end', 'end');
    return { declarations, statements: transactionBlock(prefix, 0, step.timeout, lines) };
}
