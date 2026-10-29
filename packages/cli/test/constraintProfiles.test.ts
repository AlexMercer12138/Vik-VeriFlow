import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { runCli } from '../src/main';
test('CLI imports raw constraints and maps a standalone daughtercard through the carrier', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'vf-profile-cli-'));
    let stderr = '';
    const run = (argv: string[]) => { stderr = ''; return runCli(argv, { cwd: dir, homeDir: dir, stdout() { }, stderr: t => { stderr += t; } }); };
    try {
        await writeFile(path.join(dir, 'board.xdc'), 'set_property PACKAGE_PIN A1 [get_ports gpio]\n');
        await writeFile(path.join(dir, 'card.xdc'), 'set_property PACKAGE_PIN P1 [get_ports tx]\n');
        assert.equal(await run(['board', 'import', 'board.xdc', '--id', 'carrier']), 0, stderr);
        assert.equal(await run(['board', 'import', 'card.xdc', '--id', 'serial', '--kind', 'daughtercard']), 0, stderr);
        assert.equal(await run(['board', 'export', 'user:serial', '-o', 'card.json']), 0, stderr);
        const saved = JSON.parse(await readFile(path.join(dir, 'card.json'), 'utf8'));
        assert.equal(saved.model.kind, 'daughtercard');
        saved.model.interfaces = [{ id: 'UART', signals: [{ id: 'tx', direction: 'output', pins: ['P1'] }] }];
        await writeFile(path.join(dir, 'card.json'), JSON.stringify(saved));
        await writeFile(path.join(dir, 'top.v'), 'module top(output serial_tx); assign serial_tx=1\'b0; endmodule');
        await writeFile(path.join(dir, 'top.pins.json'), JSON.stringify({ board: 'user:carrier', cards: [{ id: 'serial0', board: 'card.json', connections: [{ cardPin: 'P1', boardPin: 'A1' }] }], bindings: [{ source: { card: 'serial0', interface: 'UART', member: 'tx' }, port: { name: 'serial_tx' } }] }));
        assert.equal(await run(['pins', 'export', 'top.v', '--config', 'top.pins.json']), 0, stderr);
        assert.equal(await readFile(path.join(dir, 'top.xdc'), 'utf8'), 'set_property PACKAGE_PIN A1 [get_ports serial_tx]\n');
        assert.equal(await run(['pins', 'export', 'top.v', '--config', 'top.pins.json']), 0, stderr);
        assert.equal(await run(['pins', 'export', 'top.v', '--config', 'top.pins.json', '-o', 'wrong.pcf']), 1);
        assert.match(stderr, /\.xdc/);
    }
    finally {
        await rm(dir, { recursive: true, force: true });
    }
});
