import { build } from 'esbuild';
import { readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { browserBuildOptions } from './lib/build-config.mjs';
import { copyTree, recreate } from './lib/files.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const webDistRoot = path.join(root, 'web-dist');

export const webApplications = [
    { name: 'constraints', sourceRoot: 'packages/schematic-webview/src/constraints', staticFiles: ['index.html'], appStylesheet: 'index.css', legacyScripts: ['index.js'] },
    {
        name: 'waveform',
        sourceRoot: 'packages/waveform-webview/src',
        staticFiles: ['index.html'],
        appStylesheet: 'index.css',
        legacyScripts: ['index.js'],
        browserGlobals: [
            { entryPoint: 'viewer-transport.ts', globalName: 'VeriflowWaveTransport', outfile: 'viewer-transport.js' },
            { entryPoint: 'viewer-core.ts', globalName: 'VeriflowWaveCore', outfile: 'viewer-core.js' },
        ],
        htmlFragment: true,
    },
    {
        name: 'schematic',
        sourceRoot: 'packages/schematic-webview/src',
        staticFiles: ['index.html'],
        appStylesheet: 'index.css',
        entryPoint: 'index.ts',
    },
];

async function writeApplicationStyles(application, sourceRoot, destinationRoot) {
    const [tokens, base, app] = await Promise.all([
        readFile(path.join(root, 'packages/webview-ui/src/tokens.css'), 'utf8'),
        readFile(path.join(root, 'packages/webview-ui/src/base.css'), 'utf8'),
        readFile(path.join(sourceRoot, application.appStylesheet), 'utf8'),
    ]);
    await writeFile(
        path.join(destinationRoot, 'index.css'),
        `${tokens}\n${base}\n${app}`,
        'utf8'
    );
}

async function buildApplication(application) {
    const sourceRoot = path.join(root, application.sourceRoot);
    const destinationRoot = path.join(webDistRoot, application.name);

    for (const file of application.staticFiles) {
        await copyTree(path.join(sourceRoot, file), path.join(destinationRoot, file));
    }
    if (application.htmlFragment) {
        const body = await readFile(path.join(destinationRoot, 'index.html'), 'utf8');
        await writeFile(path.join(destinationRoot, 'index.html'), `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self';">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>VeriFlow Waveform</title>
<link rel="stylesheet" href="./index.css">
</head>
<body>
${body}
<script src="./viewer-transport.js"></script>
<script src="./viewer-core.js"></script>
<script src="./index.js"></script>
</body>
</html>
`, 'utf8');
    }
    await writeApplicationStyles(application, sourceRoot, destinationRoot);
    for (const file of application.legacyScripts ?? []) {
        await copyTree(path.join(sourceRoot, file), path.join(destinationRoot, file));
    }
    if (application.entryPoint) {
        await build({
            ...browserBuildOptions(),
            absWorkingDir: root,
            entryPoints: [path.join(sourceRoot, application.entryPoint)],
            outfile: path.join(destinationRoot, 'index.js'),
        });
    }
    for (const browserGlobal of application.browserGlobals ?? []) {
        await build({
            ...browserBuildOptions(),
            absWorkingDir: root,
            entryPoints: [path.join(sourceRoot, browserGlobal.entryPoint)],
            globalName: browserGlobal.globalName,
            outfile: path.join(destinationRoot, browserGlobal.outfile),
        });
    }
}

function buildWebDependencies() {
    const npmExecPath = process.env.npm_execpath;
    const command = npmExecPath
        ? process.execPath
        : process.platform === 'win32' ? 'npm.cmd' : 'npm';
    const prefix = npmExecPath ? [npmExecPath] : [];
    for (const workspace of ['@veriflow/flow-core', '@veriflow/hdl-core', '@veriflow/schematic-core', '@veriflow/hdl-runtime']) {
        execFileSync(command, [
            ...prefix,
            'run',
            'build',
            '--workspace',
            workspace,
        ], {
            cwd: root,
            stdio: 'inherit',
        });
    }
}

export async function buildWeb(options = {}) {
    if (options.buildDependencies !== false) buildWebDependencies();
    await recreate(webDistRoot);
    for (const application of webApplications) {
        await buildApplication(application);
    }
}

const isMain = process.argv[1]
    && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (isMain) {
    await buildWeb();
}
