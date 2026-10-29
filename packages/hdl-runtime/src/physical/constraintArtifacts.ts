import { createHash } from 'node:crypto';
import * as path from 'node:path';
import { optionalFile, type PlannedArtifact } from '../artifacts/plan';
const hash = (text: string) => createHash('sha256').update(text).digest('hex');
/** Keep ownership outside user constraint text so every syntax remains untouched. */
export async function constraintArtifacts(source: string, output: string, text: string): Promise<PlannedArtifact[]> {
    const metadataPath = output + '.veriflow.json', previous = await optionalFile(metadataPath);
    const sourceId = path.relative(path.dirname(output), source).replace(/\\/g, '/'), record = { source: sourceId, sha256: hash(text) };
    let owner: {
        source?: string;
        sha256?: string;
    } | undefined;
    try {
        owner = previous === undefined ? undefined : JSON.parse(previous);
    }
    catch { /* An unrelated metadata file is a conflict. */ }
    const owned = owner?.source === sourceId;
    return [
        { kind: 'constraints', path: output, text, owns: old => owned && owner?.sha256 === hash(old) },
        { kind: 'constraints-metadata', path: metadataPath, text: JSON.stringify(record, null, 2) + '\n', owns: old => owned && old === previous },
    ];
}
