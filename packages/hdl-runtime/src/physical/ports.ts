import type { IndexedParameterSummary, IndexedPortSummary } from '../workspaceIndexTypes';
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
