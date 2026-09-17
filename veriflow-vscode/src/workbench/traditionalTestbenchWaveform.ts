import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { DependencyResult, WorkspaceHdlIndex } from '../core';
import { canonicalizeSourceUri } from '../core/hdl/preprocessor';

/** Resolve a single literal dumpfile only within modules reachable from the selected top. */
export async function discoverTraditionalWaveFile(
    index: Pick<WorkspaceHdlIndex, 'getAllDefinitions' | 'resolveDefinition'>,
    dependencies: DependencyResult,
    root: string
): Promise<string | undefined> {
    const filenames = new Set<string>();
    const fileIdentity = (file: string): string => process.platform === 'win32'
        ? path.resolve(file).toLowerCase() : path.resolve(file);
    for (const definition of index.getAllDefinitions('module')) {
        const includedFile = dependencies.moduleMap[definition.name];
        if (!includedFile || fileIdentity(fileURLToPath(definition.uri)) !== fileIdentity(includedFile)) continue;
        const resolved = await index.resolveDefinition(definition.key, { includePreprocessedSource: true });
        const span = resolved.module?.declarationSpan;
        const prepared = resolved.preprocessedSource;
        if (!span || !prepared) continue;
        const ranges = span.compositeParts ?? [{ ...span, uri: span.uri ?? definition.uri }];
        // Consume complete comments, strings and escaped identifiers before considering system tasks.
        const tokens = [...prepared.text.matchAll(/\/\/[^\r\n]*|\/\*[\s\S]*?\*\/|"(?:\\[\s\S]|[^"\\])*"|\\[^\s]+|[A-Za-z_$][\w$]*|[^\s]/g)]
            .filter(token => !token[0].startsWith('//') && !token[0].startsWith('/*'));
        for (let offset = 0; offset < tokens.length; offset++) {
            const token = tokens[offset];
            if (token[0] !== '$dumpfile' || tokens[offset + 1]?.[0] !== '(') continue;
            const location = prepared.sourceMap.mapOffset(token.index!, 'start');
            if (!ranges.some(range => canonicalizeSourceUri(location.uri) === canonicalizeSourceUri(range.uri)
                && location.start >= range.start && location.start < range.end)) continue;
            const literal = tokens[offset + 2]?.[0];
            if (!literal?.startsWith('"') || tokens[offset + 3]?.[0] !== ')') return undefined;
            try {
                const filename: unknown = JSON.parse(literal);
                if (typeof filename !== 'string' || !filename || filename.includes('\0')) return undefined;
                filenames.add(path.resolve(root, filename));
            } catch { return undefined; /* Non-JSON Verilog escapes require runtime evaluation. */ }
        }
    }
    return filenames.size === 1 ? [...filenames][0] : undefined;
}
