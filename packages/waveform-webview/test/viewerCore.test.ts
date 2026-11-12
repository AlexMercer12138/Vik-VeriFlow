import assert from 'node:assert/strict';
import test from 'node:test';

const waveCore = require('../src/viewer-core.ts') as {
    majorTickStep(range: number): number;
    snapSelectionTime(time: number, range: number, minimum: number, maximum: number): number;
    decodeWindowPayload(payload: unknown): {
        kind: 'raw' | 'summary';
        width: number;
        changes?: Array<{ time: number; value: string }>;
    };
};

test('snaps selection to quarters of the visible major tick, anchored at zero', () => {
    assert.equal(waveCore.majorTickStep(800), 100);
    assert.equal(waveCore.snapSelectionTime(137, 800, 0, 1000), 125);
    assert.equal(waveCore.snapSelectionTime(139, 800, 0, 1000), 150);
    assert.equal(waveCore.snapSelectionTime(139, 80, 0, 1000), 140);
    assert.equal(waveCore.snapSelectionTime(151, 800, 13, 1000), 150);
    assert.equal(waveCore.snapSelectionTime(-20, 800, 13, 997), 13);
    assert.equal(waveCore.snapSelectionTime(1000, 800, 13, 997), 997);
    assert.equal(waveCore.snapSelectionTime(3.4, 1, 0, 10), 3);
    assert.equal(waveCore.snapSelectionTime(3.6, 1, 0, 10), 4);
    assert.equal(waveCore.snapSelectionTime(13, 40, 0, 100), 13);
    const time = Number.MAX_SAFE_INTEGER - 101;
    assert.ok(Number.isSafeInteger(waveCore.snapSelectionTime(time, 800, 0, Number.MAX_SAFE_INTEGER)));
});

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
