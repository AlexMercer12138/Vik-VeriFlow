const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { buildSync } = require('esbuild');
for (const name of ['taskProtocol', 'taskInspector']) {
    const bundle = buildSync({
        entryPoints: [path.join(__dirname, `${name}.test.ts`)],
        bundle: true,
        platform: 'node',
        write: false,
    });
    execFileSync(process.execPath, ['-'], { input: bundle.outputFiles[0].text, stdio: ['pipe', 'inherit', 'inherit'] });
}
