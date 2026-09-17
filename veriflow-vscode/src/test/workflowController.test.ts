import assert from 'node:assert/strict';
import Module = require('module');

async function main(): Promise<void> {
    const loader = Module as unknown as { _load: (...args: any[]) => any }, original = loader._load;
    loader._load = function(name: string, ...args: any[]): any {
        return name === 'vscode' ? { TreeItem: class {} } : original.call(this, name, ...args);
    };
    try {
        const { WorkflowController } = require('../workflowController');
        let settings = { simulator: 'builtin', libDirs: ['lib'], defines: { FEATURE: true } };
        const context = { workspaceState: { get: () => { throw new Error('Legacy task state must not be loaded'); },
            update: () => { throw new Error('Session state must not be persisted'); } } };
        let controller: any;
        assert.doesNotThrow(() => { controller = new WorkflowController(context, { settings: () => settings, run: async () => {} }); });
        assert.equal(controller.settings().simulator, 'builtin');
        settings = { ...settings, simulator: 'custom' };
        assert.equal(controller.settings().simulator, 'custom', 'current workspace settings are read afresh, with no saved task override');
        const first = controller.beginRun('first', [], settings);
        assert.throws(() => controller.assertIdle(), /simulation/i);
        const second = controller.beginRun('second', [], settings);
        await controller.finishRun(first, 'completed', 'stale completion');
        assert.throws(() => controller.assertIdle(), /simulation/i, 'an earlier completion cannot release the current run');
        await controller.finishRun(second, 'failed', 'current run failed');
        assert.doesNotThrow(() => controller.assertIdle());
        controller.beginRun('third', [], settings);
        controller.dispose();
        assert.doesNotThrow(() => controller.assertIdle(), 'dispose releases the session guard');
    } finally { loader._load = original; }
    console.log('Generic simulation session isolation tests passed');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
