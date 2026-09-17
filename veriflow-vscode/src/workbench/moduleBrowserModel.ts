import type { HdlDefinitionSummary } from '../core';
import { canonicalizeSourceUri, isSourceUriWithinRoot } from '../core/hdl/preprocessor';
export { filterModuleBrowserTree } from './moduleBrowserFilter';

export interface ModuleBrowserRoot {
    uri: string;
    label: string;
    kind: 'workspace' | 'library';
}

export interface ModuleBrowserNode {
    id: string;
    kind: 'root' | 'directory' | 'module';
    label: string;
    tooltip: string;
    description?: string;
    moduleKey?: string;
    children?: ModuleBrowserNode[];
}

function decoded(value: string): string {
    try { return decodeURIComponent(value); } catch { return value; }
}

/** Workspace libraries stay inside their workspace; external libraries get their own root. */
export function buildModuleBrowserTree(
    definitions: readonly HdlDefinitionSummary[], roots: readonly ModuleBrowserRoot[], platform: NodeJS.Platform = process.platform,
): ModuleBrowserNode[] {
    const canonical = (uri: string) => canonicalizeSourceUri(uri, platform).replace(/\/+$/, '');
    const within = (uri: string, root: string) => isSourceUriWithinRoot(uri, root, platform);
    const uniqueRoots = roots.filter((root, index) => roots.findIndex(other => canonical(other.uri) === canonical(root.uri)) === index);
    const workspaceRoots = uniqueRoots.filter(root => root.kind === 'workspace');
    const visibleRoots = uniqueRoots.filter(root => root.kind === 'workspace' || !workspaceRoots.some(workspace => within(root.uri, workspace.uri)));
    const makeRoot = (root: ModuleBrowserRoot): ModuleBrowserNode => ({
        id: `root:${canonical(root.uri)}`, kind: 'root', label: root.label, tooltip: decoded(root.uri), children: [],
    });
    const entries = visibleRoots.map(root => ({ root, node: makeRoot(root) }));
    for (const definition of definitions) {
        if (definition.kind !== 'module') continue;
        let source: URL;
        try { source = new URL(definition.uri); } catch { continue; }
        let owner = entries.filter(entry => within(definition.uri, entry.root.uri))
            .sort((a, b) => canonical(b.root.uri).length - canonical(a.root.uri).length)[0];
        if (!owner) {
            const parent = new URL('.', source);
            const root: ModuleBrowserRoot = { uri: parent.toString(), kind: 'library', label: decoded(parent.pathname.replace(/\/+$/, '').split('/').pop() || parent.host || 'External modules') };
            owner = { root, node: makeRoot(root) };
            entries.push(owner);
        }
        const rootPath = new URL(owner.root.uri).pathname.replace(/\/+$/, '');
        const directories = source.pathname.slice(rootPath.length).split('/').filter(Boolean).slice(0, -1);
        let parent = owner.node;
        let directoryUri = owner.root.uri.replace(/\/+$/, '');
        for (const directory of directories) {
            directoryUri += '/' + directory;
            const id = `directory:${canonical(directoryUri)}`;
            let child = parent.children!.find(node => node.id === id);
            if (!child) {
                child = { id, kind: 'directory', label: decoded(directory), tooltip: decoded(directoryUri), children: [] };
                parent.children!.push(child);
            }
            parent = child;
        }
        parent.children!.push({ id: `module:${definition.key}`, kind: 'module', label: definition.name,
            description: decoded(source.pathname.split('/').pop() ?? ''),
            tooltip: `${definition.name}\n${decoded(definition.uri)}:${definition.declarationLine ?? 1}`, moduleKey: definition.key });
    }
    const sort = (node: ModuleBrowserNode): void => {
        node.children?.sort((a, b) => Number(a.kind === 'module') - Number(b.kind === 'module')
            || a.label.localeCompare(b.label) || a.id.localeCompare(b.id));
        node.children?.forEach(sort);
    };
    entries.forEach(entry => sort(entry.node));
    return entries.map(entry => entry.node);
}
