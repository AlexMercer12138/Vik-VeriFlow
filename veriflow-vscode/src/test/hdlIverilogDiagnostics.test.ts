import * as assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import * as path from 'node:path';
import Module = require('module');
import type { HdlDocument } from '../core/hdl/model';

async function main(): Promise<void> {
    const sourcePath = path.resolve('/workspace/rtl/top.sv');
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
    const document = {
        uri: new Uri(sourceUri),
        getText: () => 'line one\nline two\nline three\n',
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
    const backend = {
        async compileOnly(request: Record<string, unknown>) {
            compileRequest = request;
            return {
                success: true,
                stage: 'compile',
                exitCode: 0,
                stdout: '',
                stderr: 'workspace/rtl/top.sv:3: warning: Port width mismatch\n',
                combinedOutput: 'workspace/rtl/top.sv:3: warning: Port width mismatch\n',
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
        diagnostics = await compileIverilogDiagnostics(
            backend,
            index,
            document,
            { modules: [{ name: 'top' }] } as unknown as HdlDocument,
            { libDirs: [], defines: {} },
            path.resolve('/workspace'),
            new AbortController().signal
        );
    } finally { loader._load = original; }
    assert.equal(compileRequest?.topModule, 'top');
    assert.equal(compileRequest?.generation, '2012');
    assert.equal(diagnostics!.length, 1);
    assert.equal(diagnostics![0].uri.toString(), sourceUri);
    assert.equal(diagnostics![0].diagnostic.severity, vscode.DiagnosticSeverity.Warning);
    assert.equal(diagnostics![0].diagnostic.range.start.line, 2);
    assert.equal(diagnostics![0].diagnostic.source, 'VeriFlow Icarus');
    console.log('Icarus compile warnings map to HDL document diagnostics');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
