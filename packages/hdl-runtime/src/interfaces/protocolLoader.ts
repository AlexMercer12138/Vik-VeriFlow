import { readFile } from 'node:fs/promises';

import {
    createInterfaceProtocolCatalog,
    parseInterfaceProtocolText,
    type InterfaceProtocolCatalog,
    type InterfaceProtocolCatalogInput,
} from '@veriflow/schematic-core/interfaces';

export type InterfaceProtocolFileDiagnostic = Readonly<{
    source: string;
    path: string;
    code: string;
    message: string;
}>;

export type LoadedInterfaceProtocolCatalog = Readonly<{
    inputs: readonly { path: string; text: string }[];
    catalog: InterfaceProtocolCatalog;
    diagnostics: readonly InterfaceProtocolFileDiagnostic[];
}>;

export async function loadInterfaceProtocolCatalog(
    files: readonly string[],
    read: (source: string) => Promise<string> = source => readFile(source, 'utf8')
): Promise<LoadedInterfaceProtocolCatalog> {
    const inputs: InterfaceProtocolCatalogInput[] = [];
    const snapshots: { path: string; text: string }[] = [];
    const diagnostics: InterfaceProtocolFileDiagnostic[] = [];
    for (const source of files) {
        let text: string;
        try {
            text = await read(source);
        } catch (error) {
            if (isMissingProtocolFile(error)) {
                diagnostics.push({
                    source,
                    path: '$',
                    code: 'IF_PROTOCOL_FILE_NOT_FOUND',
                    message: 'Interface protocol file not found',
                });
                continue;
            }
            throw error;
        }
        snapshots.push({ path: source, text });
        const parsed = parseInterfaceProtocolText(text);
        if (parsed.status === 'invalid') {
            diagnostics.push(...parsed.diagnostics.map(item => ({ source, ...item })));
            continue;
        }
        if (parsed.status === 'unsupported') {
            diagnostics.push({
                source,
                path: '$.schemaVersion',
                code: 'IF_PROTOCOL_SCHEMA_UNSUPPORTED',
                message: `Interface protocol schema version ${parsed.schemaVersion} is not supported`,
            });
            continue;
        }
        inputs.push({ source, value: JSON.parse(text) as unknown });
    }
    const catalog = createInterfaceProtocolCatalog(inputs);
    diagnostics.push(...catalog.diagnostics);
    return Object.freeze({
        catalog,
        inputs: snapshots,
        diagnostics: Object.freeze(diagnostics.map(item => Object.freeze({ ...item }))),
    });
}

export function isMissingProtocolFile(error: unknown): boolean {
 const {code, name} = error as {code?: string; name?: string};
 return code === 'ENOENT' || code === 'FileNotFound' || !!name?.includes('FileNotFound');
}
