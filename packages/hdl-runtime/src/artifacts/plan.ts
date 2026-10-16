import { lstat, readFile, realpath } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import * as path from 'node:path';
import type { WorkspaceHdlIndex } from '../workspaceHdlIndex';
import { publishGeneratedFile, ArchDesignGeneratedFileConflictError } from './generatedFile';

export type ArtifactDiagnostic = { code: string; path: string; message: string };
export type PlannedArtifact = { kind: string; path: string; text: string; replacesInput?: boolean; owns(text: string): boolean };
export type ArtifactPlan = {
    diagnostics: ArtifactDiagnostic[];
    artifacts: PlannedArtifact[];
    inputs: { path: string; text: string }[];
};
export async function optionalFile(file: string): Promise<string | undefined> {
    try { return await readFile(file, 'utf8'); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error; }
}
export async function physicalPath(file: string): Promise<string> {
    try { return await realpath(file); }
    catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        const parent = path.dirname(file);
        return parent === file ? file : path.join(await physicalPath(parent), path.basename(file));
    }
}
/** Capture bytes only if they still match the HDL index used to prepare the result. */
export async function snapshotIndexedInputs(index: WorkspaceHdlIndex, uris: readonly string[]): Promise<ArtifactPlan['inputs']> {
    const seen = new Set<string>(), inputs: ArtifactPlan['inputs'] = [];
    const pending = [...uris];
    while (pending.length) {
        const uri = pending.pop()!;
        if (seen.has(uri)) continue;
        seen.add(uri);
        const entry = index.getFile(uri);
        if (!entry) throw new Error(`HDL input is no longer indexed: ${uri}`);
        const file = fileURLToPath(uri), text = await readFile(file, 'utf8');
        if (`sha256:${createHash('sha256').update(text).digest('hex')}` !== entry.contentHash)
            throw new Error(`HDL input changed; refresh before generating: ${file}`);
        inputs.push({ path: file, text });
        pending.push(...entry.includeUris);
    }
    return inputs;
}

/** Validate the entire plan without writing; used by both dry-run and publication. */
export async function checkArtifactPlan(plan: ArtifactPlan): Promise<Map<string, string | undefined>> {
    if (plan.diagnostics.length) throw new Error(plan.diagnostics.map(d => `${d.path} [${d.code}] ${d.message}`).join('\n'));
    const targets = new Set<string>();
    const inputs = new Set(await Promise.all(plan.inputs.map(async input => process.platform === 'win32' ? (await physicalPath(input.path)).toLowerCase() : await physicalPath(input.path))));
    const snapshots = new Map<string, string | undefined>();
    for (const input of plan.inputs) {
        if (await optionalFile(input.path) !== input.text) throw new Error(`Input changed before publication: ${input.path}`);
    }
    for (const artifact of plan.artifacts) {
        const entry = await lstat(artifact.path).catch(error => {
            if (error.code === 'ENOENT') return undefined;
            throw error;
        });
        if (entry && (!entry.isFile() || entry.isSymbolicLink())) throw new ArchDesignGeneratedFileConflictError(artifact.path);
        const identity = await physicalPath(artifact.path);
        const key = process.platform === 'win32' ? identity.toLowerCase() : identity;
        if (targets.has(key) || (inputs.has(key) && !artifact.replacesInput)) throw new Error(`Artifact path overlaps an input or output: ${artifact.path}`);
        targets.add(key);
        const text = await optionalFile(artifact.path);
        if (text !== undefined && !artifact.owns(text)) throw new ArchDesignGeneratedFileConflictError(artifact.path);
        snapshots.set(artifact.path, text);
    }
    return snapshots;
}
export async function publishArtifactPlan(plan: ArtifactPlan): Promise<string[]> {
    const snapshots = await checkArtifactPlan(plan);
    const published: string[] = [];
    try {
        for (const artifact of plan.artifacts) {
            for (const input of plan.inputs) {
                if (await optionalFile(input.path) !== input.text) throw new Error(`Input changed before publication: ${input.path}`);
            }
            // Check every remaining target before each publication.
            for (const remaining of plan.artifacts.filter(a => !published.includes(a.path))) {
                if (await optionalFile(remaining.path) !== snapshots.get(remaining.path))
                    throw new ArchDesignGeneratedFileConflictError(remaining.path);
            }
            await publishGeneratedFile(artifact.path, artifact.text, {}, artifact.owns);
            published.push(artifact.path);
        }
    } catch (error) {
        if (published.length) throw new Error(`${(error as Error).message}\nAlready published: ${published.join(', ')}`);
        throw error;
    }
    return published;
}
