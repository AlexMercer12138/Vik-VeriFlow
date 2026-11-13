import * as assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import * as path from 'node:path';
import Module = require('module');
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { IverilogWasmBackend } from '@veriflow/simulator-iverilog-wasm';
import type { HdlDocument } from '../core/hdl/model';

async function main(): Promise<void> {
    const root = await mkdtemp(path.join(tmpdir(), 'vf-linter-missing-module-'));
    const sourcePath = path.join(root, 'top.sv');
    const sourceUri = pathToFileURL(sourcePath).toString();
    class Uri {
        constructor(readonly value: string, readonly fsPath = sourcePath) {}
        toString(): string { return this.value; }
        static file(value: string): Uri { return new Uri(pathToFileURL(value).toString(), value); }
        static parse(value: string): Uri { return new Uri(value); }
    }
    class Position { constructor(public line: number, public character: number) {} }
    class Range { constructor(public start: Position, public end: Position) {} }
    class Diagnostic {
        code?: string;
        source?: string;
        constructor(public range: Range, public message: string, public severity: number) {}
    }
    const vscode = {
        Uri, Position, Range, Diagnostic,
        DiagnosticSeverity: { Error: 0, Warning: 1, Information: 2 },
    };
    let documentText = 'line one\nline two\nline three\n';
    const document = {
        uri: new Uri(sourceUri),
        getText: () => documentText,
    };
    const definition = {
        key: 'module:top', kind: 'module', name: 'top', uri: sourceUri,
        declarationStart: 0, declarationLine: 1, parameters: [], ports: [],
        dependencies: [], modelFingerprint: 'top',
    };
    const index = {
        getAllDefinitions: () => [definition],
        getDefinition: () => definition,
        findDefinitions: () => [definition],
        getFile: () => ({ includeUris: [] }),
    };
    let compileRequest: Record<string, unknown> | undefined;
    let compilerOutput = 'workspace/rtl/top.sv:3: warning: Port width mismatch\n';
    const backend = {
        async compileOnly(request: Record<string, unknown>) {
            compileRequest = request;
            return {
                success: true,
                stage: 'compile',
                exitCode: 0,
                stdout: '',
                stderr: compilerOutput,
                combinedOutput: compilerOutput,
                timings: { compile: 4 },
                hostPathByVirtualPath: new Map([['workspace/rtl/top.sv', sourcePath]]),
            };
        },
    };
    const loader = Module as typeof Module & { _load: (name: string, ...args: unknown[]) => unknown };
    const original = loader._load;
    loader._load = function(name, ...args) {
        if (name === 'vscode') return vscode;
        if (name === './core') return {
            DependencyAnalyzer: class { resolve() { return { files: [sourcePath] }; } },
            LogParser: (original.call(this, name, ...args) as { LogParser: new () => unknown }).LogParser,
        };
        return original.call(this, name, ...args);
    };
    let diagnostics: Array<{ uri: Uri; diagnostic: Diagnostic }>;
    try {
        const { compileIverilogDiagnostics } = require('../hdlIverilogDiagnostics');
        const compile = () => compileIverilogDiagnostics(
            backend,
            index,
            document,
            { modules: [{ name: 'top' }] } as unknown as HdlDocument,
            { libDirs: [], defines: {} },
            path.resolve('/workspace'),
            new AbortController().signal
        );
        diagnostics = await compile();
        const missing = [
            'workspace/rtl/top.sv:2: error: Unknown module type: vendor_pll',
            '2 error(s) during elaboration.',
            '*** These modules were missing:',
            '        vendor_pll referenced 1 times.',
            '***',
        ].join('\n');
        compilerOutput = missing;
        assert.deepEqual(await compile(), [], 'unavailable IP modules must not produce linter diagnostics');
        compilerOutput = missing + '\nworkspace/rtl/top.sv:3: error: Unable to bind wire/reg/memory `typo` in `top`\nworkspace/rtl/top.sv:3: warning: Port width mismatch\n';
        assert.deepEqual((await compile()).map((entry: any) => entry.diagnostic.message),
            ['Unable to bind wire/reg/memory `typo` in `top`', 'Port width mismatch']);
        compilerOutput = 'workspace/rtl/top.sv:2: syntax error\n1 error(s) during elaboration.\n';
        assert.ok((await compile()).some((entry: any) => entry.diagnostic.message === 'syntax error'), 'syntax errors must still be reported');
        const realCompile = () => compileIverilogDiagnostics(new IverilogWasmBackend(), index, document,
            { modules: [{ name: 'top' }] } as unknown as HdlDocument, { libDirs: [], defines: {} }, root, new AbortController().signal);
        documentText = 'module top; vendor_pll u_pll(); endmodule\n';
        await writeFile(sourcePath, documentText);
        assert.deepEqual(await realCompile(), [], 'real Icarus missing-module output must be suppressed');
        documentText = 'module top; wire x; assign x = missing_signal; endmodule\n';
        await writeFile(sourcePath, documentText);
        assert.ok((await realCompile()).some((entry: any) => /Unable to bind.*missing_signal/.test(entry.diagnostic.message)),
            'real Icarus undeclared signal errors must remain visible');
    } finally { loader._load = original; await rm(root, { recursive: true, force: true }); }
    assert.equal(compileRequest?.topModule, 'top');
    assert.equal(compileRequest?.generation, '2012');
    assert.equal(diagnostics!.length, 1);
    assert.equal(diagnostics![0].uri.toString(), sourceUri);
    assert.equal(diagnostics![0].diagnostic.severity, vscode.DiagnosticSeverity.Warning);
    assert.equal(diagnostics![0].diagnostic.range.start.line, 2);
    assert.equal(diagnostics![0].diagnostic.source, 'VeriFlow Icarus');
    console.log('Icarus linter suppresses missing modules while preserving warnings and real compile errors');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
