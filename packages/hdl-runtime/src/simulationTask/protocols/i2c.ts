import type { ProtocolCompileResult } from '../protocols';
import { checkLine, transactionBlock, type AdvancedCompileInput } from './types';

export function compileI2cProtocol(input: AdvancedCompileInput): ProtocolCompileResult {
    const { step, context, observed: s, driven: w, fail, fits, numeric } = input;
    if (context.netWidths[s.scl] !== 1 || context.netWidths[s.sda] !== 1) fail('signals', 'I2C SCL and SDA must be scalar resolved nets.');
    if (w.scl === s.scl || w.sda === s.sda) fail('signals', 'I2C requires compiler-provided per-step open-drain write targets.');
    const options = step.options!;
    const half = options.period! / 2;
    const prefix = context.prefix;
    const actual = `${prefix}_actual`;
    const bit = `${prefix}_bit`;
    const address = `${prefix}_address`;
    const writeAddress = `${prefix}_write_address`; const readAddress = `${prefix}_read_address`;
    const declarations = [`reg [7:0] ${actual};`, `integer ${bit};`, `localparam [6:0] ${address} = ${numeric(options.address!, 7)};`,
        `localparam [7:0] ${writeAddress} = {${address}, 1'b0};`, `localparam [7:0] ${readAddress} = {${address}, 1'b1};`];
    for (const [field, values] of [['data', step.data], ['expected', step.expected ?? []]] as const) {
        values.forEach((value, index) => { if (!fits(value, 8)) fail(`${field}[${index}]`, 'I2C byte values must fit 8 bits.'); });
    }
    const lines: string[] = [`${w.scl} <= 1'bz;`, `${w.sda} <= 1'bz;`, `#(${half});`];
    const start = () => lines.push(`${w.sda} <= 1'bz;`, `${w.scl} <= 1'bz;`, `wait (${s.scl} === 1'b1);`, `#(${half});`, `${w.sda} <= 1'b0;`, `#(${half});`, `${w.scl} <= 1'b0;`);
    const stop = () => lines.push(`${w.sda} <= 1'b0;`, `#(${half});`, `${w.scl} <= 1'bz;`, `wait (${s.scl} === 1'b1);`, `#(${half});`, `${w.sda} <= 1'bz;`, `#(${half});`);
    const writeByte = (word: string, suffix: string) => {
        lines.push(`for (${bit} = 7; ${bit} >= 0; ${bit} = ${bit} - 1) begin`,
            `    ${w.sda} <= ${word}[${bit}] ? 1'bz : 1'b0;`, `    #(${half});`, `    ${w.scl} <= 1'bz;`,
            `    wait (${s.scl} === 1'b1);`, `    #(${half});`, `    ${w.scl} <= 1'b0;`, 'end',
            `${w.sda} <= 1'bz;`, `#(${half});`, `${w.scl} <= 1'bz;`, `wait (${s.scl} === 1'b1);`,
            `${actual}[0] = ${s.sda};`, `#(${half});`, `${w.scl} <= 1'b0;`, checkLine(context.path, suffix, "1'b0", `${actual}[0]`));
    };
    const readByte = (expected: string, index: number, last: boolean) => {
        const constant = `${prefix}_expected_${index}`;
        declarations.push(`localparam [7:0] ${constant} = ${numeric(expected, 8)};`);
        lines.push(`${w.sda} <= 1'bz;`, `for (${bit} = 7; ${bit} >= 0; ${bit} = ${bit} - 1) begin`,
            `    #(${half});`, `    ${w.scl} <= 1'bz;`, `    wait (${s.scl} === 1'b1);`, `    ${actual}[${bit}] = ${s.sda};`,
            `    #(${half});`, `    ${w.scl} <= 1'b0;`, 'end',
            checkLine(context.path, `transaction[${index}]`, constant, actual),
            `${w.sda} <= ${last ? "1'bz" : "1'b0"};`, `#(${half});`, `${w.scl} <= 1'bz;`, `wait (${s.scl} === 1'b1);`, `#(${half});`, `${w.scl} <= 1'b0;`, `${w.sda} <= 1'bz;`);
    };
    const receiveByte = (expected: string, index: number) => {
        const constant = `${prefix}_expected_${index}`;
        declarations.push(`localparam [7:0] ${constant} = ${numeric(expected, 8)};`);
        lines.push(`${w.sda} <= 1'bz;`, `for (${bit} = 7; ${bit} >= 0; ${bit} = ${bit} - 1) begin`,
            `    @(posedge ${s.scl});`, `    ${actual}[${bit}] = ${s.sda};`, `    @(negedge ${s.scl});`, 'end',
            checkLine(context.path, `transaction[${index}]`, constant, actual));
        targetAck();
    };
    const targetAck = () => {
        lines.push(`${w.sda} <= ${options.targetAck === false ? "1'bz" : "1'b0"};`, `${w.scl} <= 1'b0;`,
            `#(${(options.stretchCycles ?? 0) * options.period!});`, `${w.scl} <= 1'bz;`,
            `@(posedge ${s.scl});`, `@(negedge ${s.scl});`, `${w.sda} <= 1'bz;`);
    };
    const waitStartAndAddress = (read: boolean, suffix: string) => {
        lines.push(`wait ((${s.scl} === 1'b1) && (${s.sda} === 1'b1));`, `@(negedge ${s.sda});`,
            `for (${bit} = 7; ${bit} >= 0; ${bit} = ${bit} - 1) begin`, `    @(posedge ${s.scl});`, `    ${actual}[${bit}] = ${s.sda};`, `    @(negedge ${s.scl});`, 'end',
            checkLine(context.path, suffix, `{${address}, 1'b${read ? 1 : 0}}`, actual));
        targetAck();
    };
    const sendByte = (word: string, index: number, last: boolean) => {
        const constant = `${prefix}_word_${index}`;
        declarations.push(`localparam [7:0] ${constant} = ${numeric(word, 8)};`);
        lines.push(`for (${bit} = 7; ${bit} >= 0; ${bit} = ${bit} - 1) begin`, `${w.sda} <= ${constant}[${bit}] ? 1'bz : 1'b0;`,
            `    @(posedge ${s.scl});`, `    @(negedge ${s.scl});`, 'end', `${w.sda} <= 1'bz;`, `@(posedge ${s.scl});`, `${actual}[0] = ${s.sda};`,
            checkLine(context.path, `ack[${index}]`, last ? "1'b1" : "1'b0", `${actual}[0]`), `@(negedge ${s.scl});`);
    };

    if (step.role === 'controller') {
        start();
        writeByte(options.write === false ? readAddress : writeAddress, 'addressAck');
        if (options.write !== false) {
            step.data.forEach((value, index) => {
                const name = `${prefix}_word_${index}`; declarations.push(`localparam [7:0] ${name} = ${numeric(value, 8)};`); writeByte(name, `ack[${index}]`);
            });
            if (options.repeatedStart) {
                start(); writeByte(readAddress, 'repeatedAddressAck');
                step.expected!.forEach((value, index) => readByte(value, index, index === step.expected!.length - 1));
            }
        } else step.expected!.forEach((value, index) => readByte(value, index, index === step.expected!.length - 1));
        stop();
    } else {
        waitStartAndAddress(options.write === false, 'address');
        if (options.write !== false) {
            step.expected!.forEach(receiveByte);
            if (options.repeatedStart) {
                waitStartAndAddress(true, 'repeatedAddress');
                step.data.forEach((value, index) => sendByte(value, index, index === step.data.length - 1));
            }
        } else step.data.forEach((value, index) => sendByte(value, index, index === step.data.length - 1));
        lines.push(`${actual}[0] = 1'b0;`, `while (${actual}[0] !== 1'b1) begin`,
            `    @(posedge ${s.sda});`, `    ${actual}[0] = (${s.scl} === 1'b1);`, 'end',
            checkLine(context.path, 'stop', "1'b1", `${actual}[0]`));
    }
    return { declarations, statements: transactionBlock(prefix, 0, step.timeout, lines) };
}
