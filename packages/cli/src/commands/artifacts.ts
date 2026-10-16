import * as path from 'node:path';
import { checkArtifactPlan, publishArtifactPlan, type ArtifactPlan } from '@veriflow/hdl-runtime/archDesign';
import type { CommandEnvironment, CommandOptions } from './project';

export function result(options: CommandOptions, env: CommandEnvironment, data: unknown): void {
    env.stdout(JSON.stringify({ format: 'veriflow-result', schemaVersion: 1, ...data as object }, null, 2) + '\n');
}
export async function emitText(text: string, kind: string, options: CommandOptions, env: CommandEnvironment, inputs: ArtifactPlan['inputs'] = [], owns: (text: string) => boolean = () => false): Promise<number> {
    const artifacts = options.output ? [{ kind, path: path.resolve(env.cwd, options.output), text, owns, replacesInput: !!options.inPlace }] : [];
    const plan = { diagnostics: [], inputs, artifacts };
    if (options.dryRun || !artifacts.length) await checkArtifactPlan(plan);
    else if (artifacts.length) await publishArtifactPlan(plan);
    if (options.json) result(options, env, { diagnostics: [], artifacts: artifacts.map(({ owns, ...item }) => item), ...(artifacts.length ? {} : { text }) });
    else if (!options.output) env.stdout(text);
    else env.stdout(`${kind}: ${artifacts[0].path}\n`);
    return 0;
}
export async function emitDocument(source: string | undefined, original: string | undefined, text: string, options: CommandOptions, env: CommandEnvironment, dependencies: ArtifactPlan['inputs'] = []): Promise<number> {
    if (source && (!!options.output === !!options.inPlace)) throw new Error('Choose exactly one of --output or --in-place');
    if (source && options.output && path.dirname(path.resolve(env.cwd, options.output)) !== path.dirname(source))
        throw new Error('Save edited documents in the same directory to preserve relative references');
    const target = options.inPlace ? source! : path.resolve(env.cwd, options.output!);
    if (source && options.output && path.resolve(target) === path.resolve(source)) throw new Error('Use --in-place to replace the source');
    return emitText(text, 'document', { ...options, output: target }, env, [...dependencies, ...(source && original !== undefined ? [{ path: source, text: original }] : [])],
        previous => !!options.inPlace && previous === original);
}
