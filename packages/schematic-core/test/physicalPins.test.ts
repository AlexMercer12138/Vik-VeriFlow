import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as pins from '../src/physicalPins';
import { applyArchDesignEdit, createEmptyArchDesign, parseArchDesignText, serializeArchDesign, semanticArchDesignFingerprint } from '../src/archDesign';
import { readFileSync } from 'node:fs';
import path from 'node:path';
const board = {
    kind: 'board', vendor: 'amd', device: 'xcau15p-ffvb676-2-i',
    rails: [{ id: 'v', millivolts: 1800 }], banks: [{ id: '64', supplyRail: 'v' }],
    fpgaPins: ['A1', 'A2', 'A3', 'A4', 'A5', 'A6'].map(id => ({ id, bank: '64' })),
    differentialPairs: [{ positive: 'A1', negative: 'A2' }, { positive: 'A3', negative: 'A4' }, { positive: 'A5', negative: 'A6' }],
    interfaces: [{ id: 'VIDEO', definition: 'video.json' }],
    routes: ['data_p.0', 'data_n.0', 'data_p.1', 'data_n.1', 'data_p.2', 'data_n.2'].map((member, index) => ({ interface: 'VIDEO', member, pin: `A${index + 1}` })),
};
const video = {
    kind: 'fixed', signals: ['data_p', 'data_n'],
    function: { lvds: { data_p: 'output', data_n: 'output' } },
    differentialPairs: [{ positive: 'data_p', negative: 'data_n' }],
    bus: { data_p: 3, data_n: 3 },
};

test('board instances reference a connected subset of a reusable interface', () => {
    const template = { ...video, signals: [...video.signals, 'ddc_scl', 'ddc_sda', 'hpd'],
        function: { source: { ...video.function.lvds, ddc_scl: 'inout', ddc_sda: 'inout', hpd: 'input' } },
        groups: [{ id: 'data', members: ['data_p', 'data_n'] }, { id: 'ddc', members: ['ddc_scl', 'ddc_sda'], selection: 'together' }],
    };
    const model = { ...board, interfaces: [{ id: 'VIDEO', definition: 'video.json', signals: ['data_p', 'data_n'] }] };
    const catalog = pins.createPhysicalBoard(model, { 'video.json': template });
    assert.deepEqual(catalog.definitions.VIDEO.signals, ['data_p', 'data_n']);
    assert.deepEqual(catalog.definitions.VIDEO.function, { source: video.function.lvds });
    assert.deepEqual(catalog.definitions.VIDEO.groups?.map(g => g.id), ['data']);
    assert.equal(template.signals.length, 5, 'subsets must not modify the shared template');
    assert.throws(() => pins.createPhysicalBoard({ ...model, interfaces: [{ ...model.interfaces[0], signals: ['data_p'] }] }, { 'video.json': template }), /complete differential pair/i);
    assert.throws(() => pins.createPhysicalBoard({ ...model, interfaces: [{ ...model.interfaces[0], signals: ['ddc_scl'] }] }, { 'video.json': template }), /complete group/i);
    assert.throws(() => pins.createPhysicalBoard({ ...model, interfaces: [{ ...model.interfaces[0], signals: ['missing'] }] }, { 'video.json': template }), /Unknown interface signal/);
    assert.throws(() => pins.createPhysicalBoard({ ...model, routes: model.routes.slice(1) }, { 'video.json': template }), /No route/);
});

test('IO standards are explicit and filtered by the selected board voltage', () => {
    const model = { ...board, banks: [{ id: '84', supplyRail: 'v' }],
        rails: [{ id: 'v', millivolts: [1800, 3300] }], fpgaPins: board.fpgaPins.map(p => ({ ...p, bank: '84' })) };
    const catalog = pins.createPhysicalBoard(model, { 'video.json': { kind: 'expansion', signals: video.signals, bus: video.bus } });
    const config = { board: 'user:custom', railVoltages: [{ rail: 'v', millivolts: 3300 }], bindings: [] };
    const options = pins.physicalIoStandards(catalog, config, 'VIDEO', 'data_p.0');
    assert.deepEqual(options.map(o => o.name), ['LVCMOS33', 'LVTTL']);
    const ports = [{ name: 'gpio', direction: 'output' as const }];
    const bindings = pins.bindPhysicalSignal(catalog, ports, 'VIDEO', 'data_p.0', 'gpio');
    assert.match(pins.generateXdc(catalog, { ...config, bindings }, ports).diagnostics.map(d => d.message).join('\n'), /Choose IO standard/);
    const chosen = { ...config, bindings, ioStandards: [{ interface: 'VIDEO', member: 'data_p.0', standard: 'LVTTL' }] };
    assert.match(pins.generateXdc(catalog, chosen, ports).text!, /IOSTANDARD LVTTL/);
    assert.equal(pins.generateXdc(catalog, { ...chosen, railVoltages: [{ rail: 'v', millivolts: 1800 }] }, ports).text, undefined);
});

test('hardware selection never requires an RTL assignment or an IO standard', () => {
    const catalog = pins.createPhysicalBoard({ ...board, rails: [{ id: 'v', millivolts: [1200, 1800] }] }, { 'video.json': video });
    const selected = pins.setPhysicalSelection(catalog, { board: 'user:test', bindings: [] }, 'VIDEO', ['data_p.0'], true);
    assert.deepEqual(selected.selections?.[0].members, ['data_p.0', 'data_n.0']);
    assert.deepEqual(selected.bindings, []);
});

test('IO standard changes follow fixed P/N buses and stay limited to selected board voltages', () => {
    const catalog = pins.createPhysicalBoard(board, { 'video.json': video });
    const selected = pins.setPhysicalSelection(catalog, { board: 'user:test', bindings: [] }, 'VIDEO', ['data_p.2', 'data_p.1', 'data_p.0'], true);
    const configured = pins.setPhysicalIoStandard(catalog, selected, 'VIDEO', ['data_p.2', 'data_p.1', 'data_p.0'], 'LVDS');
    assert.equal(configured.ioStandards?.length, 6);
    assert.ok(configured.ioStandards?.every(e => e.standard === 'LVDS'));
    assert.throws(() => pins.setPhysicalIoStandard(catalog, configured, 'VIDEO', ['data_p.2'], 'TMDS_33'), /Bank voltage/);
    const cleared = pins.setPhysicalIoStandard(catalog, configured, 'VIDEO', ['data_n.2'], '');
    assert.equal(cleared.ioStandards?.length, 4);
    assert.equal(pins.setPhysicalSelection(catalog, configured, 'VIDEO', ['data_p.2'], false).ioStandards?.length, 4);
});

test('a shared supply voltage applies to every Bank and custom boards use device Bank rules', () => {
    const catalog = pins.createPhysicalBoard({ ...board, device: 'xcku-other-package', rails: [{ id: 'v', millivolts: [1800, 3300] }],
        banks: [{ id: '1', type: 'hr', supplyRail: 'v' }, { id: '2', type: 'hr', supplyRail: 'v' }],
        fpgaPins: board.fpgaPins.map((pin, i) => ({ ...pin, bank: i < 2 ? '1' : '2' })), differentialPairs: undefined,
    }, { 'video.json': { kind: 'expansion', signals: video.signals, bus: video.bus } });
    const config = { board: 'user:other', bindings: [], railVoltages: [{ rail: 'v', millivolts: 3300 }] };
    for (const member of ['data_p.0', 'data_p.1'])
        assert.deepEqual(pins.physicalIoStandards(catalog, config, 'VIDEO', member).map(o => o.name), ['LVCMOS33', 'LVTTL']);
    assert.deepEqual(pins.physicalIoStandards(catalog, { ...config, railVoltages: [] }, 'VIDEO', 'data_p.0'), []);
});

test('HD Bank differential clock inputs require clock-capable pins and exclude HR-only outputs', () => {
    const model = { ...board, rails: [{ id: 'v', millivolts: 2500 }], banks: [{ id: '85', supplyRail: 'v', type: 'hd' }],
        fpgaPins: board.fpgaPins.map(p => ({ ...p, bank: '85', clockCapable: ['A1', 'A2'].includes(p.id) })) };
    const definition = { ...video, function: { receiver: { data_p: 'input', data_n: 'input' } } };
    const catalog = pins.createPhysicalBoard(model, { 'video.json': definition });
    assert.ok(pins.physicalIoStandards(catalog, { board: 'test', bindings: [] }, 'VIDEO', 'data_p.0').some(o => o.name === 'LVDS_25'));
    assert.ok(!pins.physicalIoStandards(catalog, { board: 'test', bindings: [] }, 'VIDEO', 'data_p.1').some(o => o.name === 'LVDS_25'));
    assert.ok(!pins.physicalIoStandards(catalog, { board: 'test', bindings: [] }, 'VIDEO', 'data_p.0', 'output').some(o => ['LVDS_25', 'TMDS_33'].includes(o.name)));
});

test('selection reserves pins before assignments and closes mandatory groups transitively', () => {
    const model = { ...board, differentialPairs: undefined,
        interfaces: [{ id: 'A', definition: 'header.json' }, { id: 'B', definition: 'header.json' }],
        routes: ['A', 'B'].flatMap(iface => ['a', 'b', 'c'].map((member, i) => ({ interface: iface, member, pin: `A${i + 1}` }))),
    };
    const header = { kind: 'expansion', signals: ['a', 'b', 'c'], groups: [
        { id: 'ab', members: ['a', 'b'], selection: 'together' }, { id: 'bc', members: ['b', 'c'], selection: 'together' },
    ] };
    const catalog = pins.createPhysicalBoard(model, { 'header.json': header });
    const initial = { board: 'user:test', bindings: [] };
    const selected = pins.setPhysicalSelection(catalog, initial, 'A', ['a'], true);
    assert.deepEqual(selected.selections, [{ interface: 'A', members: ['a', 'b', 'c'] }]);
    assert.deepEqual(selected.bindings, [], 'selection must not assign RTL ports');
    assert.throws(() => pins.setPhysicalSelection(catalog, selected, 'B', ['c'], true), /Pin conflict/);
    const released = pins.setPhysicalSelection(catalog, selected, 'A', ['c'], false);
    assert.deepEqual(released.selections, []);
    assert.equal(pins.setPhysicalSelection(catalog, released, 'B', ['a'], true).selections?.[0].interface, 'B');
    const errors = pins.generateXdc(catalog, selected, []).diagnostics;
    assert.ok(errors.some(d => /Unassigned/.test(d.message)));
});

test('selection closes fixed pairs without reserving unused expansion mates', () => {
    const header = expansion();
    const selected = pins.setPhysicalSelection(header, { board: 'user:test', bindings: [] }, 'VIDEO', ['data_p.0'], true);
    assert.deepEqual(selected.selections?.[0].members, ['data_p.0']);
    const fixed = pins.createPhysicalBoard(board, { 'video.json': video });
    assert.deepEqual(pins.setPhysicalSelection(fixed, { board: 'user:test', bindings: [] }, 'VIDEO', ['data_p.2'], true).selections?.[0].members, ['data_p.2', 'data_n.2']);
});
const io = (bindings: readonly pins.PhysicalBinding[], standard: string) => bindings.map(b => ({ ...b.source, standard }));

test('one differential bus binding maps P/N by declared HDL indices and exports six pins', () => {
    assert.equal(typeof pins.bindPhysicalSignal, 'function');
    const catalog = pins.createPhysicalBoard(board, { 'video.json': video });
    const ports = [{ name: 'tmds_data_p', direction: 'output' as const, indices: [2, 1, 0] }, { name: 'tmds_data_n', direction: 'output' as const, indices: [2, 1, 0] }];
    const bindings = pins.bindPhysicalSignal(catalog, ports, 'VIDEO', 'data_p', 'tmds_data_p');
    assert.equal(bindings.length, 6);
    assert.deepEqual(bindings[0], { source: { interface: 'VIDEO', member: 'data_p.2' }, port: { name: 'tmds_data_p', bit: 2 } });
    const result = pins.generateXdc(catalog, { board: 'board.json', bindings, ioStandards: io(bindings, 'LVDS') }, ports);
    assert.equal(result.diagnostics.length, 0);
    assert.match(result.text!, /PACKAGE_PIN A5 \[get_ports \{tmds_data_p\[2\]\}\]/);
    assert.match(result.text!, /IOSTANDARD LVDS/);
});
test('buses follow ascending/nonzero HDL ranges; missing or mismatched N is rejected', () => {
    const catalog = pins.createPhysicalBoard(board, { 'video.json': video });
    const ports = ['p', 'n'].map(leg => ({ name: `video_${leg}`, direction: 'output' as const, indices: [4, 5, 6] }));
    const bindings = pins.bindPhysicalSignal(catalog, ports, 'VIDEO', 'data_p', 'video_p');
    assert.equal(bindings[0].port.bit, 4);
    assert.equal(bindings[3].port.bit, 4);
    assert.equal(bindings[2].source.member, 'data_p.0');
    assert.throws(() => pins.bindPhysicalSignal(catalog, ports.slice(0, 1), 'VIDEO', 'data_p', 'video_p'), /matching differential port/);
    assert.throws(() => pins.bindPhysicalSignal(catalog, [ports[0], { ...ports[1], indices: [6, 5, 4] }], 'VIDEO', 'data_p', 'video_p'), /matching differential port/);
    assert.throws(() => pins.bindPhysicalSignal(catalog, [{ ...ports[0], indices: [1, 0] }], 'VIDEO', 'data_p', 'video_p'), /Width mismatch/);
    assert.throws(() => pins.bindPhysicalSignal(catalog, ports, 'VIDEO', 'data_n', 'video_p'), /polarity/);
});
function expansion() {
    return pins.createPhysicalBoard({ ...board, interfaces: [{ id: 'VIDEO', definition: 'header.json' }] }, {
        'header.json': { kind: 'expansion', signals: video.signals, bus: video.bus, differentialPairs: video.differentialPairs },
    });
}
test('expansion differential legs can independently carry single-ended signals', () => {
    const catalog = expansion();
    const ports = [{ name: 'gpio', direction: 'output' as const }];
    const bindings = pins.bindPhysicalSignal(catalog, ports, 'VIDEO', 'data_p.0', 'gpio');
    assert.equal(bindings.length, 1);
    const result = pins.generateXdc(catalog, { board: 'board.json', bindings, ioStandards: io(bindings, 'LVCMOS18') }, ports);
    assert.match(result.text!, /IOSTANDARD LVCMOS18/);
    assert.doesNotMatch(result.text!, /A2|LVDS/);
});

test('expansion differential input standards require both legs and matching RTL directions', () => {
    const catalog = pins.createPhysicalBoard({ ...board, rails: [{ id: 'v', millivolts: 2500 }],
        banks: [{ id: '85', type: 'hd', supplyRail: 'v' }],
        fpgaPins: board.fpgaPins.map(p => ({ ...p, bank: '85', clockCapable: true })),
    }, { 'video.json': { kind: 'expansion', signals: video.signals, bus: video.bus, differentialPairs: video.differentialPairs } });
    const ports = [{ name: 'ref_p', direction: 'input' as const }, { name: 'ref_n', direction: 'input' as const }];
    const bindings = ['p', 'n'].map((leg, i) => ({ source: { interface: 'VIDEO', member: 'data_' + leg + '.0' }, port: { name: ports[i].name } }));
    const complete = { board: 'user:test', bindings, ioStandards: io(bindings, 'LVDS_25') };
    assert.ok(pins.generateXdc(catalog, complete, ports).text);
    const incomplete = { ...complete, bindings: bindings.slice(0, 1) };
    assert.match(pins.generateXdc(catalog, incomplete, ports).diagnostics.map(d => d.message).join('\n'), /Incomplete or incorrect differential pair/);

    const hp = expansion();
    const mixed = [ports[0], { ...ports[1], direction: 'output' as const }];
    assert.match(pins.generateXdc(hp, { ...complete, ioStandards: io(bindings, 'LVDS') }, mixed).diagnostics.map(d => d.message).join('\n'), /Incomplete or incorrect differential pair/);
});
test('interface/group selection reuses manual bindings and matches a differential bus once', () => {
    const catalog = pins.createPhysicalBoard(board, { 'video.json': { ...video, groups: [{ id: 'data', members: ['data_p', 'data_n'] }] } });
    const ports = ['p', 'n'].map(leg => ({ name: `tmds_data_${leg}`, direction: 'output' as const, indices: [2, 1, 0] }));
    const bindings = pins.bindPhysicalGroup(catalog, ports, 'VIDEO', 'data');
    assert.equal(bindings.length, 6);
    assert.equal(pins.bindPhysicalGroup(catalog, ports, 'VIDEO', 'data', bindings).length, 0);
    assert.throws(() => pins.bindPhysicalGroup(catalog, [...ports, { ...ports[0], name: 'other_data_p' }], 'VIDEO', 'data'), /ambiguous/);
});
test('numeric buses expand canonical members and reject alias arrays', () => {
    const def: pins.PhysicalInterface = { kind: 'expansion', signals: ['data'], bus: { data: 3 } };
    const catalog = pins.createPhysicalBoard({ ...board, differentialPairs: undefined, interfaces: [{ id: 'VIDEO', definition: 'rgb.json' }], routes: [0, 1, 2].map(i => ({ interface: 'VIDEO', member: `data.${i}`, pin: `A${i + 1}` })) }, { 'rgb.json': def });
    const bindings = pins.bindPhysicalSignal(catalog, [{ name: 'rgb', direction: 'output', indices: [2, 1, 0] }], 'VIDEO', 'data', 'rgb');
    assert.deepEqual(bindings.map(b => b.source.member), ['data.2', 'data.1', 'data.0']);
    assert.throws(() => pins.createPhysicalBoard(catalog.model, { 'rgb.json': { ...def, bus: { data: ['data.0', 'data.1', 'data.2'] } } }), /Invalid bus width/);
});
test('reservation policy and complete-group requirements control publication', () => {
    const header=expansion(),ports=[{name:'gpio',direction:'output' as const}];
    const bindings=pins.bindPhysicalSignal(header,ports,'VIDEO','data_p.0','gpio');
    for(const reservation of ['warn','forbid'] as const) {
        const model={...header.model,fpgaPins:header.model.fpgaPins.map(pin=>pin.id==='A1'?{...pin,reservation}:pin)};
        const result=pins.generateXdc({...header,model},{board:'board.json',bindings,ioStandards:io(bindings,'LVCMOS18')},ports);
        assert.equal(result.diagnostics[0].severity,reservation==='warn'?'warning':'error');
        assert.equal(result.text!==undefined,reservation==='warn');
    }
    const together={...header,definitions:{VIDEO:{...header.definitions.VIDEO,groups:[{id:'pair',members:['data_p.0','data_n.0'],selection:'together' as const}]}}};
    const incomplete=pins.generateXdc(together,{board:'board.json',bindings,ioStandards:io(bindings,'LVCMOS18')},ports);
    assert.equal(incomplete.text,undefined);assert.match(incomplete.diagnostics.map(d=>d.message).join('\n'),/complete group/);
});
test('invalid nested board data and bus aliases are rejected at load time', () => {
    const load = (value: unknown, def: unknown = video) => pins.createPhysicalBoard(value, { 'video.json': def });
    assert.throws(() => load({ ...board, fpgaPins: [{ ...board.fpgaPins[0], allowedIoStandards: ['LVDS'] }, ...board.fpgaPins.slice(1)] }), /Unknown physical field/);
    assert.throws(() => load({ ...board, routes: [{ ...board.routes[0], fpgaElectrical: {} }, ...board.routes.slice(1)] }), /Unknown physical field/);
    assert.throws(() => load({ ...board, clocks: [{ interface: 'VIDEO', member: 'data_p.0', frequencyHz: 0 }] }), /clock/);
    assert.throws(() => load(board, { ...video, bus: { repeated: ['data_p.0', 'data_p.0'] } }), /Invalid bus width/);
    assert.throws(() => load(board, { ...video, function: { lvds: { ...video.function.lvds, data_n: 'input' } } }), /pair direction/);
});

test('board interfaces accept workspace paths and library interfaces only', () => {
    const load = (definition: string) => pins.createPhysicalBoard({ ...board, interfaces: [{ id: 'VIDEO', definition }] }, { [definition]: video });
    for (const reference of ['../video.json', 'library:interfaces/video.fixed.json'])
        assert.equal(load(reference).definitions.VIDEO.kind, 'fixed');
    for (const reference of ['library:interfaces/../boards/board.json', 'library:boards/board.json', 'https://example.com/video.json', 'D:/video.json', '/video.json', 'video\n.json'])
        assert.throws(() => load(reference), /Invalid board interface/);
});
test('export blocks pin conflicts, unresolved voltages, wrong directions and incomplete pairs', () => {
    const catalog = pins.createPhysicalBoard(board, { 'video.json': video });
    const ports = ['p', 'n'].map(leg => ({ name: `data_${leg}`, direction: 'output' as const, indices: [2, 1, 0] }));
    const bindings = pins.bindPhysicalSignal(catalog, ports, 'VIDEO', 'data_p', 'data_p');
    const incomplete = pins.generateXdc(catalog, { board: 'board.json', bindings: bindings.slice(0, 1) }, ports);
    assert.equal(incomplete.text, undefined);
    assert.match(incomplete.diagnostics.map(d => d.message).join('\n'), /Incomplete/);
    const duplicate = pins.generateXdc(catalog, { board: 'board.json', bindings: [...bindings, bindings[0]] }, ports);
    assert.equal(duplicate.text, undefined);
    assert.match(duplicate.diagnostics.map(d => d.message).join('\n'), /Pin conflict/);
    const wrong = pins.generateXdc(catalog, { board: 'board.json', bindings, ioStandards: io(bindings, 'LVDS') }, ports.map(p => ({ ...p, direction: 'input' as const })));
    assert.equal(wrong.text, undefined);
    assert.match(wrong.diagnostics[0].message, /direction/);
    const swapped = pins.generateXdc(catalog, { board: 'board.json', bindings: bindings.map(b => ({...b, port:{...b.port, name:b.port.name==='data_p'?'data_n':'data_p'}})) }, ports);
    assert.equal(swapped.text,undefined);assert.match(swapped.diagnostics.map(d=>d.message).join('\n'),/polarity/);
    const selectable = pins.createPhysicalBoard({ ...board, rails: [{ id: 'v', millivolts: [1200, 1800] }] }, { 'video.json': video });
    assert.equal(pins.generateXdc(selectable, { board: 'board.json', bindings, ioStandards: io(bindings, 'LVDS') }, ports).text, undefined);
    assert.equal(pins.generateXdc(selectable, { board: 'board.json', railVoltages: [{ rail: 'v', millivolts: 1800 }], bindings, ioStandards: io(bindings, 'LVDS') }, ports).diagnostics.length, 0);
    assert.equal(pins.generateXdc(selectable, { board: 'board.json', railVoltages: [{ rail: 'v', millivolts: 3300 }], bindings }, ports).text, undefined);
    const header = expansion(), unknown = { ...header, model: { ...header.model, device: 'unknown-amd-device' } };
    assert.equal(pins.generateXdc(unknown, { board: 'board.json', bindings: [bindings[0]] }, ports).text, undefined);
});
test('AU15P uses reusable definitions and user-selected standards without jumper profiles', () => {
    const root = path.resolve(__dirname, '../../../../data/physical-models/boards/atk-au15p');
    const value = JSON.parse(readFileSync(path.join(root, 'board.json'), 'utf8'));
    const definitions = Object.fromEntries(value.interfaces.map((i: { definition: string }) => [i.definition,
        JSON.parse(readFileSync(i.definition.startsWith('library:interfaces/') ? path.resolve(root, '../../interfaces', i.definition.slice('library:interfaces/'.length)) : path.resolve(root, i.definition), 'utf8'))]));
    const catalog = pins.createPhysicalBoard(value, definitions);
    const ports = ['p', 'n'].map(leg => ({ name: 'tmds_data_' + leg, direction: 'output' as const, indices: [2, 1, 0] }));
    const bindings = pins.bindPhysicalSignal(catalog, ports, 'HDMI_OUT', 'data_p', 'tmds_data_p');
    const config = { board: 'board.json', railVoltages: [{ rail: 'VCCIO_B64', millivolts: 1800 }], bindings, ioStandards: io(bindings, 'LVDS') };
    const result = pins.generateXdc(catalog, config, ports);
    assert.equal(result.diagnostics.length, 0);
    assert.match(result.text!, /PACKAGE_PIN AB17 \[get_ports \{tmds_data_p\[2\]\}\]/);
    assert.match(result.text!, /PACKAGE_PIN AC17 \[get_ports \{tmds_data_n\[2\]\}\]/);
    assert.equal('selectors' in value, false);
    const selected = pins.setPhysicalSelection(catalog, { board: 'user:test', bindings: [] }, 'HDMI_OUT', ['data_p.2'], true);
    assert.throws(() => pins.setPhysicalSelection(catalog, selected, 'MIPI_DSI', ['data_p.3'], true), /Pin conflict/);
    const more = [...ports, { name: 'can_tx', direction: 'output' as const }, { name: 'gpio', direction: 'output' as const }];
    const conflict = pins.generateXdc(catalog, { ...config, railVoltages: [...config.railVoltages, { rail: 'VCCIO_B85', millivolts: 3300 }], bindings: [
        ...bindings, ...pins.bindPhysicalSignal(catalog, more, 'CAN1', 'tx', 'can_tx'), ...pins.bindPhysicalSignal(catalog, more, 'J16', '8', 'gpio'),
    ] }, more);
    assert.match(conflict.diagnostics.map(d => d.message).join('\n'), /Pin conflict: J10/);
    const clockPorts = ['p', 'n'].map(leg => ({ name: 'clock_' + leg, direction: 'input' as const }));
    const clockBindings = pins.bindPhysicalSignal(catalog, clockPorts, 'SYS_CLK', 'clock_p', 'clock_p');
    const clock = pins.generateXdc(catalog, { ...config, railVoltages: [...config.railVoltages, { rail: 'VCCIO_B65', millivolts: 1800 }],
        bindings: clockBindings, ioStandards: io(clockBindings, 'LVDS') }, clockPorts);
    assert.match(clock.text!, /create_clock -period 10.000000 \[get_ports \{clock_p\}\]/);
    assert.equal((clock.text!.match(/create_clock/g) ?? []).length, 1);
    const gtPorts = ['p', 'n'].map(leg => ({ name: 'refclk_' + leg, direction: 'input' as const }));
    const gtBindings = pins.bindPhysicalSignal(catalog, gtPorts, 'QSFP', 'refclk_p', 'refclk_p');
    const gt = pins.generateXdc(catalog, { ...config, bindings: gtBindings, ioStandards: io(gtBindings, 'GT') }, gtPorts);
    assert.match(gt.text!, /PACKAGE_PIN M7/); assert.doesNotMatch(gt.text!, /IOSTANDARD/);
    const ddrPorts = [{ name: 'dq', direction: 'inout' as const }];
    assert.ok(pins.physicalIoStandards(catalog, config, 'DDR4', 'dq.0', 'inout').some(o => o.name === 'SSTL12_DCI'));
    const ddrBindings = pins.bindPhysicalSignal(catalog, ddrPorts, 'DDR4', 'dq.0', 'dq');
    const ddr = pins.generateXdc(catalog, { ...config, bindings: ddrBindings, ioStandards: io(ddrBindings, 'SSTL12_DCI') }, ddrPorts);
    assert.doesNotMatch(ddr.diagnostics.map(d => d.message).join('\n'), /profile/);
});

test('AD physical bindings round trip, stay outside RTL fingerprint, and follow scalar changes', () => {
    const base = { ...createEmptyArchDesign('top'), ports: [{ name: 'gpio', direction: 'output' as const }] };
    const physical = { board: 'user:board', selections: [{ interface: 'J16', members: ['5'] }], bindings: [{ source: { interface: 'J16', member: '5' }, port: { name: 'gpio' } }] };
    const stored = applyArchDesignEdit(base, { type: 'setPhysical', physical });
    const parsed = parseArchDesignText(serializeArchDesign(stored));
    assert.equal(parsed.status, 'editable');
    if (parsed.status !== 'editable')
        return;
    assert.deepEqual(parsed.design.physical, physical);
    assert.equal(semanticArchDesignFingerprint(base), semanticArchDesignFingerprint(stored));
    const renamed = applyArchDesignEdit(stored, { type: 'updatePort', name: 'gpio', port: { name: 'led', direction: 'output' } });
    assert.equal(renamed.physical?.bindings[0].port.name, 'led');
    assert.equal(applyArchDesignEdit(renamed, { type: 'removePort', name: 'led' }).physical?.bindings.length, 0);
});
test('AD interface prefix changes and removal update flattened port bindings', () => {
    const base = { ...createEmptyArchDesign('top'), interfacePorts: [{ name: 'video', protocol: 'amba.axis', role: 'master' as const, memberPrefix: 'VIDEO', members: [{ member: 'tdata', width: 8 }] }], physical: { board: 'board.json', bindings: [{ source: { interface: 'J16', member: '5' }, port: { name: 'VIDEO_tdata', bit: 0 } }] } };
    const renamed = applyArchDesignEdit(base, { type: 'renameInterfacePort', name: 'video', nextName: 'out', nextMemberPrefix: 'OUT' });
    assert.equal(renamed.physical?.bindings[0].port.name, 'OUT_tdata');
    assert.equal(applyArchDesignEdit(renamed, { type: 'removeInterfacePort', name: 'out' }).physical?.bindings.length, 0);
});
