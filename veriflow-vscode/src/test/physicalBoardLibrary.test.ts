import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { UserPhysicalBoardLibrary } from '../archDesign/physicalBoardLibrary';

async function main(): Promise<void> {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'veriflow-user-boards-'));
    try {
        const configPath = path.join(directory, 'user.json'), source = path.join(directory, 'source');
        await fs.mkdir(source);
        await fs.writeFile(configPath, JSON.stringify({ lib_dirs: ['keep'], language: 'zh', other: { keep: true } }));
        const model = { kind: 'board', vendor: 'amd', device: 'xcau15p-ffvb676-2-i',
            rails: [{ id: 'v', millivolts: 3300 }], banks: [{ id: '84', supplyRail: 'v' }],
            fpgaPins: [{ id: 'W16', bank: '84' }, { id: 'Y16', bank: '84' }], interfaces: [{ id: 'UART', definition: 'uart.json' }],
            routes: [{ interface: 'UART', member: 'tx', pin: 'W16' }, { interface: 'UART', member: 'rx', pin: 'Y16' }] };
        await fs.writeFile(path.join(source, 'board.json'), JSON.stringify(model));
        await fs.writeFile(path.join(source, 'uart.json'), JSON.stringify({ kind: 'fixed', signals: ['tx', 'rx'], function: { uart: { tx: 'output', rx: 'input' } } }));
        const library = new UserPhysicalBoardLibrary({ configPath, interfaceRoot: source });
        await library.importBoard(path.join(source, 'board.json'), 'My UART board', 'uart-board');
        assert.equal(library.list()[0].id, 'uart-board');
        assert.equal(library.load('uart-board').model.device, model.device);
        const config = JSON.parse(await fs.readFile(configPath, 'utf8'));
        assert.deepEqual(config.lib_dirs, ['keep']); assert.deepEqual(config.other, { keep: true });
        assert.equal(config.boards[0].definitions['uart.json'].kind, 'fixed');
        const original = library.list()[0];
        const edited = structuredClone(original); edited.name = 'UART revision 2';
        library.saveBoard(edited, original);
        assert.equal(library.list()[0].name, 'UART revision 2');
        assert.equal(JSON.parse(await fs.readFile(configPath + '.bak', 'utf8')).boards[0].name, 'My UART board');
        assert.throws(() => library.saveBoard(original, original), /changed/);
        const invalid = structuredClone(edited); invalid.model.routes[1].pin = 'W16';
        assert.throws(() => library.saveBoard(invalid, edited), /same interface|重复/);
        assert.equal(library.list()[0].name, 'UART revision 2');
        library.saveTemplate('uart-custom', 'My UART', original.definitions['uart.json']);
        assert.equal(library.templates()[0].name, 'My UART');
        assert.deepEqual(library.load('uart-board').model, model);
        const portable = path.join(directory, 'portable.json');
        await fs.writeFile(portable, JSON.stringify(edited));
        const importedId = await library.importBoard(portable, 'Portable', 'portable');
        assert.deepEqual(library.load(importedId).model, model);
        library.deleteBoard(importedId, library.list().find(b => b.id === importedId)!);
        assert.equal(library.list().length, 1);
        const stableConfig = await fs.readFile(configPath, 'utf8');
        await fs.rename(configPath + '.bak', configPath + '.previous');
        await fs.mkdir(configPath + '.bak');
        assert.throws(() => library.saveBoard({ ...edited, name: 'Failed write' }, library.get('uart-board')));
        assert.equal(await fs.readFile(configPath, 'utf8'), stableConfig, 'failed backup must leave the current configuration untouched');
        await fs.rename(configPath + '.bak', path.join(directory, 'backup-conflict'));
        await fs.rename(configPath + '.previous', configPath + '.bak');
        const snapshot = structuredClone(edited); snapshot.id = 'template-snapshot';
        snapshot.model.interfaces[0].definition = 'user-interfaces/uart-custom.json';
        snapshot.definitions = { 'user-interfaces/uart-custom.json': original.definitions['uart.json'] };
        library.saveBoard(snapshot);
        const updatedTemplate = structuredClone(original.definitions['uart.json']); updatedTemplate.function!.uart.tx = 'input';
        library.saveTemplate('uart-custom', 'Updated UART', updatedTemplate);
        assert.equal(library.load(snapshot.id).definitions.UART.function!.uart.tx, 'output', 'template edits must not change existing board snapshots');
        library.deleteBoard(snapshot.id, library.get(snapshot.id));
        await fs.rename(source, path.join(directory, 'relocated-source'));
        const secondProject = new UserPhysicalBoardLibrary({ configPath, interfaceRoot: source });
        assert.deepEqual(secondProject.load('uart-board').model, library.load('uart-board').model, 'board must be independent of project and original files');
        await assert.rejects(() => library.importBoard(path.join(directory, 'relocated-source/board.json'), 'Duplicate', 'uart-board'), /already exists/);
        await fs.writeFile(configPath, '{invalid');
        await assert.rejects(() => library.importBoard(path.join(directory, 'relocated-source/board.json')), /JSON/);
        assert.equal(await fs.readFile(configPath, 'utf8'), '{invalid', 'invalid user config must not be overwritten');
        console.log('User physical board library import, cross-project reuse, snapshots and configuration preservation passed');
    } finally {
        assert.equal(path.dirname(directory), os.tmpdir());
        await fs.rm(directory, { recursive: true, force: true });
    }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
