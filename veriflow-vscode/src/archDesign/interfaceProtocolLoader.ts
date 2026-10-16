import { loadInterfaceProtocolCatalog } from '@veriflow/hdl-runtime/interfaces';
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

export type InterfaceProtocolCatalogSnapshot = Readonly<{
    catalog: InterfaceProtocolCatalog;
    diagnostics: readonly InterfaceProtocolFileDiagnostic[];
    generation: number;
    inputs?: readonly { path: string; text: string }[];
}>;

export type InterfaceProtocolLoaderHost = Readonly<{
    workspaceFolder(documentUri: string): string | undefined;
    resolve(baseUri: string, relativePath: string): string;
    readFile(uri: string): Promise<string>;
    watch(uri: string, listener: () => void): { dispose(): void };
}>;

function isMissingFile(error: unknown): boolean {
    const code = (error as { code?: unknown }).code;
    const name = (error as { name?: unknown }).name;
    return code === 'ENOENT'
        || code === 'FileNotFound'
        || (typeof name === 'string' && name.includes('FileNotFound'));
}

function projectProtocolPaths(
    source: string,
    text: string,
    diagnostics: InterfaceProtocolFileDiagnostic[]
): readonly string[] {
    let value: unknown;
    try {
        value = JSON.parse(text);
    } catch {
        diagnostics.push({
            source,
            path: '$',
            code: 'IF_PROTOCOL_PROJECT_JSON_SYNTAX',
            message: 'Project file is not valid JSON',
        });
        return [];
    }
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        diagnostics.push({
            source,
            path: '$',
            code: 'IF_PROTOCOL_PROJECT_DOCUMENT',
            message: 'Project root must be an object',
        });
        return [];
    }
    const schematic = (value as Record<string, unknown>).schematic;
    if (schematic === undefined) return [];
    if (schematic === null || typeof schematic !== 'object' || Array.isArray(schematic)) {
        diagnostics.push({
            source,
            path: '$.schematic',
            code: 'IF_PROTOCOL_PROJECT_FIELD',
            message: 'schematic must be an object',
        });
        return [];
    }
    const files = (schematic as Record<string, unknown>).interface_protocols;
    if (files === undefined) return [];
    if (!Array.isArray(files) || files.some(item => typeof item !== 'string')) {
        diagnostics.push({
            source,
            path: '$.schematic.interface_protocols',
            code: 'IF_PROTOCOL_PROJECT_FIELD',
            message: 'interface_protocols must be an array of strings',
        });
        return [];
    }
    return files;
}

export class WorkspaceInterfaceProtocolLoader {
    private generation = 0;
    private readonly listeners = new Set<(generation: number) => void>();
    private readonly watchers = new Map<string, { dispose(): void }>();

    constructor(private readonly host: InterfaceProtocolLoaderHost) {}

    onDidInvalidate(listener: (generation: number) => void): { dispose(): void } {
        this.listeners.add(listener);
        return { dispose: () => this.listeners.delete(listener) };
    }

    private watch(uri: string): void {
        if (this.watchers.has(uri)) return;
        this.watchers.set(uri, this.host.watch(uri, () => {
            this.generation += 1;
            for (const listener of [...this.listeners]) listener(this.generation);
        }));
    }

    async load(documentUri: string): Promise<InterfaceProtocolCatalogSnapshot> {
        const workspace = this.host.workspaceFolder(documentUri);
        if (workspace === undefined) {
            return Object.freeze({
                catalog: createInterfaceProtocolCatalog(),
                diagnostics: Object.freeze([]),
                generation: this.generation,
            });
        }
        const diagnostics: InterfaceProtocolFileDiagnostic[] = [];
        const snapshots: { path: string; text: string }[] = [];
        const projectUri = this.host.resolve(workspace, 'project.json');
        this.watch(projectUri);
        let paths: readonly string[] = [];
        try {
            const projectText = await this.host.readFile(projectUri);
            snapshots.push({ path: projectUri, text: projectText });
            paths = projectProtocolPaths(projectUri, projectText, diagnostics);
        } catch (error) {
            if (!isMissingFile(error)) throw error;
        }
        const files = paths.map(configured => this.host.resolve(workspace, configured));
        for (const source of files) this.watch(source);
        const loaded = await loadInterfaceProtocolCatalog(files, source => this.host.readFile(source));
        diagnostics.push(...loaded.diagnostics);
        const catalog = loaded.catalog;
        return Object.freeze({
            catalog,
            inputs: Object.freeze([...snapshots, ...loaded.inputs]),
            diagnostics: Object.freeze(diagnostics.map(item => Object.freeze({ ...item }))),
            generation: this.generation,
        });
    }

    dispose(): void {
        for (const watcher of this.watchers.values()) watcher.dispose();
        this.watchers.clear();
        this.listeners.clear();
    }
}
