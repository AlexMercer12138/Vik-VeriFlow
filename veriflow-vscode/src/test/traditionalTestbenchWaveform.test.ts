import assert from 'node:assert/strict';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import { discoverTraditionalWaveFile } from '../workbench/traditionalTestbenchWaveform';
import { createWorkspaceIndexHarness } from './helpers/workspaceIndexFixture';
import { DependencyAnalyzer } from '../core/dependencyAnalyzer';
import { canonicalizeSourceUri, preprocessForParsing } from '../core/hdl/preprocessor';

async function main(): Promise<void> {
    const root = path.resolve('test-wave-workspace');
    const file = path.join(root, 'testbench.sv');
    const uri = pathToFileURL(file).toString();
    const text = [
        '`define WAVES',
        'module ignored; initial $dumpfile("ignored.vcd"); endmodule',
        'module tb;',
        '  // $dumpfile("comment.vcd");',
        '  /* $dumpfile("block.vcd"); */',
        '  initial $display("$dumpfile(\\"string.vcd\\")");',
        '`ifdef WAVES',
        '  initial $dumpfile /* comment */ ("actual trace.vcd");',
        '`else',
        '  initial $dumpfile("disabled.vcd");',
        '`endif',
        'endmodule',
    ].join('\n');
    const definition = { name: 'tb', uri, key: 'tb-key', kind: 'module' };
    const spans = { start: text.indexOf('module tb'), end: text.length, uri };
    let sourceText = text;
    const index: any = {
        getAllDefinitions: () => [definition, { name: 'ignored', uri, key: 'ignored-key', kind: 'module' }],
        resolveDefinition: async (key: string) => {
            assert.equal(key, 'tb-key', 'only modules in the resolved dependency graph should be inspected');
            return { summary: definition, module: { declarationSpan: spans }, preprocessedSource: preprocessForParsing(uri, sourceText, { defines: {} }) };
        },
    };
    const dependencies: any = { moduleMap: { tb: file } };
    assert.equal(await discoverTraditionalWaveFile(index, dependencies, root), path.join(root, 'actual trace.vcd'));
    const dynamic = text.replace('"actual trace.vcd"', 'filename');
    sourceText = dynamic;
    assert.equal(await discoverTraditionalWaveFile(index, dependencies, root), undefined);
    const multiple = text.replace('"actual trace.vcd");', '"actual trace.vcd"); initial $dumpfile("another.vcd");');
    spans.end = multiple.length;
    sourceText = multiple;
    assert.equal(await discoverTraditionalWaveFile(index, dependencies, root), undefined, 'multiple runtime choices cannot be selected statically');
    const configUri = pathToFileURL(path.join(root, 'config.vh')).toString();
    const bodyUri = pathToFileURL(path.join(root, 'body.vh')).toString();
    const includeText = [
        '`include "config.vh"',
        'module tb;',
        '`include "body.vh"',
        'endmodule',
    ].join('\n');
    const bodyText = [
        '`ifdef WAVES',
        'initial $dumpfile("included.vcd");',
        '`else',
        'initial $dumpfile("disabled.vcd");',
        '`endif',
    ].join('\n');
    const harness = createWorkspaceIndexHarness({ [uri]: includeText, [configUri]: '`define WAVES\n', [bodyUri]: bodyText });
    try {
        await harness.index.scan([pathToFileURL(root).toString()]);
        const tb = harness.index.findDefinitions('tb', 'module')[0];
        const deps = new DependencyAnalyzer(harness.index).resolve(tb.key);
        assert.equal(await discoverTraditionalWaveFile(harness.index, deps, root),
            path.join(root, 'included.vcd'), 'include-defined macros must retain their context inside included module bodies');
        harness.files.set(canonicalizeSourceUri(bodyUri), bodyText + '\ninitial $dumpfile(filename);\n');
        await harness.index.scan([pathToFileURL(root).toString()]);
        assert.equal(await discoverTraditionalWaveFile(harness.index, deps, root),
            undefined, 'a dynamic dumpfile alongside a literal requires the configured fallback');
    } finally { harness.index.dispose(); await harness.dispose(); }
    console.log('Traditional Testbench waveform discovery tests passed');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
