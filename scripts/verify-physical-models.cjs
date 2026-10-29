// Validate the unpublished V1 profile contract without relying on generated build output.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const root = path.resolve(__dirname, '..');
const read = file => JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));
const Ajv = createRequire(path.join(root, 'veriflow-vscode/package.json'))('ajv');
const shape = new Ajv({ strict: false, allErrors: true }).compile(read('packages/schematic-core/schemas/physical-interface-model.schema.json'));
for (const name of ['carrier.board.json', 'uart.daughtercard.json']) {
    const model = read('data/physical-models/examples/' + name);
    assert.ok(shape(model), JSON.stringify(shape.errors));
    assert.equal(new Set(model.interfaces.map(i => i.id)).size, model.interfaces.length);
    for (const iface of model.interfaces) {
        assert.equal(new Set(iface.signals.map(s => s.id)).size, iface.signals.length);
        const pins = iface.signals.flatMap(s => s.pins);
        assert.equal(new Set(pins).size, pins.length);
    }
    for (const field of ['vendor', 'device', 'banks', 'rails', 'definitions']) assert.equal(shape({ ...model, [field]: 'unsupported' }), false);
}
console.log('Constraint profiles V1: local UART interfaces, board and daughtercard shapes passed.');
