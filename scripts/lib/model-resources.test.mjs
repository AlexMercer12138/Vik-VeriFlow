import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, readFile, readdir, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { copyPhysicalInterfaces } from './model-resources.mjs';

test('runtime and extension receive identical reusable interfaces and remove stale copies', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'veriflow-resources-'));
    try {
        const source = path.join(root, 'data/physical-models/interfaces');
        await mkdir(source, { recursive: true });
        const model = JSON.stringify({ kind: 'fixed', signals: ['led'], function: { output: { led: 'output' } } });
        await writeFile(path.join(source, 'led.fixed.json'), model);
        await writeFile(path.join(source, 'notes.json'), '{}');
        for (const target of ['runtime', 'extension']) {
            const destination = path.join(root, target);
            await mkdir(destination);
            await writeFile(path.join(destination, 'removed.expansion.json'), '{}');
            await writeFile(path.join(destination, 'README.md'), 'preserve');
            await copyPhysicalInterfaces(root, destination);
            assert.deepEqual((await readdir(destination)).sort(), ['README.md', 'led.fixed.json']);
            assert.equal(await readFile(path.join(destination, 'led.fixed.json'), 'utf8'), model);
        }
        await writeFile(path.join(source, 'invalid.fixed.json'), '{"kind":"board"}');
        await assert.rejects(copyPhysicalInterfaces(root, path.join(root, 'runtime')), /Invalid reusable interface/);
    } finally { await rm(root, { recursive: true, force: true }); }
});
