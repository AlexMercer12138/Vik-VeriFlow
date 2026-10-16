import type { HdlDefinitionSummary } from '../workspaceIndexTypes';
import type { ArchDesign, ArchDesignModuleDefinition } from '@veriflow/schematic-core/arch-design';
import { selectArchDesignDefinitionKey, type ArchDesignDefinitionCatalog } from '../archDesignDefinitionReference';
function cloneWidth(
    width: ArchDesignModuleDefinition['ports'][number]['width']
): ArchDesignModuleDefinition['ports'][number]['width'] {
    if (width.kind === 'known') return { kind: 'known', bits: width.bits };
    if (width.kind === 'symbolic') {
        return { kind: 'symbolic', expression: width.expression };
    }
    return { kind: 'unknown' };
}

export function toArchDesignModuleDefinitions(
    definitions: readonly HdlDefinitionSummary[]
): ArchDesignModuleDefinition[] {
    return definitions.filter(definition => definition.kind === 'module').map(definition => ({
        key: definition.key,
        name: definition.name,
        parameters: definition.parameters.map(parameter => ({
            name: parameter.name,
            ...(parameter.defaultExpression === undefined
                ? {}
                : { defaultExpression: parameter.defaultExpression }),
        })),
        ports: definition.ports.map(port => ({
            name: port.name,
            direction: port.direction,
            width: cloneWidth(port.width),
        })),
    }));
}

export function normalizeArchDesignDefinitionKeys(
    design: ArchDesign,
    catalog: ArchDesignDefinitionCatalog
): ArchDesign {
    let changed = false;
    const instances = design.instances.map(instance => {
        const definitionKey = selectArchDesignDefinitionKey(
            instance.definitionKey,
            instance.module,
            catalog
        );
        if (definitionKey === undefined || definitionKey === instance.definitionKey) return instance;
        changed = true;
        return { ...instance, definitionKey };
    });
    return changed ? { ...design, instances } : design;
}
