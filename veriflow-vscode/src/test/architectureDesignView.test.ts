import assert from 'node:assert/strict';
import Module = require('module');
import { createEmptyArchDesign } from '@veriflow/schematic-core/arch-design';
import { createArchDesignDefinitionCatalog } from '@veriflow/hdl-runtime/archDesignDefinitionReference';
const loader = Module as unknown as { _load: (...args: any[]) => any }, original = loader._load;
loader._load = function(name: string, ...args: any[]): any { return name === 'vscode' ? { TreeItem: class {} } : original.call(this, name, ...args); };
try {
    const { projectArchitectureDependencies } = require('../workbench/architectureDesignView');
    const definitions = ['first', 'second'].map((folder, index) => ({ key: `runtime-${index}`, kind: 'module' as const, name: 'dut', uri: `file:///project/${folder}/dut.v`, declarationStart: 10,
        declarationLine: 0, parameters: [], ports: [], dependencies: ['dut'], modelFingerprint: folder }));
    const catalog = createArchDesignDefinitionCatalog(definitions, 'file:///project');
    const design = { ...createEmptyArchDesign('top'), instances: [{ name: 'u_first', module: 'dut', definitionKey: catalog.portableKey('runtime-0') }, { name: 'u_second', module: 'dut', definitionKey: 'runtime-1' }] };
    const branches = projectArchitectureDependencies(design, definitions, 'file:///project');
    assert.equal(branches[0].definition.uri, definitions[0].uri); assert.equal(branches[1].definition.uri, definitions[1].uri);
    assert.equal(branches[0].label, 'u_first : dut'); assert.equal(branches[1].children[0].status, 'ambiguous');
    const unique = projectArchitectureDependencies({ ...design, instances: [{ name: 'u', module: 'dut' }] }, [definitions[0]], 'file:///project');
    assert.equal(unique[0].children[0].status, 'recursive');
    const otherRoot = [{ ...definitions[0], key: 'other-runtime', uri: 'file:///other/first/dut.v', dependencies: [] }];
    const portable = { ...design, instances: [design.instances[0]] };
    const other = projectArchitectureDependencies(portable, otherRoot, 'file:///other');
    assert.equal(other[0].definition.uri, 'file:///other/first/dut.v', 'portable key resolves relative to owning AD workspace');
    console.log('Architecture dependency portable-key and resource catalog tests passed');
} finally { loader._load = original; }
