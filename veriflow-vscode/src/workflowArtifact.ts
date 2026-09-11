import * as fs from 'fs';
import * as path from 'path';

export function waveIdentity(filepath: string): string | undefined {
    try {
        const stat = fs.statSync(filepath, { bigint: true });
        return stat.isFile() ? `${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeNs}:${stat.ctimeNs}` : undefined;
    } catch { return undefined; }
}

/** Native backends can only report existence; require evidence that this run wrote the file. */
export function isFreshWaveform(backend: string,
    artifacts: readonly { kind: string; destination?: string; written: boolean }[],
    waveFile: string, before: string | undefined, after: string | undefined): boolean {
    const produced = artifacts.some(artifact => artifact.kind === 'vcd' && artifact.written
        && artifact.destination !== undefined && path.resolve(artifact.destination) === path.resolve(waveFile));
    return produced && after !== undefined && (backend === 'builtin' || before !== after);
}
