// Offline checks for the draft data contract; this is not the plugin's loader or generator.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');

const root = path.resolve(__dirname, '..');
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const Ajv = createRequire(path.join(root, 'veriflow-vscode/package.json'))('ajv');
const schema = read(path.join(root, 'docs/schemas/physical-interface-model.schema.json'));
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
collect(path.join(root, 'docs/examples/physical-interfaces'));
collect(path.join(root, 'docs/boards'));
const unique = items => assert.equal(new Set(items).size, items.length, 'Duplicate ID');
const byId = items => { unique(items.map(item => item.id)); return new Map(items.map(item => [item.id, item])); };
function resolve(owner, reference, kind) {
    const file = path.resolve(path.dirname(owner), reference);
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
    return doc;
}
function expand(def, selection) {
    const members = new Set(selection.members ?? []);
    for (const id of selection.groups ?? []) {
        const group = (def.groups ?? []).find(item => item.id === id);
        assert.ok(group, `Unknown group ${id}`);
        group.members.forEach(member => members.add(member));
    }
    let size;
    do {
        size = members.size;
        for (const group of def.groups ?? []) if (group.selection === 'together' && group.members.some(member => members.has(member))) group.members.forEach(member => members.add(member));
        if (def.kind === 'fixed') for (const pair of def.differentialPairs ?? []) {
            if (members.has(pair.positive) || members.has(pair.negative)) { members.add(pair.positive); members.add(pair.negative); }
        }
    } while (size !== members.size);
    for (const member of members) assert.ok(def.signals.includes(member));
    return members;
}
function states(selectors) {
    return selectors.reduce((all, selector) => all.flatMap(state => selector.values.map(value => ({ ...state, [selector.id]: value }))), [{}]);
}
const active = (route, state) => (route.when ?? []).every(condition => state[condition.selector] === condition.value);
for (const [file, doc] of documents) {
    if (['fixed', 'expansion'].includes(doc.kind)) {
        unique(doc.signals);
        byId(doc.groups ?? []);
        for (const group of doc.groups ?? []) for (const member of group.members) assert.ok(doc.signals.includes(member));
        checkPairs(doc.differentialPairs, doc.signals);
        if (doc.kind === 'fixed') {
            const keys = Object.keys(doc);
            assert.equal(keys.indexOf('function'), keys.indexOf('signals') + 1, file);
            for (const directions of Object.values(doc.function)) {
                assert.deepEqual(Object.keys(directions).sort(), [...doc.signals].sort(), file);
                for (const pair of doc.differentialPairs ?? []) assert.equal(directions[pair.positive], directions[pair.negative]);
            }
        }
    } else if (doc.kind === 'board') {
        const pins = byId(doc.fpgaPins), banks = byId(doc.banks ?? []), rails = byId(doc.rails ?? []);
        const interfaces = byId(doc.interfaces), selectors = byId(doc.selectors ?? []);
        checkPairs(doc.differentialPairs, [...pins.keys()]);
        for (const pair of doc.differentialPairs ?? []) assert.equal(pins.get(pair.positive).bank, pins.get(pair.negative).bank);
        for (const pin of pins.values()) if (pin.bank !== undefined) assert.ok(banks.has(pin.bank));
        for (const bank of banks.values()) if (bank.supplyRail !== undefined) assert.ok(rails.has(bank.supplyRail));
        for (const route of doc.routes) {
            assert.ok(interfaces.has(route.interface) && pins.has(route.pin));
            assert.ok(definition(file, interfaces.get(route.interface)).signals.includes(route.member));
            unique((route.when ?? []).map(condition => condition.selector));
            for (const condition of route.when ?? []) assert.ok(selectors.get(condition.selector)?.values.includes(condition.value));
        }
        for (const instance of interfaces.values()) {
            const def = definition(file, instance);
            const routes = doc.routes.filter(route => route.interface === instance.id);
            for (const member of def.signals) assert.ok(routes.some(route => route.member === member), `${file}: missing ${instance.id}.${member}`);
            for (const state of states([...selectors.values()])) {
                const available = routes.filter(route => active(route, state));
                unique(available.map(route => route.member));
                unique(available.map(route => route.pin));
                for (const pair of def.differentialPairs ?? []) {
                    const p = available.find(route => route.member === pair.positive);
                    const n = available.find(route => route.member === pair.negative);
                    assert.equal(Boolean(p), Boolean(n), 'Only one leg of a physical pair is connected');
                    if (p) assert.ok(doc.differentialPairs?.some(pair => pair.positive === p.pin && pair.negative === n.pin), `${file}: pair polarity at ${instance.id}`);
                }
            }
        }
        unique((doc.clocks ?? []).map(clock => `${clock.interface}.${clock.member}`));
        for (const clock of doc.clocks ?? []) {
            const instance = interfaces.get(clock.interface); assert.ok(instance);
            const def = definition(file, instance, 'fixed');
            assert.equal(def.function[instance.function ?? Object.keys(def.function)[0]][clock.member], 'input');
            assert.ok(!(def.differentialPairs ?? []).some(pair => pair.negative === clock.member), 'Clock must reference positive leg');
        }
    } else if (doc.kind === 'daughtercard') {
        const interfaces = byId(doc.interfaces), expansions = byId(doc.expansions);
        unique([...interfaces.keys(), ...expansions.keys()]);
        const mappings = new Map(), used = [];
        for (const mapping of doc.mappings) {
            const iface = definition(file, interfaces.get(mapping.interface), 'fixed');
            const expansion = definition(file, expansions.get(mapping.expansion), 'expansion');
            for (const [signal, member] of Object.entries(mapping.signals)) {
                assert.ok(iface.signals.includes(signal) && expansion.signals.includes(member));
                const key = `${mapping.interface}.${signal}`; assert.ok(!mappings.has(key));
                mappings.set(key, { expansion: mapping.expansion, member });
                used.push(`${mapping.expansion}.${member}`);
            }
        }
        unique(used);
        for (const instance of interfaces.values()) {
            const def = definition(file, instance, 'fixed');
            for (const member of def.signals) assert.ok(mappings.has(`${instance.id}.${member}`));
            for (const pair of def.differentialPairs ?? []) {
                const p = mappings.get(`${instance.id}.${pair.positive}`), n = mappings.get(`${instance.id}.${pair.negative}`);
                assert.equal(p.expansion, n.expansion);
                const expansion = definition(file, expansions.get(p.expansion), 'expansion');
                assert.ok(expansion.differentialPairs?.some(pair => pair.positive === p.member && pair.negative === n.member));
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
        unique((doc.boardSettings ?? []).map(setting => setting.selector));
        for (const setting of doc.boardSettings ?? []) assert.ok(board.selectors?.some(item => item.id === setting.selector && item.values.includes(setting.value)));
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
        for (const binding of doc.bindings ?? []) assert.ok(endpoint(binding.source).signals.includes(binding.source.member));
        assert.ok(fs.existsSync(path.resolve(path.dirname(file), doc.design.path)));
    }
}

// Independent schematic spot checks: CORE 2/3/5/9 and BASE 1/2/3/9/10/11.
const boardFile = path.join(root, 'docs/boards/atk-au15p/board.json');
const board = documents.get(boardFile);
const pin = (iface, member) => board.routes.find(route => route.interface === iface && route.member === member)?.pin;
for (const [iface, member, ball] of [
    ['SYS_CLK','clock_p','V24'], ['SYS_CLK','clock_n','W24'],
    ['UART1','tx','W16'], ['I2C4','scl','AC13'], ['I2C4','sda','AC14'],
    ['DDR4','clk_p','K22'], ['DDR4','dqs0_p','F24'], ['DDR4','dqs1_n','C24'], ['DDR4','dq15','B25'],
    ['HDMI_OUT','data0_p','AC18'], ['HDMI_OUT','clock_p','AD16'], ['HDMI_OUT','data1_p','AF18'], ['HDMI_OUT','data2_p','AB17'],
    ['MIPI_DSI','d2_p','AF18'], ['MIPI_DSI','d3_p','AB17'], ['MIPI_CSI','clk_p','R22'],
    ['J16','5','G10'], ['J16','7','G9'], ['J16','40','J15'],
    ['FMC_LPC','LA00_CC_P','AC19'], ['FMC_LPC','CLK0_M2C_P','AD21'], ['FMC_LPC','CLK1_M2C_P','AD20'],
    ['PCIE','rx0_p','P2'], ['PCIE','rx3_p','Y2'], ['PCIE','rx7_p','AF2'],
    ['QSFP','rx1_p','M2'], ['QSFP','refclk_p','M7'], ['SD','clk','A12'], ['SD','cmd','A13'],
    ['CAN1','tx','J10'], ['RS4851','rx','K10'], ['J19','RXD','J11']
]) assert.equal(pin(iface, member), ball, `${iface}.${member}`);
assert.equal(board.interfaces.length, 19); assert.equal(board.fpgaPins.length, 274); assert.equal(board.routes.length, 302);
assert.deepEqual(board.clocks.map(clock => clock.frequencyHz), [100000000, 156250000]);
assert.deepEqual(board.banks.filter(bank => Number(bank.id) >= 224), [{id:'224'},{id:'225'},{id:'226'}]);
for (const [id, mv] of [['VCCIO_B64',[1200,1800]], ['VCCIO_B65',[1200,1800]], ['DDR_1V2',1200], ['VCCIO_B84',3300], ['VCCIO_B85',[1800,2500,3300]], ['VCCIO_B86',[1800,2500,3300]]]) assert.deepEqual(board.rails.find(rail => rail.id === id).millivolts, mv);
const header = documents.get(path.join(path.dirname(boardFile), 'header40.expansion.json'));
assert.equal(header.signals.length, 36); assert.equal(header.differentialPairs.length, 18);
assert.deepEqual([...expand(header, {members:['5']})], ['5']); // A single-ended use does not occupy its mate.
assert.ok(header.differentialPairs.some(pair => pair.positive === '5' && pair.negative === '7'));
const fmc = documents.get(path.join(path.dirname(boardFile), 'fmc-lpc.expansion.json'));
assert.equal(fmc.signals.length, 75); assert.equal(fmc.differentialPairs.length, 36);
assert.ok(!fmc.signals.some(signal => signal.startsWith('DP')));
const hdmi = documents.get(path.join(path.dirname(boardFile), 'hdmi-tmds.fixed.json'));
assert.deepEqual([...expand(hdmi, {members:['data0_p']})], ['data0_p','data0_n']);
assert.equal(expand(hdmi, {groups:['tmds']}).size, 8);
assert.equal(hdmi.signals.length, 8); // No invented DDC, HPD or CEC wires.
const enabled = (iface, state) => board.routes.filter(route => route.interface === iface && active(route, state));
assert.equal(enabled('HDMI_OUT', {}).length, 0); // Unknown jumper state is not silently inferred.
assert.equal(enabled('HDMI_OUT', {J22:'hdmi'}).length, 8);
assert.equal(enabled('HDMI_OUT', {J22:'dsi'}).length, 0);
assert.equal(enabled('MIPI_DSI', {J22:'hdmi'}).length, 8); // Clock and controls are wired directly.
assert.equal(enabled('MIPI_DSI', {J22:'dsi'}).length, 16);
assert.equal(enabled('CAN1', {J17:'can'}).length, 2);
assert.equal(enabled('CAN1', {J17:'atk'}).length, 0);
assert.equal(enabled('RS4851', {J18:'rs485'}).length, 2);
assert.equal(enabled('J19', {J17:'atk',J18:'atk'}).length, 4);
assert.equal(pin('CAN1','tx'), pin('J16','8')); // Jumpers do not disconnect J16.
assert.equal(pin('SD','cmd'), pin('J16','31'));
assert.equal(pin('MIPI_DSI','tp_scl'), pin('J16','39'));
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
const assembly = structuredClone(documents.get(path.join(root, 'docs/examples/physical-interfaces/demo.assembly.json')));
assembly.bindings[0].ioStandard = 'TMDS_33'; assert.equal(shape(assembly), false);
for (const match of fs.readFileSync(path.join(root, 'docs/physical-interface-model.md'), 'utf8').matchAll(/```json\s*([\s\S]*?)```/g)) {
    const doc = JSON.parse(match[1]);
    const validate = doc.kind ? shape : ajv.getSchema(`${schema.$id}#/definitions/${doc.pin ? 'boardRoute' : 'binding'}`);
    assert.ok(validate(doc), JSON.stringify(validate.errors));
}
console.log(`Validated ${documents.size} model JSON files: schema, references, signals/roles, groups, pairs, Banks/rails, routes, selectors, clocks and assembly links.`);
console.log('AU15P: 19 interfaces, 274 package pins, 302 routes; schematic spot checks, selectable voltages, split expansion pairs and rejection of generator fields passed.');
