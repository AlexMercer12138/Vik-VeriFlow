import assert from 'node:assert/strict';
import type { HdlDefinitionSummary } from '../core';

let model: any = {};
try { model = require('../workbench/moduleBrowserModel'); } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'MODULE_NOT_FOUND') throw error;
}
assert.equal(typeof model.buildModuleBrowserTree, 'function', 'Module Browser must group modules by root and directory');
const definition = (key: string, name: string, uri: string, kind = 'module') =>
    ({ key, name, uri, kind, declarationStart: 0, declarationLine: 7, parameters: [], ports: [] } as unknown as HdlDefinitionSummary);
const roots = [
    { uri: 'file:///project', label: 'Main', kind: 'workspace' },
    { uri: 'file:///project/nested', label: 'Nested', kind: 'workspace' },
    { uri: 'file:///other', label: 'Other', kind: 'workspace' },
    { uri: 'file:///external/ip', label: 'ip', kind: 'library' },
    { uri: 'file:///another/ip', label: 'ip', kind: 'library' },
    { uri: 'file:///project/vendor', label: 'vendor', kind: 'library' },
];
const definitions = [
    definition('one', 'alu', 'file:///project/rtl/core/two.sv'),
    definition('two', 'alu', 'file:///project/rtl/core/two.sv'),
    definition('three', 'nested_top', 'file:///project/nested/top.v'),
    definition('four', 'other_top', 'file:///other/top.v'),
    definition('five', 'external_alu', 'file:///external/ip/logic/mod.sv'),
    definition('six', 'another_alu', 'file:///another/ip/mod.sv'),
    definition('seven', 'vendor_top', 'file:///project/vendor/mod.sv'),
    definition('eight', 'loose', 'file:///project-sibling/orphan/mod.sv'),
    definition('pkg', 'package_name', 'file:///project/pkg.sv', 'package'),
];
const tree = model.buildModuleBrowserTree(definitions, roots);
assert.deepEqual(tree.map((node: any) => node.label), ['Main', 'Nested', 'Other', 'ip', 'ip', 'orphan']);
assert.deepEqual(tree[0].children.map((node: any) => node.label), ['rtl', 'vendor']);
assert.deepEqual(tree[0].children[0].children[0].children.map((node: any) => [node.label, node.moduleKey]), [['alu', 'one'], ['alu', 'two']]);
assert.equal(tree[1].children[0].moduleKey, 'three', 'most specific workspace owns its module');
assert.equal(tree[1].children[0].description, 'top.v', 'source basename distinguishes same-name modules without file nodes');
assert.ok(tree[1].children[0].tooltip.endsWith(':7'), 'declaration line is already one-based');
assert.equal(tree[3].children[0].children[0].moduleKey, 'five');
assert.notEqual(tree[3].id, tree[4].id, 'same-named libraries remain distinct');
const all = (nodes: any[]): any[] => nodes.flatMap(node => [node, ...all(node.children ?? [])]);
assert.equal(all(tree).filter(node => node.kind === 'module').length, 8);
assert.ok(all(tree).every(node => !node.label.endsWith('.sv') && !node.label.endsWith('.v')), 'files are never tree nodes');
assert.equal(new Set(all(tree).map(node => node.id)).size, all(tree).length);
const filtered = model.filterModuleBrowserTree(tree, ' ExTeRnAl ');
assert.deepEqual(filtered.map((node: any) => node.label), ['ip']);
assert.equal(filtered[0].children[0].children[0].moduleKey, 'five');
assert.deepEqual(model.filterModuleBrowserTree(tree, 'rtl'), [], 'only module names match');
assert.equal(model.filterModuleBrowserTree(tree, '').length, tree.length);
assert.deepEqual(model.buildModuleBrowserTree([], roots).map((node: any) => node.label), ['Main', 'Nested', 'Other', 'ip', 'ip']);
const windows = model.buildModuleBrowserTree([definition('win', 'Counter', 'file:///C:/WORK/RTL/a.sv')], [
    { uri: 'file:///c:/work', label: 'Work', kind: 'workspace' },
    { uri: 'file:///C:/Work/', label: 'duplicate', kind: 'workspace' },
], 'win32');
assert.equal(windows.length, 1, 'canonical roots deduplicate case and trailing slash');
assert.equal(windows[0].children[0].label, 'RTL', 'display paths preserve original case');
console.log('Module Browser hierarchy, root identity, and recursive filter tests passed');
