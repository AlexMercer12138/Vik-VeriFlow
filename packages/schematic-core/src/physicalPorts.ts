import { resolveArchDesign } from './archDesign/resolution';
import { resolvePhysicalInteger } from './archDesign/parameterWidth';
import type { ArchDesign } from './archDesign/model';
import type { ArchDesignModuleDefinition } from './archDesign/definitions';
import type { PhysicalPort } from './physicalPins';
import type { InterfaceProtocolCatalog } from './interfaces';
export function adPhysicalPorts(design: ArchDesign, definitions: readonly ArchDesignModuleDefinition[], catalog: InterfaceProtocolCatalog): PhysicalPort[] {
    const resolved = resolveArchDesign(design, definitions, catalog);
    const port = (name: string, direction: PhysicalPort['direction'], width: number | undefined): PhysicalPort => ({ name, direction,
        ...(width === undefined || width > 4096 ? { unresolved: true } : width === 1 ? {} : { indices: Array.from({ length: width }, (_, i) => width - 1 - i) }) });
    return [
        ...design.ports.map(p => port(p.name, p.direction, p.width === undefined ? 1 : typeof p.width === 'number' ? p.width : resolvePhysicalInteger(p.width.expression))),
        ...resolved.interfaces.endpoints.flatMap(e => e.endpoint.kind === 'port' ? e.members.map(m => port(m.port, m.portDirection, m.width.kind === 'known' ? m.width.bits : undefined)) : []),
    ];
}
