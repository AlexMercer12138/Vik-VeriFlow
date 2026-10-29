import * as path from 'node:path';
import { readPhysicalBoardFile, UserPhysicalBoardLibrary } from '@veriflow/hdl-runtime/physical';
import type { CommandEnvironment, CommandOptions } from './project';
import { emitText, result } from './artifacts';
export interface BoardEditorLauncher { open(configPath: string): Promise<void>; }
export function boardLibrary(env: CommandEnvironment): UserPhysicalBoardLibrary { return new UserPhysicalBoardLibrary({ configPath: path.join(env.homeDir, '.veriflow_config.json') }); }
export async function boardCommand(action: string, options: CommandOptions, env: CommandEnvironment & { boardEditorLauncher?: BoardEditorLauncher }): Promise<number> {
    const library = boardLibrary(env);
    if (action === 'ui') {
        if (!env.boardEditorLauncher) throw new Error('Board editor launcher is unavailable');
        await env.boardEditorLauncher.open(library.configPath);
        env.stdout('Board editor launched\n');
        return 0;
    }
    if (action === 'list') {
        const boards = library.list().map(({ id, name, model }) => ({ id, name, kind: model.kind, extension: model.extension }));
        if (options.json)
            result(options, env, { boards, diagnostics: [] });
        else
            env.stdout(boards.map(b => `user:${b.id}\t${b.name}\t${b.kind}\t${b.extension ?? 'reimport constraints'}`).join('\n') + '\n');
        return 0;
    }
    const reference = options.board!;
    if (action === 'import') {
        if (reference.startsWith('user:'))
            throw new Error('Import requires a profile JSON or constraint file');
        const id = await library.importBoard(path.resolve(env.cwd, reference), options.name, options.id, !!options.dryRun, options.kind as 'board' | 'daughtercard' | undefined);
        if (options.json)
            result(options, env, { board: 'user:' + id, diagnostics: [] });
        else
            env.stdout(options.dryRun ? 'Board import validated\n' : 'Board imported: user:' + id + '\n');
        return 0;
    }
    const data = reference.startsWith('user:') ? library.get(reference.slice(5)) : await readPhysicalBoardFile(path.resolve(env.cwd, reference));
    if (action === 'export')
        return emitText(JSON.stringify(data, null, 2) + '\n', 'board', options, env);
    if (options.json)
        result(options, env, { diagnostics: [], board: reference });
    else
        env.stdout('Board: OK\n');
    return 0;
}
