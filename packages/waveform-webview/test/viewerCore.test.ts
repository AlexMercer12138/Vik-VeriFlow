import assert from 'node:assert/strict';
import test from 'node:test';

const waveCore = require('../src/viewer-core.ts') as {
    decodeWindowPayload(payload: unknown): {
        kind: 'raw' | 'summary';
        width: number;
        changes?: Array<{ time: number; value: string }>;
    };
};

test('decodes packed four-state waveform values', () => {
    const decoded = waveCore.decodeWindowPayload({
        kind: 'raw',
        width: 4,
        times: [0, 12],
        values: Buffer.from([0x00, 0x4b]).toString('base64'),
        valueStride: 1,
    });
    assert.deepEqual(decoded, {
        kind: 'raw',
        width: 4,
        changes: [
            { time: 0, value: '0000' },
            { time: 12, value: '10xz' },
        ],
    });
});
