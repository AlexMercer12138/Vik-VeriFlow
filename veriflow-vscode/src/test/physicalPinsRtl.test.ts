import assert from 'node:assert/strict';
import { rtlPhysicalPorts } from '../archDesign/physicalPinsSupport';
assert.deepEqual(rtlPhysicalPorts([{ name: 'data', direction: 'output', width: { kind: 'unknown' }, packedRange: '[LOW:LOW+2]' }], [{ name: 'LOW', defaultExpression: '4' }])[0].indices, [4, 5, 6]);
console.log('RTL binding preserves actual parameterized bus declaration order');
