import * as path from 'node:path';
import { createPhysicalBoard, type PhysicalBoard } from '@veriflow/schematic-core/arch-design';
import { readPhysicalBoardFile, UserPhysicalBoardLibrary } from './boardLibrary';

/** Installed resources, independent of the working directory. Hosts may inject their own copy. */
export function physicalInterfaceRoot(): string {
    return path.resolve(__dirname, '../../resources/physical-models/interfaces');
}

export async function resolvePhysicalBoard(
    ownerPath: string,
    reference: string,
    options: { interfaceRoot?: string; configPath?: string; library?: UserPhysicalBoardLibrary; onInput?: (file: string, text: string) => void } = {},
    sources?: (files: string[]) => void
): Promise<PhysicalBoard> {
    const interfaceRoot = options.interfaceRoot ?? physicalInterfaceRoot();
    const library = options.library ?? new UserPhysicalBoardLibrary({ interfaceRoot, configPath: options.configPath });
    if (/^user:[A-Za-z0-9_][A-Za-z0-9_.-]*$/.test(reference)) {
        sources?.([library.configPath]);
        return library.load(reference.slice(5), sources, options.onInput);
    }
    if (!/^(?![A-Za-z][A-Za-z0-9+.-]*:)(?![/\\])(?!.*[\r\n\0]).+$/.test(reference))
        throw new Error('Choose a saved user board or use a relative workspace board path');
    const file = path.resolve(path.dirname(ownerPath), reference);
    sources?.([file]);
    const data = await readPhysicalBoardFile(file, interfaceRoot, sources, options.onInput);
    return createPhysicalBoard(data.model, data.definitions);
}
