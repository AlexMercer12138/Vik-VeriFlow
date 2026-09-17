import assert from 'node:assert/strict';
import Module = require('module');

async function main(): Promise<void> {
    const inserted: any[][] = [], contexts: unknown[][] = [];
    let picks = 0, afterDefinitions: (() => void) | undefined;
    const uri = (path: string) => ({ path, toString: () => `file://${path}` });
    class TabInputCustom { constructor(readonly uri: any, readonly viewType: string) {} }
    let input: any = new TabInputCustom(uri('/first.st'), 'veriflow.simulationTask');
    const listeners: (() => void)[] = [];
    const subscribe = (listener: () => void) => { listeners.push(listener); return { dispose() {} }; };
    const loader = Module as unknown as { _load: (...args: any[]) => any }, original = loader._load;
    loader._load = function(name: string, ...args: any[]): any {
        return name === 'vscode' ? { TabInputCustom,
            commands: { executeCommand: async (...values: unknown[]) => contexts.push(values) },
            window: { tabGroups: { get activeTabGroup() { return { activeTab: { input } }; },
                onDidChangeTabs: subscribe, onDidChangeTabGroups: subscribe },
            showQuickPick: async () => { picks++; return undefined; } },
        } : original.call(this, name, ...args);
    };
    try {
        const { ModuleTargetService, ActiveCanvasContext } = require('../workbench/moduleTargets');
        const definitions = ['a', 'b'].map(key => ({ kind: 'module', name: 'dut', uri: `file:///${key}.sv`, key }));
        let targetDefinitions = definitions;
        const targetLookups: string[] = [];
        const service = new ModuleTargetService({ targetDefinitions: async (target: any) => { targetLookups.push(target.path); return targetDefinitions; }, definitions: async () => { afterDefinitions?.(); return definitions; },
            insert: async (...args: any[]) => { inserted.push(args); } });
        const reference = { uri: 'file:///b.sv', module: 'dut', definitionKey: 'b' };
        assert.equal(await service.add([reference]), true);
        assert.equal(inserted[0][0], 'st');
        assert.equal(inserted[0][1].path, '/first.st');
        assert.equal(inserted[0][2][0].key, 'b', 'same-name modules retain exact source identity');
        input = new TabInputCustom(uri('/second.ad'), 'veriflow.archDesignEditor');
        await service.add([reference]);
        assert.equal(inserted[1][0], 'ad');
        assert.equal(inserted[1][1].path, '/second.ad', 'current editor determines target across split editors');
        assert.deepEqual(targetLookups, ['/first.st', '/second.ad']);
        targetDefinitions = [definitions[0]];
        for (const [file, editor] of [['/first.st', 'veriflow.simulationTask'], ['/second.ad', 'veriflow.archDesignEditor']]) {
            input = new TabInputCustom(uri(file), editor);
            await assert.rejects(service.add([reference]), /veriflow\.libDirs/, 'out-of-root modules need a configured library before changing either canvas');
        }
        assert.equal(inserted.length, 2, 'incompatible modules never create unresolved instances');
        targetDefinitions = definitions;
        input = { uri: uri('/first.st') };
        assert.equal(await service.add([reference]), false, 'plain text ST editor must not use previous canvas');
        input = new TabInputCustom(uri('/first.st'), 'another.customEditor');
        assert.equal(await service.add([reference]), false, 'unrelated custom editor must not insert');
        assert.equal(inserted.length, 2);
        assert.equal(picks, 0, 'inactive canvas never opens target chooser');
        input = new TabInputCustom(uri('/first.st'), 'veriflow.simulationTask');
        await assert.rejects(service.add([{ ...reference, definitionKey: 'a' }]), /missing or ambiguous/);
        afterDefinitions = () => { input = new TabInputCustom(uri('/third.st'), 'veriflow.simulationTask'); };
        assert.equal(await service.add([reference]), false, 'switching tabs during definition lookup aborts stale insertion');
        assert.equal(inserted.length, 2);
        const context = new ActiveCanvasContext();
        assert.deepEqual(contexts[contexts.length - 1], ['setContext', 'veriflow.activeCanvas', true]);
        input = undefined; listeners.forEach(listener => listener());
        assert.deepEqual(contexts[contexts.length - 1], ['setContext', 'veriflow.activeCanvas', false]);
        context.dispose();
    } finally { loader._load = original; }
    console.log('Active canvas targeting tests passed');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
