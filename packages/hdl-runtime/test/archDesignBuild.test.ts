import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { createEmptyArchDesign } from '@veriflow/schematic-core/arch-design';
import { prepareArchDesignBuild, publishArtifactPlan } from '../src/archDesign';

test('a conflict in the second artifact prevents publishing the first', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'veriflow-build-'));
    try {
        const rtl = path.join(dir, 'top.v'), xdc = path.join(dir, 'top.xdc');
        await writeFile(xdc, 'handwritten');
        await assert.rejects(publishArtifactPlan({ diagnostics: [], inputs: [], artifacts: [
            { kind: 'rtl', path: rtl, text: 'generated', owns: () => true },
            { kind: 'xdc', path: xdc, text: 'generated', owns: () => false },
        ] }), /conflict/i);
        await assert.rejects(readFile(rtl), { code: 'ENOENT' });
        assert.equal(await readFile(xdc, 'utf8'), 'handwritten');
    } finally { await rm(dir, { recursive: true, force: true }); }
});

test('RTL-only is explicit when a design contains an unavailable board', async () => {
    const design = { ...createEmptyArchDesign('top'), physical: { board: 'missing.json', bindings: [] } };
    const build = await prepareArchDesignBuild('/tmp/top.ad', design, []);
    assert.ok(build.diagnostics.length);
    assert.equal(build.artifacts.length, 0);
    const rtl = await prepareArchDesignBuild('/tmp/top.ad', design, [], { rtlOnly: true });
    assert.equal(rtl.diagnostics.length, 0);
    assert.equal(rtl.artifacts.length, 1);
    assert.match(rtl.artifacts[0].text, /module top/);
});

test('changed input prevents publication of every planned output', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'veriflow-input-change-'));
    try {
        const input = path.join(dir, 'top.ad'), rtl = path.join(dir, 'top.v'), xdc = path.join(dir, 'top.xdc');
        await writeFile(input, 'new design');
        await assert.rejects(publishArtifactPlan({ diagnostics: [], inputs: [{ path: input, text: 'old design' }], artifacts: [
            { kind: 'rtl', path: rtl, text: 'generated RTL', owns: () => true },
            { kind: 'xdc', path: xdc, text: 'generated XDC', owns: () => true },
        ] }), /Input changed/);
        await assert.rejects(readFile(rtl), { code: 'ENOENT' });
        await assert.rejects(readFile(xdc), { code: 'ENOENT' });
        assert.equal(await readFile(input, 'utf8'), 'new design');
    } finally { await rm(dir, { recursive: true, force: true }); }
});
