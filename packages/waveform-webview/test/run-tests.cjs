const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { buildSync } = require('esbuild');

const bundle = buildSync({
    entryPoints: [path.join(__dirname, 'viewerCore.test.ts')],
    bundle: true,
    platform: 'node',
    write: false,
});
execFileSync(process.execPath, ['-'], {
    input: bundle.outputFiles[0].text,
    stdio: ['pipe', 'inherit', 'inherit'],
});
