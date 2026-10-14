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
    routes: ['data0_p', 'data0_n', 'data1_p', 'data1_n', 'data2_p', 'data2_n'].map((member, index) => ({ interface: 'VIDEO', member, pin: `A${index + 1}` })),
};
const video = {
    kind: 'fixed', signals: ['data0_p', 'data0_n', 'data1_p', 'data1_n', 'data2_p', 'data2_n'],
    function: { lvds: Object.fromEntries(['data0_p', 'data0_n', 'data1_p', 'data1_n', 'data2_p', 'data2_n'].map(m => [m, 'output'])) },
    differentialPairs: [0, 1, 2].map(i => ({ positive: `data${i}_p`, negative: `data${i}_n` })),
    bus: { data_p: ['data2_p', 'data1_p', 'data0_p'], data_n: ['data2_n', 'data1_n', 'data0_n'] },
};
test('one differential bus binding maps P/N by declared HDL indices and exports six pins', () => {
    assert.equal(typeof pins.bindPhysicalSignal, 'function');
    const catalog = pins.createPhysicalBoard(board, { 'video.json': video });
    const ports = [{ name: 'tmds_data_p', direction: 'output' as const, indices: [2, 1, 0] }, { name: 'tmds_data_n', direction: 'output' as const, indices: [2, 1, 0] }];
    const bindings = pins.bindPhysicalSignal(catalog, ports, 'VIDEO', 'data_p', 'tmds_data_p');
    assert.equal(bindings.length, 6);
    assert.deepEqual(bindings[0], { source: { interface: 'VIDEO', member: 'data2_p' }, port: { name: 'tmds_data_p', bit: 2 } });
    const result = pins.generateXdc(catalog, { board: 'board.json', bindings }, ports);
    assert.equal(result.diagnostics.length, 0);
    assert.match(result.text!, /PACKAGE_PIN A5 \[get_ports \{tmds_data_p\[2\]\}\]/);
    assert.match(result.text!, /IOSTANDARD LVDS/);
});
test('bus aliases follow ascending/nonzero HDL ranges; missing or mismatched N is rejected', () => {
    const catalog = pins.createPhysicalBoard(board, { 'video.json': video });
    const ports = ['p', 'n'].map(leg => ({ name: `video_${leg}`, direction: 'output' as const, indices: [4, 5, 6] }));
    const bindings = pins.bindPhysicalSignal(catalog, ports, 'VIDEO', 'data_p', 'video_p');
    assert.equal(bindings[0].port.bit, 4);
    assert.equal(bindings[3].port.bit, 4);
    assert.equal(bindings[2].source.member, 'data0_p');
    assert.throws(() => pins.bindPhysicalSignal(catalog, ports.slice(0, 1), 'VIDEO', 'data_p', 'video_p'), /matching differential port/);
    assert.throws(() => pins.bindPhysicalSignal(catalog, [ports[0], { ...ports[1], indices: [6, 5, 4] }], 'VIDEO', 'data_p', 'video_p'), /matching differential port/);
    assert.throws(() => pins.bindPhysicalSignal(catalog, [{ ...ports[0], indices: [1, 0] }], 'VIDEO', 'data_p', 'video_p'), /Width mismatch/);
    assert.throws(() => pins.bindPhysicalSignal(catalog, ports, 'VIDEO', 'data_n', 'video_p'), /polarity/);
});
function expansion() {
    return pins.createPhysicalBoard({ ...board, interfaces: [{ id: 'VIDEO', definition: 'header.json' }] }, {
        'header.json': { kind: 'expansion', signals: video.signals, differentialPairs: video.differentialPairs },
    });
}
test('expansion differential legs can independently carry single-ended signals', () => {
    const catalog = expansion();
    const ports = [{ name: 'gpio', direction: 'output' as const }];
    const bindings = pins.bindPhysicalSignal(catalog, ports, 'VIDEO', 'data0_p', 'gpio');
    assert.equal(bindings.length, 1);
    const result = pins.generateXdc(catalog, { board: 'board.json', bindings }, ports);
    assert.match(result.text!, /IOSTANDARD LVCMOS18/);
    assert.doesNotMatch(result.text!, /A2|LVDS/);
});
test('interface/group selection reuses manual bindings and matches a differential bus once', () => {
    const catalog = pins.createPhysicalBoard(board, { 'video.json': { ...video, groups: [{ id: 'data', members: ['data_p', 'data_n'] }] } });
    const ports = ['p', 'n'].map(leg => ({ name: `tmds_data_${leg}`, direction: 'output' as const, indices: [2, 1, 0] }));
    const bindings = pins.bindPhysicalGroup(catalog, ports, 'VIDEO', 'data');
    assert.equal(bindings.length, 6);
    assert.equal(pins.bindPhysicalGroup(catalog, ports, 'VIDEO', 'data', bindings).length, 0);
    assert.throws(() => pins.bindPhysicalGroup(catalog, [...ports, { ...ports[0], name: 'other_data_p' }], 'VIDEO', 'data'), /ambiguous/);
});
test('numeric buses expand canonical members and allow ordered aliases', () => {
    const def: pins.PhysicalInterface = { kind: 'expansion', signals: ['data'], bus: { data: 3, lane: ['data.0', 'data.1', 'data.2'] } };
    const catalog = pins.createPhysicalBoard({ ...board, differentialPairs: undefined, interfaces: [{ id: 'VIDEO', definition: 'rgb.json' }], routes: [0, 1, 2].map(i => ({ interface: 'VIDEO', member: `data.${i}`, pin: `A${i + 1}` })) }, { 'rgb.json': def });
    const bindings = pins.bindPhysicalSignal(catalog, [{ name: 'rgb', direction: 'output', indices: [2, 1, 0] }], 'VIDEO', 'data', 'rgb');
    assert.deepEqual(bindings.map(b => b.source.member), ['data.2', 'data.1', 'data.0']);
    assert.deepEqual(pins.physicalSignalMembers(def, 'lane'), ['data.0', 'data.1', 'data.2']);
});
test('reservation policy and complete-group requirements control publication', () => {
    const header=expansion(),ports=[{name:'gpio',direction:'output' as const}];
    const bindings=pins.bindPhysicalSignal(header,ports,'VIDEO','data0_p','gpio');
    for(const reservation of ['warn','forbid'] as const) {
        const model={...header.model,fpgaPins:header.model.fpgaPins.map(pin=>pin.id==='A1'?{...pin,reservation}:pin)};
        const result=pins.generateXdc({...header,model},{board:'board.json',bindings},ports);
        assert.equal(result.diagnostics[0].severity,reservation==='warn'?'warning':'error');
        assert.equal(result.text!==undefined,reservation==='warn');
    }
    const together={...header,definitions:{VIDEO:{...header.definitions.VIDEO,groups:[{id:'pair',members:['data0_p','data0_n'],selection:'together' as const}]}}};
    const incomplete=pins.generateXdc(together,{board:'board.json',bindings},ports);
    assert.equal(incomplete.text,undefined);assert.match(incomplete.diagnostics[0].message,/complete group/);
});
test('invalid nested board data and bus aliases are rejected at load time', () => {
    const load = (value: unknown, def: unknown = video) => pins.createPhysicalBoard(value, { 'video.json': def });
    assert.throws(() => load({ ...board, fpgaPins: [{ ...board.fpgaPins[0], allowedIoStandards: ['LVDS'] }, ...board.fpgaPins.slice(1)] }), /Unknown physical field/);
    assert.throws(() => load({ ...board, routes: [{ ...board.routes[0], fpgaElectrical: {} }, ...board.routes.slice(1)] }), /Unknown physical field/);
    assert.throws(() => load({ ...board, clocks: [{ interface: 'VIDEO', member: 'data0_p', frequencyHz: 0 }] }), /clock/);
    assert.throws(() => load(board, { ...video, bus: { repeated: ['data0_p', 'data0_p'] } }), /Duplicate bus member/);
    assert.throws(() => load(board, { ...video, function: { lvds: { ...video.function.lvds, data0_n: 'input' } } }), /pair direction/);
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
    const wrong = pins.generateXdc(catalog, { board: 'board.json', bindings }, ports.map(p => ({ ...p, direction: 'input' as const })));
    assert.equal(wrong.text, undefined);
    assert.match(wrong.diagnostics[0].message, /direction/);
    const swapped = pins.generateXdc(catalog, { board: 'board.json', bindings: bindings.map(b => ({...b, port:{...b.port, name:b.port.name==='data_p'?'data_n':'data_p'}})) }, ports);
    assert.equal(swapped.text,undefined);assert.match(swapped.diagnostics.map(d=>d.message).join('\n'),/polarity/);
    const selectable = pins.createPhysicalBoard({ ...board, rails: [{ id: 'v', millivolts: [1200, 1800] }] }, { 'video.json': video });
    assert.equal(pins.generateXdc(selectable, { board: 'board.json', bindings }, ports).text, undefined);
    assert.equal(pins.generateXdc(selectable, { board: 'board.json', railVoltages: [{ rail: 'v', millivolts: 1800 }], bindings }, ports).diagnostics.length, 0);
    assert.equal(pins.generateXdc(selectable, { board: 'board.json', railVoltages: [{ rail: 'v', millivolts: 3300 }], bindings }, ports).text, undefined);
    const header = expansion(), unknown = { ...header, model: { ...header.model, device: 'unknown-amd-device' } };
    assert.equal(pins.generateXdc(unknown, { board: 'board.json', bindings: [bindings[0]] }, ports).text, undefined);
});
test('actual AU15P HDMI maps six balls and requires actual J22/Bank settings; shared pins conflict', () => {
    const root = path.resolve(__dirname, '../../../../docs/boards/atk-au15p');
    const value = JSON.parse(readFileSync(path.join(root, 'board.json'), 'utf8'));
    const definitions = Object.fromEntries(value.interfaces.map((i: {
        definition: string;
    }) => [i.definition, JSON.parse(readFileSync(path.resolve(root, i.definition), 'utf8'))]));
    const catalog = pins.createPhysicalBoard(value, definitions, 'atk-au15p');
    const ports = ['p', 'n'].map(leg => ({ name: `tmds_data_${leg}`, direction: 'output' as const, indices: [2, 1, 0] }));
    const bindings = pins.bindPhysicalSignal(catalog, ports, 'HDMI_OUT', 'data_p', 'tmds_data_p');
    const config = { board: 'board.json', boardSettings: [{ selector: 'J22', value: 'hdmi' }], railVoltages: [{ rail: 'VCCIO_B64', millivolts: 1800 }], bindings };
    const result = pins.generateXdc(catalog, config, ports);
    assert.equal(result.diagnostics.length, 0);
    assert.match(result.text!, /PACKAGE_PIN AB17 \[get_ports \{tmds_data_p\[2\]\}\]/);
    assert.match(result.text!, /PACKAGE_PIN AC17 \[get_ports \{tmds_data_n\[2\]\}\]/);
    assert.equal(pins.generateXdc(catalog, { ...config, boardSettings: [] }, ports).text, undefined);
    const more = [...ports, { name: 'can_tx', direction: 'output' as const }, { name: 'gpio', direction: 'output' as const }];
    const conflict = pins.generateXdc(catalog, { ...config, boardSettings: [...config.boardSettings, { selector: 'J17', value: 'can' }], railVoltages: [...config.railVoltages, { rail: 'VCCIO_B85', millivolts: 3300 }], bindings: [
            ...bindings, ...pins.bindPhysicalSignal(catalog, more, 'CAN1', 'tx', 'can_tx'), ...pins.bindPhysicalSignal(catalog, more, 'J16', '8', 'gpio'),
        ] }, more);
    assert.equal(conflict.text, undefined);
    assert.match(conflict.diagnostics.map(d => d.message).join('\n'), /Pin conflict: J10/);
    const clockPorts=['p','n'].map(leg=>({name:`clock_${leg}`,direction:'input' as const}));
    const clock=pins.generateXdc(catalog,{...config,railVoltages:[...config.railVoltages,{rail:'VCCIO_B65',millivolts:1800}],bindings:pins.bindPhysicalSignal(catalog,clockPorts,'SYS_CLK','clock_p','clock_p')},clockPorts);
    assert.match(clock.text!,/create_clock -period 10.000000 \[get_ports \{clock_p\}\]/);
    assert.equal((clock.text!.match(/create_clock/g)??[]).length,1);
    const gtPorts=['p','n'].map(leg=>({name:`refclk_${leg}`,direction:'input' as const}));
    const gt=pins.generateXdc(catalog,{...config,bindings:pins.bindPhysicalSignal(catalog,gtPorts,'QSFP','refclk_p','refclk_p')},gtPorts);
    assert.match(gt.text!,/PACKAGE_PIN M7/);assert.doesNotMatch(gt.text!,/IOSTANDARD/);
    const ddrPorts=[{name:'dq',direction:'inout' as const}];
    const ddr=pins.generateXdc(catalog,{...config,bindings:pins.bindPhysicalSignal(catalog,ddrPorts,'DDR4','dq0','dq')},ddrPorts);
    assert.equal(ddr.text,undefined);assert.match(ddr.diagnostics.map(d=>d.message).join('\n'),/DDR\/MIPI IP/);
});
test('AD physical bindings round trip, stay outside RTL fingerprint, and follow scalar changes', () => {
    const base = { ...createEmptyArchDesign('top'), ports: [{ name: 'gpio', direction: 'output' as const }] };
    const physical = { board: 'board.json', bindings: [{ source: { interface: 'J16', member: '5' }, port: { name: 'gpio' } }] };
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
