import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, readdir, rm, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createEmptyArchDesignText } from '@veriflow/schematic-core/arch-design';
import { createSimulationTask } from '../src/simulationTask';
import { prepareSimulationTaskWorkspace } from '../src/simulationTaskWorkspace';
import { IverilogWasmBackend } from '@veriflow/simulator-iverilog-wasm';

test('AD portable child key resolves exact source and export shares actual simulation text', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'vf-core-ad-'));
    try {
        await mkdir(path.join(root, 'tasks')); await mkdir(path.join(root, 'rtl'));
        await writeFile(path.join(root, 'rtl', 'child.v'), 'module child; initial #1 $display("REAL_AD_CHILD"); endmodule');
        const design = JSON.parse(createEmptyArchDesignText('system_top'));
        design.instances = [{ name: 'u_child', module: 'child', definitionKey: 'module:workspace:/rtl/child.v#child' }];
        await writeFile(path.join(root, 'system.ad'), JSON.stringify(design));
        const task = createSimulationTask('run.st'); task.settings.duration = 5;
        task.instances.push({ id: 'dut', source: { kind: 'ad', path: '../system.ad' }, parameters: {} });
        const before = JSON.stringify(task);
        const prepared = await prepareSimulationTaskWorkspace(task, path.join(root, 'tasks', 'run.st'), undefined, { workspaceRoot: root });
        try {
            assert.equal(JSON.stringify(task), before);
            assert.match(prepared.generatedTestbench.text, /module system_top/);
            assert.ok(prepared.inputFiles.includes(path.join(root, 'system.ad')));
            assert.deepEqual(prepared.additionalSources.map(p => path.basename(p)), ['child.v']);
            const source = path.join(prepared.temporaryDirectory, 'run_tb.v');
            await writeFile(source, prepared.generatedTestbench.text);
            const result = await new IverilogWasmBackend().compileAndRun({ files: [source, ...prepared.additionalSources], runtimeFiles: [], includeDirs: prepared.includeDirs,
                defines: {}, plusargs: [], artifacts: [], output: path.join(prepared.temporaryDirectory, 'run.out'), cwd: prepared.temporaryDirectory,
                topModule: prepared.generatedTestbench.moduleName, timeoutMs: 30000 });
            assert.equal(result.success, true, result.stderr);
            assert.match(result.stdout, /REAL_AD_CHILD/);
            assert.deepEqual((await readdir(root)).sort(), ['rtl', 'system.ad', 'tasks']);
        } finally { await prepared.dispose(); }
        await assert.rejects(readFile(path.join(prepared.temporaryDirectory, 'run_tb.v')));
    } finally { await rm(root, { recursive: true, force: true }); }
});

test('preparation rejects missing exact source and observes cancellation', async () => {
    const controller = new AbortController(); controller.abort();
    await assert.rejects(prepareSimulationTaskWorkspace(createSimulationTask(), 'missing.st', controller.signal), /abort/i);
    const root = await mkdtemp(path.join(os.tmpdir(), 'vf-core-missing-'));
    try {
        await writeFile(path.join(root, 'actual.v'), 'module dut; endmodule');
        const task = createSimulationTask();
        task.instances.push({ id: 'dut', source: { kind: 'hdl', path: 'wrong.v', module: 'dut' }, parameters: {} });
        await assert.rejects(prepareSimulationTaskWorkspace(task, path.join(root, 'run.st')), /exactly one definition/);
    } finally { await rm(root, { recursive: true, force: true }); }
});

test('literal runtime dependencies are staged beside the execution cwd with parent-relative paths', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'vf-core-memory-'));
    try {
        await mkdir(path.join(root, 'tasks'));
        await writeFile(path.join(root, 'values.hex'), '2a\n');
        await writeFile(path.join(root, 'tasks', 'memory.v'), 'module memory; reg [7:0] data[0:0]; initial begin $readmemh("../values.hex", data); #1 $display("MEMORY=%h", data[0]); end endmodule');
        const task = createSimulationTask('memory.st'); task.settings.duration = 3; task.settings.waveform.enabled = false;
        task.instances.push({ id: 'memory_inst', source: { kind: 'hdl', path: 'memory.v', module: 'memory' }, parameters: {} });
        const prepared = await prepareSimulationTaskWorkspace(task, path.join(root, 'tasks', 'memory.st'));
        try {
            assert.equal(await readFile(path.resolve(prepared.temporaryDirectory, '../values.hex'), 'utf8'), '2a\n');
            assert.ok(prepared.inputFiles.includes(path.join(root, 'values.hex')));
            const tb = path.join(prepared.temporaryDirectory, 'memory_tb.v'); await writeFile(tb, prepared.generatedTestbench.text);
            const result = await new IverilogWasmBackend().compileAndRun({ files: [tb, ...prepared.additionalSources], runtimeFiles: prepared.runtimeFiles,
                includeDirs: prepared.includeDirs, defines: {}, plusargs: [], artifacts: [], output: path.join(prepared.temporaryDirectory, 'memory.out'), cwd: prepared.temporaryDirectory,
                topModule: prepared.generatedTestbench.moduleName, timeoutMs: 30000 });
            assert.equal(result.success, true, result.stderr); assert.match(result.stdout, /MEMORY=2a/);
        } finally { await prepared.dispose(); }
        assert.equal(await readFile(path.join(root, 'values.hex'), 'utf8'), '2a\n');
    } finally { await rm(root, { recursive: true, force: true }); }
});
