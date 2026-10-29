import assert from 'node:assert/strict';
import { test } from 'node:test';
import { importPhysicalConstraints, createPhysicalBoard, generateConstraints, bindPhysicalSignal, parsePhysicalConfiguration } from '../src/physicalPins';
import { applyArchDesignEdit, createEmptyArchDesign, parseArchDesignText, serializeArchDesign, semanticArchDesignFingerprint } from '../src/archDesign';
const raw = '# UART\r\nset_property PACKAGE_PIN A1 [get_ports {tx}]\r\nset_property PACKAGE_PIN A2 [get_ports {rx}]\r\nset_property IOSTANDARD LVCMOS33 [get_ports {tx rx}]\r\n';
function uart() {
    return createPhysicalBoard({ ...importPhysicalConstraints(raw, '.xdc'), interfaces: [{ id: 'UART0', signals: [
                    { id: 'tx', direction: 'output', pins: ['A1'] }, { id: 'rx', direction: 'input', pins: ['A2'] },
                ] }] });
}
const ports = [{ name: 'tx', direction: 'output' as const }, { name: 'rx', direction: 'input' as const }];
const bindings = ['tx', 'rx'].map(member => ({ source: { interface: 'UART0', member }, port: { name: member } }));
test('UART import preserves original text and shared properties without vendor fields', () => {
    const board = uart();
    assert.equal(generateConstraints(board, { board: 'b.json', bindings }, ports).text, raw);
    assert.deepEqual(Object.keys(board.model), ['kind', 'extension', 'constraints', 'interfaces']);
});
test('filters unused pins and rewrites selected port targets only', () => {
    const output = generateConstraints(uart(), { board: 'b.json', bindings: [{ source: { interface: 'UART0', member: 'tx' }, port: { name: 'serial_tx' } }] }, [{ name: 'serial_tx', direction: 'output' }]);
    assert.deepEqual(output.diagnostics, []);
    assert.equal(output.text, '# UART\r\nset_property PACKAGE_PIN A1 [get_ports {serial_tx}]\r\nset_property IOSTANDARD LVCMOS33 [get_ports {serial_tx}]\r\n');
});
test('dictionary and multiline XDC preserve property values comments and formatting', () => {
    const text = 'set_property -dict {PACKAGE_PIN A1 IOSTANDARD LVCMOS33} [get_ports {tx}]; # tx stays in comment\ncreate_clock -period 10 \\\n [get_ports {tx}]\n';
    const board = createPhysicalBoard({ ...importPhysicalConstraints(text, '.xdc'), interfaces: uart().model.interfaces });
    assert.equal(generateConstraints(board, { board: 'b', bindings: [bindings[0]] }, ports).text, text);
});
test('buses bind by declared RTL index order and validate direction width and pin conflicts', () => {
    const board = createPhysicalBoard({ kind: 'board', extension: '.pcf', constraints: 'set_io {{PORT:A1}} {{PIN:A1}}\nset_io {{PORT:A2}} {{PIN:A2}}\n', interfaces: [{ id: 'GPIO', signals: [{ id: 'data', direction: 'output', pins: ['A1', 'A2'] }] }] });
    const ps = [{ name: 'data', direction: 'output' as const, indices: [4, 5] }];
    const bs = bindPhysicalSignal(board, ps, 'GPIO', 'data', 'data');
    assert.equal(generateConstraints(board, { board: 'b', bindings: bs }, ps).text, 'set_io data[4] A1\nset_io data[5] A2\n');
    assert.throws(() => bindPhysicalSignal(board, [{ ...ps[0], indices: [0] }], 'GPIO', 'data', 'data'), /width/i);
    assert.equal(generateConstraints(board, { board: 'b', bindings: [...bs, bs[0]] }, ps).text, undefined);
    assert.equal(generateConstraints(board, { board: 'b', bindings: bs }, [{ ...ps[0], direction: 'input' }]).text, undefined);
});
test('daughtercard logical pins map to physical carrier pins with no carrier electrical overlay', () => {
    const card = { ...importPhysicalConstraints('set_property PACKAGE_PIN P1 [get_ports tx]\n', '.xdc', 'daughtercard'), interfaces: [{ id: 'UART', signals: [{ id: 'tx', direction: 'output' as const, pins: ['P1'] }] }] };
    const board = { ...uart(), cards: { card0: card } };
    const config = { board: 'b', cards: [{ id: 'card0', board: 'card.json', connections: [{ cardPin: 'P1', boardPin: 'A2' }] }], bindings: [{ source: { card: 'card0', interface: 'UART', member: 'tx' }, port: { name: 'tx' } }] };
    assert.equal(generateConstraints(board, config, ports).text, '# UART\r\nset_property PACKAGE_PIN A2 [get_ports tx]\n');
    assert.equal(generateConstraints(board, { ...config, bindings: [...config.bindings, bindings[1]] }, ports).text, undefined);
    assert.equal(generateConstraints(board, { ...config, cards: [{ ...config.cards[0], connections: [] }] }, ports).text, undefined);
});
test('dynamic Tcl targets fail with actionable diagnostics and are never executed', () => {
    const board = createPhysicalBoard({ ...uart().model, constraints: 'set_property PACKAGE_PIN A1 [get_ports $port]\n' });
    const result = generateConstraints(board, { board: 'b', bindings: [bindings[0]] }, ports);
    assert.equal(result.text, undefined);
    assert.match(result.diagnostics.map(d => d.message).join('\n'), /dynamic|literal/i);
});
test('vector targets remain literal Tcl words when the imported scalar target is bare or quoted', () => {
    for (const target of ['tx', '"tx"', '{tx}']) {
        const board = createPhysicalBoard({ ...uart().model, constraints: `set_property PACKAGE_PIN A1 [get_ports ${target}]\n` });
        const result = generateConstraints(board, { board: 'b', bindings: [{ source: { interface: 'UART0', member: 'tx' }, port: { name: 'data', bit: 4 } }] }, [{ name: 'data', direction: 'output', indices: [4] }]);
        assert.equal(result.text, 'set_property PACKAGE_PIN A1 [get_ports {data[4]}]\n');
    }
});
test('explicit XDC anchors work and pin-like text outside the assignment remains unchanged', () => {
    const board = createPhysicalBoard({ ...uart().model, constraints: 'set_property PACKAGE_PIN {{PIN:A1}} [get_ports {{PORT:A1}}]\n' });
    assert.equal(generateConstraints(board, { board: 'b', bindings: [bindings[0]] }, ports).text, 'set_property PACKAGE_PIN A1 [get_ports tx]\n');
});
test('quoted bus sources, list spacing and pin property strings survive unchanged mapping', () => {
    const text = 'set_property -dict {PACKAGE_PIN A1 IOSTANDARD LVCMOS33} [get_ports {data[4]}]\nset_property SLEW SLOW [get_ports {  data[4]  }]\n';
    const board = createPhysicalBoard({ ...uart().model, constraints: text });
    assert.equal(generateConstraints(board, { board: 'b', bindings: [{ source: { interface: 'UART0', member: 'tx' }, port: { name: 'data', bit: 4 } }] }, [{ name: 'data', direction: 'output', indices: [4] }]).text, text);
});
test('multiple get_ports queries are diagnosed rather than partially renamed', () => {
    const board = createPhysicalBoard({ ...uart().model, constraints: uart().model.constraints + 'set_false_path -from [get_ports tx] -to [get_ports rx]\n' });
    const result = generateConstraints(board, { board: 'b', bindings }, ports);
    assert.equal(result.text, undefined);
    assert.match(result.diagnostics.map(d => d.message).join(' '), /multiple|anchors/i);
});
test('daughtercard concatenation cannot turn a final carrier comment into card constraint text', () => {
    const carrier = { ...uart(), model: { ...uart().model, constraints: 'set_property PACKAGE_PIN A1 [get_ports tx]\n# carrier end' }, cards: { c: { ...importPhysicalConstraints('set_property PACKAGE_PIN P1 [get_ports tx]', '.xdc', 'daughtercard'), interfaces: [{ id: 'UART', signals: [{ id: 'tx', direction: 'output' as const, pins: ['P1'] }] }] } } };
    const result = generateConstraints(carrier, { board: 'b', cards: [{ id: 'c', board: 'c.json', connections: [{ cardPin: 'P1', boardPin: 'A1' }] }], bindings: [{ source: { card: 'c', interface: 'UART', member: 'tx' }, port: { name: 'tx' } }] }, ports);
    assert.equal(result.text, '# carrier end\nset_property PACKAGE_PIN A1 [get_ports tx]');
});
test('AD bindings round trip remain outside RTL fingerprint and follow scalar renames', () => {
    const base = { ...createEmptyArchDesign('top'), ports: [ports[0]] };
    const physical = parsePhysicalConfiguration({ board: 'user:b', bindings: [bindings[0]] });
    const stored = applyArchDesignEdit(base, { type: 'setPhysical', physical });
    const parsed = parseArchDesignText(serializeArchDesign(stored));
    assert.equal(parsed.status, 'editable');
    if (parsed.status === 'editable')
        assert.deepEqual(parsed.design.physical, physical);
    assert.equal(semanticArchDesignFingerprint(base), semanticArchDesignFingerprint(stored));
    assert.equal(applyArchDesignEdit(stored, { type: 'updatePort', name: 'tx', port: { name: 'serial_tx', direction: 'output' } }).physical?.bindings[0].port.name, 'serial_tx');
});
