import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { runCli } from '../src/main';
test('CLI imports board JSON only and exports an independent daughtercard without mapping', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'vf-template-cli-'));
    let stderr = '';
    const run = (argv: string[]) => { stderr = ''; return runCli(argv, { cwd: dir, homeDir: dir, stdout() { }, stderr: t => { stderr += t; } }); };
    try {
        await writeFile(path.join(dir, 'board.json'), JSON.stringify({ id: 'carrier', name: 'Carrier', kind: 'board', extension: '.xdc', pins: {}, interfaces: [] }));
        await writeFile(path.join(dir, 'card.json'), JSON.stringify({ id: 'card', name: 'Card', kind: 'daughtercard', extension: '.xdc', pins: { tx: 'PIN {pin name} {signal name}\nIO 18 {signal name}\n' }, interfaces: [{ id: 'UART', signals: [{ id: 'tx', direction: 'output', pins: ['tx'] }] }] }));
        assert.equal(await run(['board', 'import', 'board.json']), 0, stderr);
        assert.equal(await run(['board', 'import', 'card.json']), 0, stderr);
        await writeFile(path.join(dir, 'raw.xdc'), 'text');
        assert.equal(await run(['board', 'import', 'raw.xdc']), 1);
        await writeFile(path.join(dir, 'top.v'), "module top(output serial_tx); assign serial_tx=1'b0; endmodule");
        await writeFile(path.join(dir, 'top.pins.json'), JSON.stringify({ board: 'user:carrier', cards: [{ id: 'c', board: 'user:card' }], bindings: [{ source: { card: 'c', interface: 'UART', member: 'tx' }, port: { name: 'serial_tx' }, pin: 'B7' }] }));
        assert.equal(await run(['pins', 'export', 'top.v', '--config', 'top.pins.json']), 0, stderr);
        assert.equal(await readFile(path.join(dir, 'top.xdc'), 'utf8'), 'PIN B7 serial_tx\nIO 18 serial_tx\n');
        assert.equal(await run(['board', 'export', 'user:card', '-o', 'shared.json']), 0, stderr);
        assert.equal(JSON.parse(await readFile(path.join(dir, 'shared.json'), 'utf8')).kind, 'daughtercard');
    }
    finally {
        await rm(dir, { recursive: true, force: true });
    }
});
