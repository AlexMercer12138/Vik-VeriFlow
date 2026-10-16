import * as path from 'node:path';
import { createPhysicalBoard } from '@veriflow/schematic-core/arch-design';
import { physicalInterfaceRoot, readPhysicalBoardFile, UserPhysicalBoardLibrary } from '@veriflow/hdl-runtime/physical';
import type { CommandEnvironment, CommandOptions } from './project';
import { emitText, result } from './artifacts';

export function boardLibrary(env: CommandEnvironment): UserPhysicalBoardLibrary {
    return new UserPhysicalBoardLibrary({ interfaceRoot: physicalInterfaceRoot(), configPath: path.join(env.homeDir, '.veriflow_config.json') });
}
export async function boardCommand(action: string, options: CommandOptions, env: CommandEnvironment): Promise<number> {
    const library = boardLibrary(env);
    if (action === 'list') {
        const boards = library.list().map(({ id, name, model }) => ({ id, name, vendor: model.vendor, device: model.device }));
        if (options.json) result(options, env, { boards, diagnostics: [] });
        else env.stdout(boards.map(board => `user:${board.id}\t${board.name}\t${board.device}`).join('\n') + '\n');
        return 0;
    }
    const reference = options.board!;
    const data = reference.startsWith('user:') ? library.get(reference.slice(5))
        : await readPhysicalBoardFile(path.resolve(env.cwd, reference), physicalInterfaceRoot());
    createPhysicalBoard(data.model, data.definitions);
    if (action === 'export') return emitText(JSON.stringify(data, null, 2) + '\n', 'board', options, env);
    if (action === 'import') {
        if (reference.startsWith('user:')) throw new Error('Import requires a board JSON file');
        const id = await library.importBoard(path.resolve(env.cwd, reference), options.name, options.id, !!options.dryRun);
        if (options.json) result(options, env, { board: id ? `user:${id}` : undefined, diagnostics: [] });
        else env.stdout(options.dryRun ? 'Board import validated\n' : `Board imported: user:${id}\n`);
    } else if (options.json) result(options, env, { diagnostics: [], board: reference });
    else env.stdout('Board: OK\n');
    return 0;
}
