import type { ProtocolCompileContext, TaskProtocolStep } from '../protocols';

export interface AdvancedCompileInput {
    step: TaskProtocolStep;
    context: ProtocolCompileContext;
    observed: Record<string, string>;
    driven: Record<string, string>;
    fail(field: string, message: string): never;
    fits(value: string, width: number): boolean;
    numeric(value: string, width: number): string;
}

export function transactionBlock(prefix: string, index: number, timeout: number, lines: string[]): string[] {
    const block = `${prefix}_transaction_${index}`;
    return [`begin : ${block}`, '    fork', '        begin', ...lines.map(line => `            ${line}`),
        `            disable ${block};`, '        end', `        begin #(${timeout}); $fatal(1, "ST_PROTOCOL_TIMEOUT|%m"); end`, '    join', 'end'];
}

export function checkLine(path: string, suffix: string, expected: string, actual: string, controls = "1'b1"): string {
    return `$display("ST_PROTOCOL_CHECK|%m|${suffix}|%0d|%b|%b", ((${actual} === (${expected})) && (${controls})), (${expected}), ${actual}); if (!(((${actual} === (${expected})) && (${controls})) === 1'b1)) $fatal(1, "Protocol expectation failed: %m");`;
}

export function responseBits(response: unknown): string {
    return ({ okay: "2'b00", exokay: "2'b01", slverr: "2'b10", decerr: "2'b11" } as Record<string, string>)[String(response)]!;
}

export function knownInteger(value: string): bigint {
    const text = value.replace(/_/g, '');
    const match = /^(\d+)?'[sS]?([bBoOdDhH])([0-9a-fA-F]+)$/.exec(text);
    if (!match) return BigInt(text);
    const prefix = match[2].toLowerCase() === 'b' ? '0b' : match[2].toLowerCase() === 'o' ? '0o' : match[2].toLowerCase() === 'h' ? '0x' : '';
    return BigInt(prefix + match[3]);
}
