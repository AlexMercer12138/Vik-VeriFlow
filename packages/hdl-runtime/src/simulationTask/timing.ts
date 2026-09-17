import type { SimulationPreset, TimeScale } from './model';

/** Integer femtoseconds for the supported Verilog time scales. */
export function timeScaleFemtoseconds(scale: TimeScale): number {
    const match = /^(1|10|100)(s|ms|us|ns|ps|fs)$/.exec(scale);
    if (!match) throw new Error(`Invalid timescale: ${scale}`);
    return Number(match[1]) * ({ s: 1e15, ms: 1e12, us: 1e9, ns: 1e6, ps: 1e3, fs: 1 }[match[2]]!);
}

export function numberRatio(value: number): [bigint, bigint] {
    const [mantissa, exponent = '0'] = String(value).toLowerCase().split('e');
    const decimals = (mantissa.split('.')[1]?.length ?? 0) - Number(exponent);
    const digits = BigInt(mantissa.replace('.', ''));
    return decimals >= 0 ? [digits, 10n ** BigInt(decimals)] : [digits * 10n ** BigInt(-decimals), 1n];
}

/** Callers provide nonnegative delays with a terminating decimal representation. */
export function decimalRatio(numerator: bigint, denominator: bigint): string {
    if (denominator <= 0n) throw new Error('Delay denominator must be positive');
    let text = String(numerator / denominator);
    let remainder = numerator % denominator;
    if (remainder === 0n) return text;
    text += '.';
    while (remainder !== 0n) {
        if (text.length > 128) throw new Error('Delay cannot be represented as an exact decimal');
        remainder *= 10n;
        text += String(remainder / denominator);
        remainder %= denominator;
    }
    return text;
}

/** Round each half period to the nearest task tick, with exact half ticks rounded up. */
export function clockTiming(preset: Extract<SimulationPreset, { kind: 'clock' }>, unit: TimeScale, precision: TimeScale = '1ps'):
    { halfPeriod: string; period: string } {
    if (!Number.isFinite(preset.frequencyMHz) || preset.frequencyMHz <= 0) throw new Error('Clock frequency must be positive and finite');
    const unitFs = BigInt(timeScaleFemtoseconds(unit));
    const precisionFs = BigInt(timeScaleFemtoseconds(precision));
    if (precisionFs > unitFs) throw new Error('Time precision cannot be coarser than time unit');
    // MHz gives 500,000,000 femtoseconds per half cycle at 1 MHz. Keep the
    // entered decimal frequency rational until rounding, avoiding binary drift.
    const [n, d] = numberRatio(preset.frequencyMHz);
    const numerator = 500000000n * d;
    const denominator = n * precisionFs;
    const ticks = (2n * numerator + denominator) / (2n * denominator);
    if (ticks === 0n) throw new Error(`Clock half period rounds to zero at ${precision}; choose a finer time precision or lower the frequency`);
    if (ticks > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error(`Clock half period exceeds the safe tick range at ${precision}; choose a coarser time precision or increase the frequency`);
    return {
        halfPeriod: decimalRatio(ticks * precisionFs, unitFs),
        period: decimalRatio(2n * ticks * precisionFs, unitFs),
    };
}
