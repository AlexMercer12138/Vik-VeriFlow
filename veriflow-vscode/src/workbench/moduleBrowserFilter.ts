import type { ModuleBrowserNode } from './moduleBrowserModel';

/** Keep ancestors of matching module names, never match folder or source filenames. */
export function filterModuleBrowserTree(nodes: readonly ModuleBrowserNode[], query: string): ModuleBrowserNode[] {
    const needle = query.trim().toLocaleLowerCase();
    if (!needle) return [...nodes];
    return nodes.flatMap(node => {
        if (node.kind === 'module') return node.label.toLocaleLowerCase().includes(needle) ? [node] : [];
        const children = filterModuleBrowserTree(node.children ?? [], needle);
        return children.length ? [{ ...node, children }] : [];
    });
}
