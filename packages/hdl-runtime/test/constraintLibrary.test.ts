import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { readPhysicalBoardFile, UserPhysicalBoardLibrary } from '../src/physical/boardLibrary';
test('raw constraint imports preserve extension, other settings, backup and stale edit protection', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'veriflow-constraint-library-'));
    try {
        const source = path.join(root, 'carrier.xdc'), configPath = path.join(root, '.veriflow_config.json');
        await writeFile(source, 'set_property PACKAGE_PIN A1 [get_ports tx]\n');
        await writeFile(configPath, '{"language":"zh-cn","boards":[]}');
        assert.equal((await readPhysicalBoardFile(source)).model.extension, '.xdc');
        const library = new UserPhysicalBoardLibrary({ configPath });
        await library.importBoard(source, 'Carrier', 'carrier');
        const saved = library.get('carrier');
        assert.equal(saved.model.constraints, 'set_property PACKAGE_PIN A1 [get_ports tx]\n');
        assert.equal(JSON.parse(await readFile(configPath, 'utf8')).language, 'zh-cn');
        assert.equal(JSON.parse(await readFile(configPath + '.bak', 'utf8')).language, 'zh-cn');
        library.saveBoard({ ...saved, name: 'Edited' }, saved);
        assert.throws(() => library.saveBoard({ ...saved, name: 'Stale' }, saved), /outside|changed/i);
        await writeFile(path.join(root, 'card.json'), JSON.stringify({ kind: 'daughtercard', extension: '.qsf', constraints: '{{PORT:P1}} {{PIN:P1}}\n', interfaces: [] }));
        await library.importBoard(path.join(root, 'card.json'), 'Card', 'card');
        assert.equal(library.get('card').model.kind, 'daughtercard');
    }
    finally {
        await rm(root, { recursive: true, force: true });
    }
});
