import * as assert from 'assert';
const { isFreshWaveform } = require('../workflowArtifact');
assert.strictEqual(isFreshWaveform('builtin', [{ kind: 'vcd', destination: '/wave.vcd', written: false }], '/wave.vcd', 'before', 'before'), false);
assert.strictEqual(isFreshWaveform('builtin', [{ kind: 'vcd', destination: '/wave.vcd', written: true }], '/wave.vcd', 'before', 'before'), true);
assert.strictEqual(isFreshWaveform('custom', [{ kind: 'vcd', destination: '/wave.vcd', written: true }], '/wave.vcd', 'before', 'before'), false);
assert.strictEqual(isFreshWaveform('custom', [{ kind: 'vcd', destination: '/wave.vcd', written: true }], '/wave.vcd', undefined, 'after'), true);
assert.strictEqual(isFreshWaveform('custom', [{ kind: 'vcd', destination: '/wave.vcd', written: true }], '/wave.vcd', 'before', 'after'), true);
assert.strictEqual(isFreshWaveform('builtin', [{ kind: 'vcd', destination: '/different.vcd', written: true }], '/wave.vcd', undefined, 'after'), false);
console.log('Workflow artifact tests passed');
