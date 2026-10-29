import * as path from 'node:path';
import { createPhysicalBoard, type PhysicalBoard, type PhysicalConfiguration } from '@veriflow/schematic-core/arch-design';
import { readPhysicalBoardFile, UserPhysicalBoardLibrary } from './boardLibrary';
export async function resolvePhysicalBoard(ownerPath: string, reference: string, options: {
    configPath?: string;
    library?: UserPhysicalBoardLibrary;
    onInput?: (file: string, text: string) => void;
} = {}, sources?: (files: string[]) => void): Promise<PhysicalBoard> {
    const library = options.library ?? new UserPhysicalBoardLibrary({ configPath: options.configPath });
    if (/^user:[A-Za-z0-9_][A-Za-z0-9_.-]*$/.test(reference)) {
        sources?.([library.configPath]);
        return library.load(reference.slice(5), options.onInput);
    }
    if (!/^(?![A-Za-z][A-Za-z0-9+.-]*:)(?![/\\])(?!.*[\r\n\0]).+$/.test(reference))
        throw new Error('Use a saved user board or relative workspace board path');
    const file = path.resolve(path.dirname(ownerPath), reference);
    sources?.([file]);
    return createPhysicalBoard((await readPhysicalBoardFile(file, options.onInput)).model);
}
export async function resolvePhysicalConfiguration(ownerPath: string, configuration: PhysicalConfiguration, options: Parameters<typeof resolvePhysicalBoard>[2] = {}): Promise<PhysicalBoard> {
    const board = await resolvePhysicalBoard(ownerPath, configuration.board, options);
    if (board.model.kind !== 'board')
        throw new Error('Select a main board profile');
    board.cards = Object.create(null);
    for (const card of configuration.cards ?? [])
        board.cards![card.id] = (await resolvePhysicalBoard(ownerPath, card.board, options)).model;
    return board;
}
