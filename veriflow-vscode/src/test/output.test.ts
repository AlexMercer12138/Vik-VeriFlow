import assert from 'node:assert/strict';
import Module = require('module');

const channels: string[] = [], printed: string[] = [];
const loader = Module as typeof Module & { _load: any }, original = loader._load;
loader._load = function (name: string, ...args: any[]) {
    return name === 'vscode' ? { window: { createOutputChannel: (title: string) => {
        channels.push(title); return { appendLine: (text: string) => printed.push(text), dispose() {} };
    } } } : original.call(this, name, ...args);
};
try {
    const output = require('../output');
    output.appendInfo('Dependency analysis');
    const text = output.appendSimulationResult({ success: false, exitCode: 1,
        stdout: 'before\nafter\n', stderr: 'warning\n', combinedOutput: 'before\nwarning\nafter\n',
        commands: { compile: 'compile tb.v', run: 'run tb.out' },
        cause: { code: 'RUN_FAILED', message: 'Backend failed' }, logEntries: [] });
    assert.match(text, /before\nwarning\nafter/);
    assert.equal(printed.filter(line => line.includes('before')).length, 1, 'combined and separate streams must not duplicate output');
    assert.ok(printed.includes('Backend failed'));
    assert.ok(printed.includes('[CMD] compile: compile tb.v'));
    const start = printed.length;
    output.appendSimulationResult({ success: true, stdout: 'hello', stderr: 'diagnostic', logEntries: [] });
    assert.deepEqual(printed.slice(start), ['hello\ndiagnostic', '[OK] Simulation completed']);
    output.appendSimulationResult({ success: false, stdout: '', stderr: '', logEntries: [], cause: { code: 'ABORTED', message: 'Partial run cancelled' } });
    assert.ok(printed.includes('Partial run cancelled'));
    assert.equal(printed.at(-1), '[INFO] Simulation cancelled');
    assert.deepEqual(channels, ['VeriFlow']);
    output.dispose();
    console.log('Shared output retains simulator streams, commands, errors and cancellation');
} finally { loader._load = original; }
