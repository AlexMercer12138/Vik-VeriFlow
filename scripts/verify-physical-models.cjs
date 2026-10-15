// Offline checks for model shape and cross-document hardware mappings.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');

const root = path.resolve(__dirname, '..');
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const Ajv = createRequire(path.join(root, 'veriflow-vscode/package.json'))('ajv');
const schema = read(path.join(root, 'data/physical-models/schemas/physical-interface-model.schema.json'));
const ajv = new Ajv({ strict: false, allErrors: true });
const shape = ajv.compile(schema);
const documents = new Map();
function collect(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const file = path.join(directory, entry.name);
        if (entry.isDirectory()) collect(file);
        else if (entry.name.endsWith('.json')) {
            const doc = read(file);
            assert.ok(shape(doc), `${file}: ${JSON.stringify(shape.errors)}`);
            documents.set(file, doc);
        }
    }
}
collect(path.join(root, 'data/physical-models/interfaces'));
collect(path.join(root, 'data/physical-models/boards'));
collect(path.join(root, 'data/physical-models/examples'));
const unique = items => assert.equal(new Set(items).size, items.length, 'Duplicate ID');
const byId = items => { unique(items.map(item => item.id)); return new Map(items.map(item => [item.id, item])); };
const signalMembers = (def, signal) => {
    const bus = Object.hasOwn(def.bus ?? {}, signal) ? def.bus[signal] : undefined;
    return bus === undefined ? [signal] : Array.from({ length: bus }, (_, i) => `${signal}.${bus - 1 - i}`);
};
const members = def => def.signals.flatMap(signal => signalMembers(def, signal));
const pairs = def => (def.differentialPairs ?? []).flatMap(pair => {
    const p = signalMembers(def, pair.positive), n = signalMembers(def, pair.negative);
    assert.equal(p.length, n.length, 'Differential bus widths differ');
    return p.map((positive, i) => ({ positive, negative: n[i] }));
});
const direction = (def, role, member) => def.function[role][def.signals.find(signal => signalMembers(def, signal).includes(member))];
function resolve(owner, reference, kind) {
    const file = reference.startsWith('library:interfaces/')
        ? path.join(root, 'data/physical-models/interfaces', reference.slice('library:interfaces/'.length))
        : path.resolve(path.dirname(owner), reference);
    const doc = documents.get(file);
    assert.ok(doc, `Missing model: ${file}`);
    if (kind) assert.equal(doc.kind, kind, file);
    return [file, doc];
}
function checkPairs(pairs = [], members) {
    unique(pairs.flatMap(pair => [pair.positive, pair.negative]));
    for (const pair of pairs) assert.ok(members.includes(pair.positive) && members.includes(pair.negative));
}
function definition(owner, instance, kind) {
    const [, doc] = resolve(owner, instance.definition, kind);
    assert.ok(['fixed', 'expansion'].includes(doc.kind));
    if (doc.kind === 'fixed') {
        const roles = Object.keys(doc.function);
        assert.ok(instance.function ? roles.includes(instance.function) : roles.length === 1, 'Unknown or ambiguous role');
    } else assert.equal(instance.function, undefined);
    if (!instance.signals) return doc;
    unique(instance.signals);
    assert.ok(instance.signals.length && instance.signals.every(s => doc.signals.includes(s)), 'Unknown interface signal in subset');
    const subset = new Set(instance.signals.flatMap(s => signalMembers(doc, s)));
    if (doc.kind === 'fixed') for (const pair of pairs(doc)) assert.equal(subset.has(pair.positive), subset.has(pair.negative), 'Select complete differential pair');
    const groups = (doc.groups ?? []).map(group => {
        const remaining = group.members.filter(m => signalMembers(doc, m).every(bit => subset.has(bit)));
        assert.ok(group.selection !== 'together' || !remaining.length || remaining.length === group.members.length, 'Select complete group');
        return { ...group, members: remaining };
    }).filter(g => g.members.length);
    return { ...doc, signals: doc.signals.filter(s => instance.signals.includes(s)), groups,
        differentialPairs: (doc.differentialPairs ?? []).filter(pair => [pair.positive, pair.negative].every(s => signalMembers(doc, s).every(m => subset.has(m)))) };
}
function expand(def, selection) {
    const selected = new Set((selection.members ?? []).flatMap(member => signalMembers(def, member)));
    for (const id of selection.groups ?? []) {
        const group = (def.groups ?? []).find(item => item.id === id);
        assert.ok(group, `Unknown group ${id}`);
        group.members.flatMap(member => signalMembers(def, member)).forEach(member => selected.add(member));
    }
    let size;
    do {
        size = selected.size;
        for (const group of def.groups ?? []) {
            const groupMembers = group.members.flatMap(member => signalMembers(def, member));
            if (group.selection === 'together' && groupMembers.some(member => selected.has(member))) groupMembers.forEach(member => selected.add(member));
        }
        if (def.kind === 'fixed') for (const pair of pairs(def)) {
            if (selected.has(pair.positive) || selected.has(pair.negative)) { selected.add(pair.positive); selected.add(pair.negative); }
        }
    } while (size !== selected.size);
    for (const member of selected) assert.ok(members(def).includes(member));
    return selected;
}
for (const [file, doc] of documents) {
    if (['fixed', 'expansion'].includes(doc.kind)) {
        unique(doc.signals);
        const expanded = members(doc); unique(expanded);
        for (const [name, bus] of Object.entries(doc.bus ?? {})) {
            assert.ok(doc.signals.includes(name) && Number.isSafeInteger(bus) && bus > 0 && bus <= 4096, 'Bus must specify a signal width');
        }
        byId(doc.groups ?? []);
        for (const group of doc.groups ?? []) for (const member of group.members.flatMap(member => signalMembers(doc, member))) assert.ok(expanded.includes(member));
        checkPairs(pairs(doc), expanded);
        if (doc.kind === 'fixed') {
            const keys = Object.keys(doc);
            assert.equal(keys.indexOf('function'), keys.indexOf('signals') + 1, file);
            for (const [role, directions] of Object.entries(doc.function)) {
                assert.deepEqual(Object.keys(directions).sort(), [...doc.signals].sort(), file);
                for (const pair of pairs(doc)) assert.equal(direction(doc, role, pair.positive), direction(doc, role, pair.negative));
            }
        }
    } else if (doc.kind === 'board') {
        const pins = byId(doc.fpgaPins), banks = byId(doc.banks ?? []), rails = byId(doc.rails ?? []);
        const interfaces = byId(doc.interfaces);
        checkPairs(doc.differentialPairs, [...pins.keys()]);
        for (const pair of doc.differentialPairs ?? []) assert.equal(pins.get(pair.positive).bank, pins.get(pair.negative).bank);
        for (const pin of pins.values()) if (pin.bank !== undefined) assert.ok(banks.has(pin.bank));
        for (const bank of banks.values()) if (bank.supplyRail !== undefined) assert.ok(rails.has(bank.supplyRail));
        for (const route of doc.routes) {
            assert.ok(interfaces.has(route.interface) && pins.has(route.pin));
            assert.ok(members(definition(file, interfaces.get(route.interface))).includes(route.member));
        }
        for (const instance of interfaces.values()) {
            const def = definition(file, instance);
            const routes = doc.routes.filter(route => route.interface === instance.id);
            for (const member of members(def)) assert.ok(routes.some(route => route.member === member), `${file}: missing ${instance.id}.${member}`);
            unique(routes.map(route => route.member));
            unique(routes.map(route => route.pin));
            for (const pair of pairs(def)) {
                const p = routes.find(route => route.member === pair.positive), n = routes.find(route => route.member === pair.negative);
                assert.ok(p && n, 'Both differential legs must be mapped');
                assert.ok(doc.differentialPairs?.some(pair => pair.positive === p.pin && pair.negative === n.pin), file + ': pair polarity');
            }
        }
        unique((doc.clocks ?? []).map(clock => `${clock.interface}.${clock.member}`));
        for (const clock of doc.clocks ?? []) {
            const instance = interfaces.get(clock.interface); assert.ok(instance);
            const def = definition(file, instance, 'fixed');
            assert.equal(direction(def, instance.function ?? Object.keys(def.function)[0], clock.member), 'input');
            assert.ok(!pairs(def).some(pair => pair.negative === clock.member), 'Clock must reference positive leg');
        }
    } else if (doc.kind === 'daughtercard') {
        const interfaces = byId(doc.interfaces), expansions = byId(doc.expansions);
        unique([...interfaces.keys(), ...expansions.keys()]);
        const mappings = new Map(), used = [];
        for (const mapping of doc.mappings) {
            const iface = definition(file, interfaces.get(mapping.interface), 'fixed');
            const expansion = definition(file, expansions.get(mapping.expansion), 'expansion');
            for (const [signal, member] of Object.entries(mapping.signals)) {
                assert.ok(members(iface).includes(signal) && members(expansion).includes(member));
                const key = `${mapping.interface}.${signal}`; assert.ok(!mappings.has(key));
                mappings.set(key, { expansion: mapping.expansion, member });
                used.push(`${mapping.expansion}.${member}`);
            }
        }
        unique(used);
        for (const instance of interfaces.values()) {
            const def = definition(file, instance, 'fixed');
            for (const member of members(def)) assert.ok(mappings.has(`${instance.id}.${member}`));
            for (const pair of pairs(def)) {
                const p = mappings.get(`${instance.id}.${pair.positive}`), n = mappings.get(`${instance.id}.${pair.negative}`);
                assert.equal(p.expansion, n.expansion);
                const expansion = definition(file, expansions.get(p.expansion), 'expansion');
                assert.ok(pairs(expansion).some(pair => pair.positive === p.member && pair.negative === n.member));
            }
        }
    } else if (doc.kind === 'assembly') {
        const [boardFile, board] = resolve(file, doc.board, 'board');
        const mounts = byId(doc.mounts ?? []), slots = [];
        for (const mount of mounts.values()) {
            const [cardFile, card] = resolve(file, mount.card, 'daughtercard');
            unique(mount.connections.map(connection => connection.cardExpansion));
            assert.equal(mount.connections.length, card.expansions.length);
            for (const connection of mount.connections) {
                const slot = board.interfaces.find(item => item.id === connection.boardInterface);
                const plug = card.expansions.find(item => item.id === connection.cardExpansion);
                definition(boardFile, slot, 'expansion'); definition(cardFile, plug, 'expansion');
                assert.equal(resolve(boardFile, slot.definition)[0], resolve(cardFile, plug.definition)[0]);
                if (mount.installed !== false) slots.push(slot.id);
            }
        }
        unique(slots);
        unique((doc.railVoltages ?? []).map(setting => setting.rail));
        for (const setting of doc.railVoltages ?? []) {
            const rail = board.rails?.find(item => item.id === setting.rail);
            assert.ok(Array.isArray(rail?.millivolts) && rail.millivolts.includes(setting.millivolts));
        }
        function endpoint(source) {
            const mount = source.mount && mounts.get(source.mount);
            if (source.mount) assert.ok(mount);
            const [owner, model] = mount ? resolve(file, mount.card, 'daughtercard') : [boardFile, board];
            return definition(owner, model.interfaces.find(item => item.id === source.interface));
        }
        for (const selection of doc.selections ?? []) expand(endpoint(selection.interface), selection);
        for (const binding of doc.bindings ?? []) assert.ok(members(endpoint(binding.source)).includes(binding.source.member));
        assert.ok(fs.existsSync(path.resolve(path.dirname(file), doc.design.path)));
    }
}

// Independent schematic spot checks: CORE 2/3/5/9 and BASE 1/2/3/9/10/11.
const boardFile = path.join(root, 'data/physical-models/boards/atk-au15p/board.json');
const board = documents.get(boardFile);
const pin = (iface, member) => board.routes.find(route => route.interface === iface && route.member === member)?.pin;
for (const [iface, member, ball] of [
    ['SYS_CLK','clock_p','V24'], ['SYS_CLK','clock_n','W24'],
    ['UART1','tx','W16'], ['I2C4','scl','AC13'], ['I2C4','sda','AC14'],
    ['DDR4','clk_p','K22'], ['DDR4','dqs_p.0','F24'], ['DDR4','dqs_n.1','C24'], ['DDR4','dq.15','B25'],
    ['HDMI_OUT','data_p.0','AC18'], ['HDMI_OUT','clock_p','AD16'], ['HDMI_OUT','data_p.1','AF18'], ['HDMI_OUT','data_p.2','AB17'],
    ['MIPI_DSI','data_p.2','AF18'], ['MIPI_DSI','data_p.3','AB17'], ['MIPI_CSI','clk_p','R22'],
    ['J16','5','G10'], ['J16','7','G9'], ['J16','40','J15'],
    ['FMC_LPC','LA00_CC_P','AC19'], ['FMC_LPC','CLK0_M2C_P','AD21'], ['FMC_LPC','CLK1_M2C_P','AD20'],
    ['PCIE','rx_p.0','P2'], ['PCIE','rx_p.3','Y2'], ['PCIE','rx_p.7','AF2'],
    ['QSFP','rx_p.0','M2'], ['QSFP','refclk_p','M7'], ['SD','clk','A12'], ['SD','cmd','A13'],
    ['CAN1','tx','J10'], ['RS4851','rx','K10'], ['J19','RXD','J11']
]) assert.equal(pin(iface, member), ball, `${iface}.${member}`);
assert.equal(board.interfaces.length, 21); assert.equal(board.fpgaPins.length, 274); assert.equal(board.routes.length, 302);
assert.deepEqual(board.clocks.map(clock => clock.frequencyHz), [100000000, 156250000]);
assert.deepEqual(board.banks.filter(bank => Number(bank.id) >= 224).map(({ type, ...bank }) => bank), [{id:'224'},{id:'225'},{id:'226'}]);
for (const [id, mv] of [['VCCIO_B64',[1200,1800]], ['VCCIO_B65',[1200,1800]], ['DDR_1V2',1200], ['VCCIO_B84',3300], ['VCCIO_B85',[1800,2500,3300]], ['VCCIO_B86',[1800,2500,3300]]]) assert.deepEqual(board.rails.find(rail => rail.id === id).millivolts, mv);
const header = documents.get(path.join(root, 'data/physical-models/interfaces/header40.expansion.json'));
assert.equal(header.signals.length, 36); assert.equal(header.differentialPairs.length, 18);
assert.deepEqual([...expand(header, {members:['5']})], ['5']); // A single-ended use does not occupy its mate.
assert.ok(header.differentialPairs.some(pair => pair.positive === '5' && pair.negative === '7'));
const fmc = documents.get(path.join(root, 'data/physical-models/interfaces/fmc-lpc.expansion.json'));
assert.equal(fmc.signals.length, 75); assert.equal(fmc.differentialPairs.length, 36);
assert.ok(!fmc.signals.some(signal => signal.startsWith('DP')));
const hdmi = definition(boardFile, board.interfaces.find(i => i.id === 'HDMI_OUT'));
assert.deepEqual([...expand(hdmi, {members:['data_p.0']})], ['data_p.0','data_n.0']);
assert.equal(expand(hdmi, {groups:['tmds']}).size, 8);
assert.equal(members(hdmi).length, 8); // No invented DDC, HPD or CEC wires.
assert.equal(board.selectors, undefined);
assert.ok(board.routes.every(route => route.when === undefined));
assert.equal(board.routes.filter(route => route.interface === 'HDMI_OUT').length, 8);
assert.equal(board.routes.filter(route => route.interface === 'MIPI_DSI').length, 10);
assert.equal(pin('CAN1','tx'), pin('J16','8')); // Jumpers do not disconnect J16.
assert.equal(pin('SD','cmd'), pin('J16','31'));
assert.equal(pin('MIPI_DSI_CTRL','tp_scl'), pin('J16','39'));
assert.equal(pin('FMC_LPC','SCL'), pin('I2C4','scl'));
for (const [target, key, value] of [
    [board, 'ioStandards', {}], [board.fpgaPins[0], 'allowedIoStandards', ['LVCMOS33']],
    [board.routes[0], 'fpgaElectrical', {ioStandard:'LVCMOS33'}]
]) {
    const copy = structuredClone(board);
    const object = target === board ? copy : target === board.fpgaPins[0] ? copy.fpgaPins[0] : copy.routes[0];
    object[key] = value; assert.equal(shape(copy), false, `Legacy ${key} accepted`);
}
const missingVendor = structuredClone(board); delete missingVendor.vendor; assert.equal(shape(missingVendor), false);
const upperVendor = structuredClone(board); upperVendor.vendor = 'AMD'; assert.equal(shape(upperVendor), false);
for (const reference of ['../uart.fixed.json', 'library:interfaces/uart.fixed.json']) {
    const copy = structuredClone(board); copy.interfaces[0].definition = reference; assert.ok(shape(copy), `Rejected interface reference: ${reference}`);
}
for (const reference of ['library:interfaces/../boards/board.json', 'library:boards/board.json', 'https://example.com/uart.json', 'D:/uart.json', '/uart.json', 'uart\n.json']) {
    const copy = structuredClone(board); copy.interfaces[0].definition = reference; assert.equal(shape(copy), false, `Accepted invalid interface reference: ${reference}`);
}
const assembly = structuredClone(documents.get(path.join(root, 'data/physical-models/examples/demo.assembly.json')));
assembly.bindings[0].ioStandard = 'TMDS_33'; assert.equal(shape(assembly), false);
for (const match of fs.readFileSync(path.join(root, 'docs/physical-interface-model.md'), 'utf8').matchAll(/```json\s*([\s\S]*?)```/g)) {
    const doc = JSON.parse(match[1]);
    const validate = doc.kind ? shape : ajv.getSchema(`${schema.$id}#/definitions/${doc.pin ? 'boardRoute' : 'binding'}`);
    assert.ok(validate(doc), JSON.stringify(validate.errors));
}
console.log(`Validated ${documents.size} model JSON files: schema, references, signals/roles, groups, pairs, Banks/rails, routes, clocks and assembly links.`);
console.log('AU15P: 21 interfaces, 274 package pins, 302 routes; schematic spot checks, selectable voltages, split expansion pairs and rejection of generator fields passed.');
