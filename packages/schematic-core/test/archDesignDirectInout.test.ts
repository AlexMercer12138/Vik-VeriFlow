import assert from 'node:assert/strict';
import test from 'node:test';
import {
    applyArchDesignEdit, createEmptyArchDesign, exportArchDesignRtl,
    parseArchDesignValue, projectArchDesignGraph, resolveArchDesign,
    serializeArchDesign, type ArchDesign, type ArchDesignModuleDefinition,
} from '../src/archDesign';
import { layoutSchematic, resolvePinSides } from '../src';
import { pinKey } from '../src/pins';

const io: ArchDesignModuleDefinition = {
    key: 'io.v#io', name: 'io', parameters: [],
    ports: [{ name: 'pad', direction: 'inout', width: { kind: 'known', bits: 8 } }],
};
function parse(ports: unknown[], connections: ArchDesign['connections'] = []): ArchDesign {
    const result = parseArchDesignValue({
        ...createEmptyArchDesign('top'), ports,
        instances: [{ name: 'u_io', module: 'io' }], connections,
    });
    assert.equal(result.status, 'editable');
    if (result.status !== 'editable') throw new Error('invalid');
    return result.design;
}

test('direct inout round trips and resolves one bidirectional value endpoint', () => {
    const design = parse([{ name: 'pad', direction: 'inout', width: 8, inoutMode: 'direct' }]);
    assert.match(serializeArchDesign(design), /"inoutMode": "direct"/);
    const resolved = resolveArchDesign(design, [io]);
    assert.deepEqual(resolved.endpointTargets.filter(item => item.kind === 'port').map(item =>
        [item.signal, item.role]), [['value', 'bidirectional']]);
    assert.deepEqual(resolved.diagnostics, []);
    assert.deepEqual(resolved.effectiveDefaults, []);
});

test('rejects invalid modes and modes on unidirectional ports', () => {
    for (const port of [
        { name: 'pad', direction: 'inout', inoutMode: 'typo' },
        { name: 'pad', direction: 'input', inoutMode: 'direct' },
    ]) {
        const result = parseArchDesignValue({ ...createEmptyArchDesign('top'), ports: [port] });
        assert.equal(result.status, 'invalid');
    }
});

test('inout promotion selects direct mode and keeps module pins on their original side', () => {
    const design = parse([]);
    const promoted = applyArchDesignEdit(design, {
        type: 'promotePort', source: { kind: 'instance', instance: 'u_io', port: 'pad' },
        port: { name: 'pad', direction: 'inout', width: 8 }, connection: 'pad',
    });
    assert.match(serializeArchDesign(promoted), /"inoutMode": "direct"/);
    for (const source of [design, promoted]) {
        const { graph, validation } = projectArchDesignGraph(source, [io], { fileUri: 'top.ad' });
        assert.equal(validation.valid, true);
        const instance = graph.nodes.find(item => item.id === 'instance:u_io')!;
        assert.equal(resolvePinSides(graph).get(pinKey(instance.id, instance.pins[0].id)), 'left');
        const layout = layoutSchematic(graph, undefined, text => text.length * 7);
        assert.equal(layout.nodes.get(instance.id)!.pins[0].side, 'left');
    }
    const { graph } = projectArchDesignGraph(promoted, [io], { fileUri: 'top.ad' });
    assert.equal(graph.nodes.find(item => item.id === 'port:pad')!.pins.length, 1);
    const result = exportArchDesignRtl(promoted, [io]);
    assert.equal(result.status, 'generated');
    if (result.status !== 'generated') return;
    assert.match(result.text, /inout wire \[7:0\] pad/);
    assert.match(result.text, /\.pad\(pad\)/);
    assert.doesNotMatch(result.text, /^wire .*pad;|assign pad =|1'bz|__vf_net_/m);
});

test('direct inout with a distinct connection name reports an explicit synthesis diagnostic', () => {
    const design = parse([{ name: 'pad', direction: 'inout', width: 8, inoutMode: 'direct' }], [{
        name: 'io_bus', endpoints: [
            { kind: 'port', port: 'pad' }, { kind: 'instance', instance: 'u_io', port: 'pad' },
        ],
    }]);
    const result = exportArchDesignRtl(design, [io]);
    assert.equal(result.status, 'invalid');
    if (result.status !== 'invalid') return;
    assert.ok(result.diagnostics.some(item => item.code === 'AD_RTL_INOUT_NET_NAME'
        && item.message.includes('rename io_bus')));
});

test('signal name collisions are explicit and connected same-name ports are reused', () => {
    const base = createEmptyArchDesign('top');
    const design: ArchDesign = { ...base, ports: [{ name: 'input_data', direction: 'input' }],
        connections: [{ name: 'input_data', endpoints: [{ kind: 'port', port: 'input_data' }] }] };
    const exported = exportArchDesignRtl(design, []);
    assert.equal(exported.status, 'generated');
    if (exported.status === 'generated') {
        assert.doesNotMatch(exported.text, /^wire input_data;|assign input_data =|__vf_net_/m);
    }
    for (const collided of [
        { ...design, ports: [...design.ports, { name: 'other', direction: 'input' as const }],
            connections: [{ name: 'other', endpoints: [{ kind: 'port' as const, port: 'input_data' }] }] },
        { ...design, instances: [{ name: 'input_data', module: 'io' }] },
    ]) {
        const result = exportArchDesignRtl(collided, [io]);
        assert.equal(result.status, 'invalid');
        if (result.status === 'invalid') assert.ok(result.diagnostics.some(item => item.code === 'AD_RTL_NAME_COLLISION'));
    }
});

test('inout mode updates require disconnected pins and discard obsolete defaults', () => {
    const initial = parse([{ name: 'pad', direction: 'inout', width: 8 }]);
    const old: ArchDesign = { ...initial, defaults: { 'pad.o': "8'b0" } };
    const direct = applyArchDesignEdit(old, { type: 'updatePort', name: 'pad',
        port: { name: 'pad', direction: 'inout', width: 8, inoutMode: 'direct' } });
    assert.deepEqual(Object.keys(direct.defaults), []);
    assert.equal(resolveArchDesign(direct, [io]).diagnostics.length, 0);
    const connected = applyArchDesignEdit(direct, { type: 'connect',
        source: { kind: 'instance', instance: 'u_io', port: 'pad' },
        target: { kind: 'port', port: 'pad' } });
    assert.equal(connected.connections[0].name, 'pad');
    assert.equal(exportArchDesignRtl(connected, [io]).status, 'generated');
    const before = serializeArchDesign(connected);
    assert.throws(() => applyArchDesignEdit(connected, { type: 'updatePort', name: 'pad',
        port: { name: 'pad', direction: 'inout', width: 8, inoutMode: 'tristate' } }), /Disconnect/);
    assert.equal(serializeArchDesign(connected), before);
});

test('renaming a direct inout updates its same-name connection atomically', () => {
    const design = parse([{ name: 'pad', direction: 'inout', width: 8, inoutMode: 'direct' }], [{
        name: 'pad', endpoints: [{ kind: 'port', port: 'pad' },
            { kind: 'instance', instance: 'u_io', port: 'pad' }],
    }]);
    const edit = { type: 'updatePort' as const, name: 'pad',
        port: { name: 'data', direction: 'inout' as const, width: 8, inoutMode: 'direct' as const } };
    const renamed = applyArchDesignEdit(design, edit);
    assert.equal(renamed.connections[0].name, 'data');
    assert.equal(exportArchDesignRtl(renamed, [io]).status, 'generated');
    const collision: ArchDesign = { ...design, connections: [...design.connections, {
        name: 'data', endpoints: [],
    }] };
    assert.throws(() => applyArchDesignEdit(collision, edit), /Connection/);
    assert.equal(collision.connections[0].name, 'pad');
});

test('direct mode rejects legacy split endpoints and preserves numeric and symbolic widths', () => {
    for (const width of [1, 8, { expression: 'BUS_WIDTH' }]) {
        const design = parse([{ name: 'pad', direction: 'inout', width, inoutMode: 'direct' }]);
        const result = resolveArchDesign(design, [io]);
        const target = result.endpointTargets.find(item => item.kind === 'port')!;
        assert.deepEqual(target.width, typeof width === 'number'
            ? { kind: 'known', bits: width } : { kind: 'symbolic', expression: width.expression });
        const invalid = { ...design, connections: [{ name: 'pad', endpoints: [
            { kind: 'port' as const, port: 'pad', signal: 'i' as const },
        ] }] };
        assert.equal(exportArchDesignRtl(invalid, [io]).status, 'invalid');
    }
});

test('direct top net may connect multiple module inouts without assignments', () => {
    const source = parse([{ name: 'pad', direction: 'inout', width: 8, inoutMode: 'direct' }]);
    const design: ArchDesign = { ...source, instances: [...source.instances, { name: 'u_other', module: 'io' }],
        connections: [{ name: 'pad', endpoints: [
            { kind: 'port', port: 'pad', signal: 'value' },
            { kind: 'instance', instance: 'u_io', port: 'pad' },
            { kind: 'instance', instance: 'u_other', port: 'pad' },
        ] }] };
    const result = exportArchDesignRtl(design, [io]);
    assert.equal(result.status, 'generated');
    if (result.status !== 'generated') return;
    assert.equal(result.text.match(/\.pad\(pad\)/g)?.length, 2);
    assert.doesNotMatch(result.text, /assign /);
});
