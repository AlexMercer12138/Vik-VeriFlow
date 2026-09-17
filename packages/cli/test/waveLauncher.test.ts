import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import childProcess = require('node:child_process');
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { NodeWaveViewerLauncher } from '../src/runtime/nodeWaveViewerLauncher';

const fakeViewer = path.resolve(__dirname, '..', '..', 'test', 'fixtures', 'fakeWaveViewer.mjs');

test('CLI help does not load Electron', () => {
    const mainPath = require.resolve('../src/main');
    const result = spawnSync(process.execPath, [
        '-e',
        `const Module = require('node:module');
const originalLoad = Module._load;
Module._load = function(request) {
    if (request === 'electron') throw new Error('electron module was loaded');
    return Reflect.apply(originalLoad, this, arguments);
};
const { runCli } = require(process.argv[1]);
runCli(['--help'], {
    cwd: process.cwd(),
    homeDir: process.cwd(),
    stdout() {},
    stderr() {},
}).then(exitCode => {
    if (exitCode !== 0) process.exitCode = exitCode;
}).catch(error => {
    console.error(error);
    process.exitCode = 1;
});`,
        mainPath,
    ], { encoding: 'utf8' });

    assert.equal(result.status, 0, result.stderr);
});

test('external wave viewer launches through the native shell in the requested cwd', async context => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'veriflow-wave-launcher-'));
    const capturePath = path.join(root, 'viewer.json');
    const spawn = childProcess.spawn;
    let viewer: childProcess.ChildProcess | undefined;
    let closed: Promise<number | null> | undefined;
    context.mock.method(childProcess, 'spawn', (...args: Parameters<typeof spawn>) => {
        viewer = Reflect.apply(spawn, childProcess, args) as childProcess.ChildProcess;
        closed = new Promise(resolve => viewer!.once('close', resolve));
        return viewer;
    });
    try {
        const command = [process.execPath, fakeViewer, capturePath, 'hello world']
            .map(value => JSON.stringify(value))
            .join(' ');
        await new NodeWaveViewerLauncher().openExternal(command, root);
        assert.ok(viewer);
        // The production launcher deliberately detaches; the test owns this fake
        // viewer and must wait for the shell to release its Windows working directory.
        viewer.ref();
        assert.equal(await closed, 0);

        assert.deepEqual(JSON.parse(readFileSync(capturePath, 'utf8')), {
            cwd: root,
            args: ['hello world'],
        });
    } finally {
        viewer?.ref();
        await closed;
        rmSync(root, { recursive: true, force: true });
    }
});
