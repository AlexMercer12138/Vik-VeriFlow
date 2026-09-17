import { createArchDesignDefinitionCatalog } from '@veriflow/hdl-runtime/archDesignDefinitionReference';
import { normalizeArchDesignDefinitionKeys } from '../archDesign/editorSupport';
import { type ArchDesign } from '@veriflow/schematic-core/arch-design';
import type { HdlDefinitionSummary } from '../core';
export type { DesignDependency as ArchitectureDependency } from './designDocumentTree';
import type { DesignDependency as ArchitectureDependency } from './designDocumentTree';
/** Portable references are resolved in the owning AD's catalog, never a global top catalog. */
export function projectArchitectureDependencies(design: ArchDesign, definitions: readonly HdlDefinitionSummary[], rootUri: string): ArchitectureDependency[] {
    const catalog = createArchDesignDefinitionCatalog(definitions.filter(item => item.kind === 'module'), rootUri);
    const normalized = normalizeArchDesignDefinitionKeys(design, catalog);
    const branch = (name: string, key: string | undefined, label: string, seen: ReadonlySet<string>): ArchitectureDependency => {
        const matches = catalog.definitions.filter(definition => key ? definition.key === key && definition.name === name : definition.name === name);
        const definition = matches.length === 1 ? matches[0] : undefined;
        if (!definition) return { label, status: matches.length ? 'ambiguous' : 'unresolved', children: [] };
        if (seen.has(definition.key)) return { label, definition, status: 'recursive', children: [] };
        const next = new Set([...seen, definition.key]);
        return { label, definition, children: definition.dependencies.map(child => branch(child, undefined, child, next)) };
    };
    return normalized.instances.map(instance => branch(instance.module, instance.definitionKey, `${instance.name} : ${instance.module}`, new Set()));
}
