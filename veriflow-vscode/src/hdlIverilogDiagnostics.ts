import * as path from 'node:path';
import * as vscode from 'vscode';
import { DependencyAnalyzer, LogParser } from './core';
import { canonicalizeSourceUri } from './core/hdl/preprocessor';
import type { HdlDocument } from './core/hdl/model';
import type { WorkspaceHdlIndex } from './core/hdl/workspaceHdlIndex';
import type { IverilogWasmBackend } from '@veriflow/simulator-iverilog-wasm';
import type { ExtensionSettings } from './config';
import type { HdlCompilerDiagnostic } from './hdlLanguageFeatures';

type CompileOnlyBackend = Pick<IverilogWasmBackend, 'compileOnly'>;

function resolveVirtualPath(
    fileRef: string | undefined,
    hostPathByVirtualPath: ReadonlyMap<string, string>
): string | undefined {
    if (!fileRef) return undefined;
    const normalized = fileRef.replace(/\\/g, '/').replace(/^\.\//, '');
    const exact = hostPathByVirtualPath.get(normalized);
    if (exact) return exact;
    const matches = [...hostPathByVirtualPath]
        .filter(([virtualPath]) => virtualPath.endsWith(`/${normalized}`))
        .map(([, hostPath]) => hostPath);
    return matches.length === 1 ? matches[0] : undefined;
}

export async function compileIverilogDiagnostics(
    backend: CompileOnlyBackend,
    index: WorkspaceHdlIndex,
    document: vscode.TextDocument,
    parsed: HdlDocument,
    settings: ExtensionSettings,
    workspaceRoot: string,
    signal: AbortSignal
): Promise<readonly HdlCompilerDiagnostic[]> {
    const sourceUri = canonicalizeSourceUri(document.uri.toString());
    const parsedModuleNames = new Set(parsed.modules.map(module => module.name));
    const definitions = index.getAllDefinitions('module').filter(definition => (
        canonicalizeSourceUri(definition.uri) === sourceUri
        && parsedModuleNames.has(definition.name)
    ));
    if (!definitions.length) return [];

    const analyzer = new DependencyAnalyzer(index);
    const parser = new LogParser();
    const output: HdlCompilerDiagnostic[] = [];
    const seen = new Set<string>();
    for (const definition of definitions) {
        if (signal.aborted) return output;
        const dependencies = analyzer.resolve(definition.key);
        const result = await backend.compileOnly({
            cwd: workspaceRoot,
            files: dependencies.files,
            includeDirs: settings.libDirs.map(directory => path.resolve(workspaceRoot, directory)),
            defines: Object.fromEntries(Object.entries(settings.defines).filter(([, value]) => value !== false)),
            topModule: definition.name,
            generation: '2012',
            timeoutMs: 30_000,
            signal,
        });
        const combinedOutput = result.combinedOutput
            || `${result.stdout}${result.stderr}`;
        const entries = parser.parse(combinedOutput);
        const hasMissingModules = entries.some(entry => /^Unknown module type\s*:/i.test(entry.message));
        for (const entry of entries) {
            if (entry.level === 'INFO') continue;
            if (/^Unknown module type\s*:/i.test(entry.message)
                || hasMissingModules && /^\d+\s+error\(s\) during elaboration\.?$/i.test(entry.message)) continue;
            const hostPath = resolveVirtualPath(entry.fileRef, result.hostPathByVirtualPath);
            if (hostPath && canonicalizeSourceUri(vscode.Uri.file(hostPath).toString()) !== sourceUri) {
                continue;
            }
            const key = `${entry.level}\0${entry.message}\0${entry.lineNo ?? 1}`;
            if (seen.has(key)) continue;
            seen.add(key);
            const line = Math.max(0, (entry.lineNo ?? 1) - 1);
            const lineText = document.getText().split(/\r?\n/)[line] ?? '';
            const diagnostic = new vscode.Diagnostic(
                new vscode.Range(
                    new vscode.Position(line, 0),
                    new vscode.Position(line, Math.max(1, lineText.length))
                ),
                entry.message,
                entry.level === 'WARNING'
                    ? vscode.DiagnosticSeverity.Warning
                    : vscode.DiagnosticSeverity.Error
            );
            diagnostic.code = 'iverilog.compile';
            diagnostic.source = 'VeriFlow Icarus';
            output.push({ uri: document.uri, diagnostic });
        }
    }
    return output;
}
