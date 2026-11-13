import assert from 'node:assert/strict';
import test from 'node:test';
import { generateConstraints, physicalEndpoint, type PhysicalBoard, type PhysicalConfiguration } from '../src/physicalPins';

test('constraint generation looks up endpoints without rescanning signals per binding', () => {
    let visits = 0;
    const count = 512;
    const signals = Array.from({ length: count }, (_, i) => ({
        get id() { visits++; return 's' + i; },
        direction: 'output' as const,
        pins: ['p' + i],
    }));
    const board: PhysicalBoard = { model: { kind: 'board', extension: '.pcf', pins: Object.fromEntries(signals.map((s, i) => [s.pins[0], 'P' + i + ' {signal name}'])), interfaces: [{ id: 'IO', signals }] } };
    const bindings = signals.map((s, i) => ({ source: { interface: 'IO', member: s.id }, port: { name: 'p' + i } }));
    const configuration: PhysicalConfiguration = { board: 'user:b', bindings };
    visits = 0;
    const start = performance.now();
    const result = generateConstraints(board, configuration, bindings.map(b => ({ name: b.port.name, direction: 'output' as const })));
    console.log(`512-pin generation: ${(performance.now() - start).toFixed(1)} ms, ${visits} signal visits`);
    assert.deepEqual(result.diagnostics, []);
    assert.equal(result.text, signals.map((_, i) => `P${i} p${i}`).join('\n'));
    assert.ok(visits < count * 20, `Expected linear signal visits, got ${visits}`);
    visits = 0;
    assert.equal(physicalEndpoint(board, { interface: 'IO', member: 's511' }).pin, 'p511');
    assert.ok(visits < count * 4, `A single endpoint must not perform nested signal scans: ${visits}`);
});
