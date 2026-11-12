import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import type { SimulationRequest } from '@veriflow/flow-core';
import { createInterfaceProtocolCatalog } from '@veriflow/schematic-core/interfaces';
import type { PreparedSimulationTask } from '../src/simulationTaskWorkspace';
import { ArchDesignSession } from '../src/workbench/archDesignSession';
import { createSimulationTask } from '../src/simulationTask';
import { NodeFileDocumentHost } from '../src/workbench/documentHost';
import { SimulationTaskSession } from '../src/workbench/simulationTaskSession';

test('Node document host rejects stale edits without replacing external changes', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'vf-workbench-document-'));
    const file = path.join(root, 'top.ad');
    const host = new NodeFileDocumentHost();
    try {
        await writeFile(file, 'original\n', 'utf8');
        const snapshot = await host.readText(file);
        await writeFile(file, 'external edit\n', 'utf8');

        await assert.rejects(
            host.replaceText(file, snapshot.version, 'stale replacement\n'),
            /changed since it was read/i,
        );
        assert.equal(await readFile(file, 'utf8'), 'external edit\n');
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});

test('Arch Design session publishes graph state and applies revision-checked edits', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'vf-workbench-arch-'));
    const file = path.join(root, 'top.ad');
    const source = JSON.stringify({
        format: 'vik-veriflow.arch-design', schemaVersion: 1, module: 'top',
        ports: [], instances: [], connections: [], interfacePorts: [], interfaceOverrides: {},
        interfaceConnections: [], defaults: {}, export: {}, presentation: {},
    });
    await writeFile(file, source, 'utf8');
    const session = new ArchDesignSession({
        documents: new NodeFileDocumentHost(),
        definitions: async () => [],
        interfaces: async () => createInterfaceProtocolCatalog(),
    });
    const events: string[] = [];
    session.onEvent(event => events.push(event.type));
    try {
        await session.open(file);
        const revision = session.revision!;
        await session.handle({ type: 'editArchDesign', revision, edit: {
            type: 'addPort', port: { name: 'clk', direction: 'input' },
        } });
        assert.ok(events.includes('graph'));
        assert.ok(events.includes('archDesignState'));
        assert.match((await readFile(file, 'utf8')), /"name": "clk"/);
        await assert.rejects(
            session.handle({ type: 'editArchDesign', revision, edit: {
                type: 'addPort', port: { name: 'rst', direction: 'input' },
            } }),
            /changed/i,
        );
    } finally {
        session.dispose();
        await rm(root, { recursive: true, force: true });
    }
});

test('Simulation Task session forwards cancellation to its backend and publishes stopped state', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'vf-workbench-task-'));
    const file = path.join(root, 'simulation.st');
    const document = createSimulationTask(file);
    document.settings.waveform.enabled = false;
    await writeFile(file, JSON.stringify(document), 'utf8');
    const requests: SimulationRequest[] = [];
    let backendStarted!: () => void;
    const started = new Promise<void>(resolve => { backendStarted = resolve; });
    const session = new SimulationTaskSession({
        documents: new NodeFileDocumentHost(),
        prepare: async task => ({
            temporaryDirectory: root,
            async dispose() {},
            task,
            modules: [],
            additionalSources: [],
            inputFiles: [file],
            runtimeFiles: [],
            includeDirs: [],
            defines: {},
            generatedTestbench: { moduleName: 'simulation_tb', text: 'module simulation_tb; endmodule', diagnostics: [] },
        } satisfies PreparedSimulationTask),
        backend: async () => ({
            compileAndRun: request => {
                requests.push(request);
                backendStarted();
                return new Promise(resolve => request.signal?.addEventListener('abort', () => resolve({
                    success: false,
                    exitCode: 1,
                    stdout: '',
                    stderr: 'cancelled',
                    logEntries: [],
                    waveFile: null,
                    elapsedTime: 0,
                    backendId: 'test',
                    stage: 'run',
                    timings: {},
                    commands: {},
                    artifacts: [],
                    cause: { code: 'ABORTED', message: 'cancelled' },
                })));
            },
        }),
    });
    const events: string[] = [];
    session.onEvent(event => {
        if (event.type === 'simulationTaskExecution') events.push(event.execution.status);
    });
    try {
        await session.open(file);
        const controller = new AbortController();
        const run = session.run(controller.signal);
        await started;
        assert.equal(requests[0].signal?.aborted, false);
        controller.abort();
        await run;
        assert.equal(requests[0].signal?.aborted, true);
        assert.deepEqual(events, ['idle', 'running', 'stopped']);
        assert.equal(session.execution.status, 'stopped');
    } finally {
        session.dispose();
        await rm(root, { recursive: true, force: true });
    }
});

test('Simulation Task session publishes the revision after normalizing its document', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'vf-workbench-task-revision-'));
    const file = path.join(root, 'simulation.st');
    const source = 'dut.v';
    const document = createSimulationTask(file);
    document.instances.push({ id: 'dut', source: { kind: 'hdl', path: source, module: 'dut' }, parameters: { obsolete: '1' } });
    await writeFile(file, JSON.stringify(document), 'utf8');
    const session = new SimulationTaskSession({
        documents: new NodeFileDocumentHost(),
        modules: async () => [{ source, module: 'dut', ports: [], parameters: [] }],
        prepare: async () => { throw new Error('Simulation is not part of this test.'); },
        backend: async () => { throw new Error('Simulation is not part of this test.'); },
    });
    const revisions: string[] = [];
    session.onEvent(event => {
        if (event.type === 'simulationTaskState') revisions.push(event.revision);
    });
    try {
        await session.open(file);
        assert.equal(revisions.length, 1);
        await session.handle({ type: 'simulationTaskCommand', revision: revisions[0],
            command: 'updateTaskSettings', payload: { settings: { duration: 50 } } });
        assert.match(await readFile(file, 'utf8'), /"duration": 50/);
        assert.doesNotMatch(await readFile(file, 'utf8'), /"obsolete"/);
    } finally {
        session.dispose();
        await rm(root, { recursive: true, force: true });
    }
});
