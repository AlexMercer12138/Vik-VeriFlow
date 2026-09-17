import { spawnSync } from 'node:child_process';
import { readdir } from 'node:fs/promises';
import path from 'node:path';

const testRoot = path.join(process.cwd(), 'out', 'test');
const sourceRoot = path.join(process.cwd(), 'src', 'test');
const finalTests = ['vsixPackaging.test.js'];
// TypeScript leaves old output behind when source tests are deleted or renamed.
// Discover current tests from source; a missing compiled test still fails below.
const regularFiles = (await readdir(sourceRoot))
    .filter(name => name.endsWith('.test.ts'))
    .map(name => name.replace(/\.ts$/, '.js'))
    .filter(name => !finalTests.includes(name)).sort();
const files = [...regularFiles, ...finalTests];

for (const file of files) {
    const result = spawnSync(process.execPath, [path.join(testRoot, file)], {
        stdio: 'inherit',
    });
    if (result.status !== 0) {
        process.exit(result.status ?? 1);
    }
}

console.log(`passed ${files.length} test files`);
