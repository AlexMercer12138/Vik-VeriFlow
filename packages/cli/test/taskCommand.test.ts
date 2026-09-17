import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createSimulationTask } from '@veriflow/hdl-runtime/simulationTask';
import { ProjectStore } from '@veriflow/flow-core';
import type { SimulationExecution, SimulationRequest, SimulatorBackend } from '@veriflow/flow-core/simulation';
import { runCli, type CliEnvironment } from '../src/main';

function execution(overrides: Partial<SimulationExecution> = {}): SimulationExecution {
    return { success: true, exitCode: 0, stdout: 'finished\n', stderr: '', logEntries: [], waveFile: null,
        elapsedTime: 0.01, backendId: 'builtin', stage: 'run', timings: {}, commands: {}, artifacts: [], ...overrides };
}
function environment(cwd: string, backend: SimulatorBackend, output: { stdout: string; stderr: string }): CliEnvironment {
    return { cwd, homeDir: path.join(cwd, '.home'), stdout: text => { output.stdout += text; }, stderr: text => { output.stderr += text; },
        simulationBackendOptions: { builtinProvider: () => backend } };
}
function fixture(root: string): string {
    mkdirSync(path.join(root, 'rtl'));
    writeFileSync(path.join(root, 'rtl', 'dut.v'), 'module dut(output y); assign y = 1\'b1; endmodule\n');
    const task = createSimulationTask('simulation.st');
    task.settings.duration = 10;
    task.settings.waveform.enabled = false;
    task.instances.push({ id: 'u_dut', source: { kind: 'hdl', path: 'rtl/dut.v', module: 'dut' }, parameters: {} });
    const taskPath = path.join(root, 'simulation.st');
    writeFileSync(taskPath, JSON.stringify(task));
    return taskPath;
}

test('task run rejects retired scenario, worker, cache and report options before reading a task', async () => {
    for (const args of [['--case', 'first'], ['--jobs', '2'], ['--cache'], ['--json', 'out.json'], ['--junit', 'out.xml']]) {
        const output = { stdout: '', stderr: '' };
        const code = await runCli(['task', 'run', 'missing.st', ...args], environment(process.cwd(), { compileAndRun: async () => execution() }, output));
        assert.equal(code, 2, output.stderr);
        assert.match(output.stderr, /unrecognized arguments/);
    }
});

test('task validate prepares one TB without running HDL or writing project exports', async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'veriflow-task-validate-'));
    try {
        const taskPath = fixture(root), output = { stdout: '', stderr: '' };
        const code = await runCli(['task', 'validate', taskPath], environment(root, { compileAndRun: async () => { throw new Error('validation must not execute'); } }, output));
        assert.equal(code, 0, output.stderr);
        assert.match(output.stdout, /simulation: testbench validated/);
        assert.equal(existsSync(path.join(root, 'simulation.v')), false);
    } finally { rmSync(root, { recursive: true, force: true }); }
});

test('task run invokes one generated TB with its explicit top and source dependencies', async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'veriflow-task-run-'));
    const requests: SimulationRequest[] = [];
    let generated = '';
    try {
        const taskPath = fixture(root), original = readFileSync(taskPath, 'utf8'), output = { stdout: '', stderr: '' };
        const code = await runCli(['task', 'run', taskPath], environment(root, { compileAndRun: async request => {
            requests.push(request); generated = readFileSync(request.files[0], 'utf8'); return execution();
        } }, output));
        assert.equal(code, 0, output.stderr);
        assert.equal(requests.length, 1);
        assert.equal(requests[0].topModule, 'simulation_tb');
        assert.match(generated, /module simulation_tb/);
        assert.ok(requests[0].files.some(file => path.resolve(file).toLowerCase() === path.join(root, 'rtl', 'dut.v').toLowerCase()), JSON.stringify(requests[0].files));
        assert.equal('compileCache' in requests[0], false);
        assert.deepEqual(requests[0].plusargs, []);
        assert.match(output.stdout, /simulation: simulation completed/);
        assert.doesNotMatch(output.stdout, /passed|verified|scenarios/);
        assert.equal(readFileSync(taskPath, 'utf8'), original);
        assert.equal(existsSync(requests[0].cwd), false, 'temporary compilation files are disposed');
    } finally { rmSync(root, { recursive: true, force: true }); }
});

test('task run propagates backend failure without claiming verification', async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'veriflow-task-failure-'));
    try {
        const taskPath = fixture(root), output = { stdout: '', stderr: '' };
        const code = await runCli(['task', 'run', taskPath], environment(root, { compileAndRun: async () => execution({ success: false, exitCode: 3, stderr: 'compile failed' }) }, output));
        assert.equal(code, 1);
        assert.match(output.stderr, /compile failed/);
        assert.doesNotMatch(output.stdout, /completed|passed/);
    } finally { rmSync(root, { recursive: true, force: true }); }
});

test('task project configuration supplies HDL defines and library directories', async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'veriflow-task-project-'));
    try {
        const taskPath = fixture(root), output = { stdout: '', stderr: '' };
        const store = new ProjectStore(), project = store.create('project', root);
        project.defines = { FEATURE: true, WIDTH: 8, DISABLED: false };
        project.libDirs = [path.join(root, 'rtl')];
        project.simulator = 'builtin';
        const projectPath = path.join(root, 'project.json'); store.save(project, projectPath);
        let request: SimulationRequest | undefined;
        const code = await runCli(['task', 'run', '--project', projectPath, taskPath], environment(root, { compileAndRun: async value => { request = value; return execution(); } }, output));
        assert.equal(code, 0, output.stderr);
        assert.deepEqual(request!.defines, { FEATURE: true, WIDTH: '8' });
        assert.ok(request!.includeDirs.some(directory => path.resolve(directory).toLowerCase() === path.join(root, 'rtl').toLowerCase()), JSON.stringify(request!.includeDirs));
    } finally { rmSync(root, { recursive: true, force: true }); }
});

test('task rejects legacy scenario documents instead of silently dropping their behavior', async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'veriflow-task-legacy-'));
    try {
        const taskPath = fixture(root), task = JSON.parse(readFileSync(taskPath, 'utf8'));
        task.cases = []; writeFileSync(taskPath, JSON.stringify(task));
        const output = { stdout: '', stderr: '' };
        const code = await runCli(['task', 'validate', taskPath], environment(root, { compileAndRun: async () => execution() }, output));
        assert.equal(code, 1); assert.match(output.stderr, /cases|unknown|unsupported/i);
    } finally { rmSync(root, { recursive: true, force: true }); }
});

test('task builtin run produces a waveform that survives temporary workspace cleanup', async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'veriflow-task-wasm-'));
    let waveDirectory: string | undefined;
    try {
        const taskPath = fixture(root), task = JSON.parse(readFileSync(taskPath, 'utf8'));
        task.settings.waveform.enabled = true;
        task.settings.exportPath = 'keep.v';
        writeFileSync(taskPath, JSON.stringify(task));
        writeFileSync(path.join(root, 'keep.v'), '// independently exported HDL\n');
        const output = { stdout: '', stderr: '' };
        const env = environment(root, { compileAndRun: async () => execution() }, output);
        delete env.simulationBackendOptions;
        const code = await runCli(['task', 'run', taskPath], env);
        assert.equal(code, 0, output.stderr);
        const waveform = /^Waveform: (.+)$/m.exec(output.stdout)?.[1];
        assert.ok(waveform, output.stdout);
        waveDirectory = path.dirname(waveform);
        assert.match(readFileSync(waveform, 'utf8'), /\$enddefinitions/);
        assert.equal(readFileSync(path.join(root, 'keep.v'), 'utf8'), '// independently exported HDL\n');
    } finally {
        if (waveDirectory) rmSync(waveDirectory, { recursive: true, force: true });
        rmSync(root, { recursive: true, force: true });
    }
});
