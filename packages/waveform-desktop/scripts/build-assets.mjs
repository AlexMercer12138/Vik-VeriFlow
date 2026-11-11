import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { build } from 'esbuild';
import { copyTree, recreate } from '../../../scripts/lib/files.mjs';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repositoryRoot = path.resolve(packageRoot, '..', '..');
await build({
    entryPoints: [path.join(packageRoot, 'src', 'preload.ts')],
    outfile: path.join(packageRoot, 'dist', 'preload.js'),
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node24',
    external: ['electron'],
    sourcemap: true,
});

for (const application of ['constraints', 'schematic', 'waveform']) {
    const destination = path.join(packageRoot, 'assets', application);
    await recreate(destination);
    await copyTree(path.join(repositoryRoot, 'web-dist', application), destination);
}
