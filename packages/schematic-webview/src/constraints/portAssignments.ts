import type { PhysicalBinding, PhysicalPort } from '@veriflow/schematic-core/arch-design';

export type PortRef = PhysicalBinding['port'];
export const portKey = (ref: PortRef): string => JSON.stringify([ref.name, ref.bit ?? null]);

export function portLabel(name: string, indices?: readonly number[]): string {
    if (!indices?.length) return name;
    return `${name}[${indices.length === 1 ? indices[0] : `${indices[0]}:${indices[indices.length - 1]}`}]`;
}

export function selectedPortBits(ports: readonly PhysicalPort[], selected: ReadonlySet<string>): PortRef[] {
    return ports.flatMap(port => (port.indices ?? [undefined])
        .filter(bit => selected.has(portKey({ name: port.name })) || selected.has(portKey({ name: port.name, bit })))
        .map(bit => ({ name: port.name, ...(bit === undefined ? {} : { bit }) })));
}

/** Adjacent bits form one movable bus slice; order follows target pins, high to low. */
export function portGroups(refs: readonly PortRef[]): PortRef[][] {
    const groups: PortRef[][] = [];
    for (const ref of refs) {
        const group = groups[groups.length - 1], previous = group?.[group.length - 1];
        const step = group?.length > 1 ? group[1].bit! - group[0].bit! : undefined;
        if (previous?.name === ref.name && previous.bit !== undefined && ref.bit !== undefined
            && Math.abs(ref.bit - previous.bit) === 1 && (step === undefined || ref.bit - previous.bit === step)) group.push(ref);
        else groups.push([ref]);
    }
    return groups;
}

export const groupLabel = (group: readonly PortRef[]): string => portLabel(group[0].name,
    group[0].bit === undefined ? undefined : group.map(ref => ref.bit!));
