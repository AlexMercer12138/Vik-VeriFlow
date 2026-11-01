import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { UserPhysicalBoardLibrary } from '../archDesign/physicalBoardLibrary';
async function main() {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'vf-board-library-'));
    try {
        const file = path.join(dir, 'board.json'), configPath = path.join(dir, 'config.json');
        await writeFile(configPath, JSON.stringify({ language: 'zh', other: { keep: true } }));
        await writeFile(file, JSON.stringify({ id:'b', name:'Board', kind: 'board', extension: '.xdc', pins:{A1:'set_property PACKAGE_PIN A1 [get_ports {signal name}]\n'}, interfaces: [{ id: 'UART', signals: [{ id: 'tx', direction: 'output', pins: ['A1'] }] }] }));
        const lib = new UserPhysicalBoardLibrary({ configPath });
        await lib.importBoard(file, 'Board', 'b');
        const original = lib.get('b');
        await writeFile(file, 'removed source');
        assert.equal(lib.load('b').model.interfaces[0].signals[0].pins[0], 'A1');
        lib.saveBoard({ ...original, name: 'Changed' }, original);
        assert.throws(() => lib.saveBoard(original, original), /changed/);
        assert.equal(JSON.parse(await readFile(configPath, 'utf8')).other.keep, true);
        const stable = await readFile(configPath, 'utf8');
        await rm(configPath + '.bak');
        await import('node:fs/promises').then(fs => fs.mkdir(configPath + '.bak'));
        assert.throws(() => lib.saveBoard({ ...lib.get('b'), name: 'Fails' }, lib.get('b')));
        assert.equal(await readFile(configPath, 'utf8'), stable);
        console.log('Board library snapshots, external edits, backup failure and other configuration preservation passed');
    }
    finally {
        await rm(dir, { recursive: true, force: true });
    }
}
main().catch(e => { console.error(e); process.exitCode = 1; });
