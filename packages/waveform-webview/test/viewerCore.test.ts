import assert from 'node:assert/strict';
import test from 'node:test';

const waveCore = require('../src/viewer-core.ts') as {
    majorTickStep(range: number): number;
    snapSelectionTime(time: number, range: number, minimum: number, maximum: number, pixelWidth: number): number;
    nearestTransitionTime(series: unknown, time: number, minimum: number, maximum: number, bitIndex?: number): number | null;
    decodeWindowPayload(payload: unknown): {
        kind: 'raw' | 'summary';
        width: number;
        changes?: Array<{ time: number; value: string }>;
    };
};

test('snaps only within three screen pixels of a visible grid line', () => {
    assert.equal(waveCore.majorTickStep(800), 100);
    assert.equal(waveCore.snapSelectionTime(137, 800, 0, 1000, 800), 137);
    assert.equal(waveCore.snapSelectionTime(139, 800, 0, 1000, 800), 139);
    assert.equal(waveCore.snapSelectionTime(128, 800, 0, 1000, 800), 125);
    assert.equal(waveCore.snapSelectionTime(128.1, 800, 0, 1000, 800), 128);
    assert.equal(waveCore.snapSelectionTime(127, 800, 0, 1000, 1600), 127);
    assert.equal(waveCore.snapSelectionTime(139, 80, 0, 1000, 800), 139);
    assert.equal(waveCore.snapSelectionTime(140.2, 80, 0, 1000, 800), 140);
    assert.equal(waveCore.snapSelectionTime(151, 800, 13, 1000, 800), 150);
    assert.equal(waveCore.snapSelectionTime(-20, 800, 13, 997, 800), 13);
    assert.equal(waveCore.snapSelectionTime(1000, 800, 13, 997, 800), 997);
    assert.equal(waveCore.snapSelectionTime(3.4, 1, 0, 10, 800), 3);
    assert.equal(waveCore.snapSelectionTime(3.6, 1, 0, 10, 800), 4);
    assert.equal(waveCore.snapSelectionTime(13, 40, 0, 100, 800), 13);
    assert.equal(waveCore.snapSelectionTime(137, 800, 0, 1000, 0), 137);
    const time = Number.MAX_SAFE_INTEGER - 101;
    assert.ok(Number.isSafeInteger(waveCore.snapSelectionTime(time, 800, 0, Number.MAX_SAFE_INTEGER, 800)));
});

test('finds real transitions near the click without snapping to initialization or repeated values', () => {
    const series = { kind: 'raw', width: 1, changes: [
        { time: 0, value: '0' },
        { time: 100, value: '0' },
        { time: 137, value: '1' },
        { time: 141, value: '1' },
        { time: 143, value: '0' },
        { time: 220, value: 'x' },
        { time: 230, value: 'z' },
    ] };
    assert.equal(waveCore.nearestTransitionTime(series, 140, 134, 146), 137);
    assert.equal(waveCore.nearestTransitionTime(series, 141.8, 135.8, 147.8), 143);
    assert.equal(waveCore.nearestTransitionTime(series, 150, 144, 156), null);
    assert.equal(waveCore.nearestTransitionTime(series, 0, 0, 6), null);
    assert.equal(waveCore.nearestTransitionTime(series, 100, 94, 106), null);
    assert.equal(waveCore.nearestTransitionTime(series, 224, 218, 230), 220);
    assert.equal(waveCore.nearestTransitionTime(series, 230, 224, 236), 230);
    assert.equal(waveCore.nearestTransitionTime(series, 140, 138, 146), 143, 'exclude edges outside the viewport');
    assert.equal(waveCore.nearestTransitionTime(null, 140, 134, 146), null);
});

test('expanded bus bits snap only to transitions of that bit', () => {
    const series = { kind: 'raw', width: 2, changes: [
        { time: 0, value: 'b00' },
        { time: 137, value: 'b01' },
        { time: 140, value: 'b11' },
        { time: 160, value: 'b10' },
    ] };
    assert.equal(waveCore.nearestTransitionTime(series, 138, 132, 144), 137);
    assert.equal(waveCore.nearestTransitionTime(series, 138, 132, 144, 1), 140);
    assert.equal(waveCore.nearestTransitionTime(series, 138, 132, 144, 0), 137);
    assert.equal(waveCore.nearestTransitionTime(series, 160, 154, 166, 1), null);
});

test('summary windows snap to proven boundary changes, never to ambiguous dense block endpoints', () => {
    const series = { kind: 'summary', width: 2, records: [
        { firstTime: 0, lastTime: 90, firstValue: '00', lastValue: '00', flags: 0 },
        { firstTime: 100, lastTime: 110, firstValue: '00', lastValue: '00', flags: 0 },
        { firstTime: 137, lastTime: 139, firstValue: '01', lastValue: '11', flags: 1 },
        { firstTime: 143, lastTime: 150, firstValue: '10', lastValue: '10', flags: 0 },
    ] };
    assert.equal(waveCore.nearestTransitionTime(series, 138, 132, 144), 137);
    assert.equal(waveCore.nearestTransitionTime(series, 138, 132, 144, 1), null);
    assert.equal(waveCore.nearestTransitionTime(series, 150, 144, 156), null);
    assert.equal(waveCore.nearestTransitionTime(series, 100, 94, 106), null);
});

test('locates nearby edges in a million-record signal without scanning the whole signal', () => {
    let reads = 0;
    const changes = new Proxy({ length: 1_000_000 }, {
        get(target, property) {
            if (property === 'length') return target.length;
            reads++;
            const index = Number(property);
            return { time: index * 10, value: String(index % 2) };
        },
    });
    assert.equal(waveCore.nearestTransitionTime({ kind: 'raw', width: 1, changes }, 9_999_952, 9_999_946, 9_999_958), 9_999_950);
    assert.ok(reads < 80, `Expected a local binary search, read ${reads} records`);
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
