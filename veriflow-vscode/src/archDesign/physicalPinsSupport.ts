import type { IndexedParameterSummary, IndexedPortSummary } from '../core/hdl/workspaceIndexTypes';
import { resolveArchDesign, resolvePhysicalInteger, type ArchDesign, type ArchDesignModuleDefinition, type PhysicalPort, } from '@veriflow/schematic-core/arch-design';
import type { InterfaceProtocolCatalog } from '@veriflow/schematic-core/interfaces';
export function rtlPhysicalPorts(ports: readonly IndexedPortSummary[], parameters: readonly IndexedParameterSummary[] = []): PhysicalPort[] {
    return ports.map(port => {
        if (!port.packedRange)
            return { name: port.name, direction: port.direction };
        const range = /^\[([^\[\]]+):([^\[\]]+)\]$/.exec(port.packedRange.trim());
        const left = range && resolvePhysicalInteger(range[1], parameters);
        const right = range && resolvePhysicalInteger(range[2], parameters);
        if (typeof left !== 'number' || typeof right !== 'number' || Math.abs(left - right) >= 4096)
            return { name: port.name, direction: port.direction, unresolved: true };
        return { name: port.name, direction: port.direction, indices: Array.from({ length: Math.abs(left - right) + 1 }, (_, i) => left + (left <= right ? i : -i)) };
    });
}
export function adPhysicalPorts(design: ArchDesign, definitions: readonly ArchDesignModuleDefinition[], catalog: InterfaceProtocolCatalog): PhysicalPort[] {
    const resolved = resolveArchDesign(design, definitions, catalog);
    const port = (name: string, direction: PhysicalPort['direction'], width: number | undefined): PhysicalPort => ({ name, direction,
        ...(width === undefined || width > 4096 ? { unresolved: true } : width === 1 ? {} : { indices: Array.from({ length: width }, (_, i) => width - 1 - i) }) });
    return [
        ...design.ports.map(p => port(p.name, p.direction, p.width === undefined ? 1 : typeof p.width === 'number' ? p.width : resolvePhysicalInteger(p.width.expression))),
        ...resolved.interfaces.endpoints.flatMap(e => e.endpoint.kind === 'port' ? e.members.map(m => port(m.port, m.portDirection, m.width.kind === 'known' ? m.width.bits : undefined)) : []),
    ];
}
