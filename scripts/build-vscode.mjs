import { execFileSync } from 'node:child_process';
import { copyFile, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildWeb } from './build-web.mjs';
import { copyTree, recreate } from './lib/files.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const extensionRoot = path.join(root, 'veriflow-vscode');
const applications = ['waveform', 'schematic'];

function runNpm(args, cwd) {
    const npmExecPath = process.env.npm_execpath;
    const command = npmExecPath
        ? process.execPath
        : process.platform === 'win32' ? 'npm.cmd' : 'npm';
    execFileSync(command, [...(npmExecPath ? [npmExecPath] : []), ...args], {
        cwd,
        stdio: 'inherit',
    });
}

export async function syncVscodeWebAssets(repositoryRoot = root) {
    const targetExtensionRoot = path.join(repositoryRoot, 'veriflow-vscode');
    for (const application of applications) {
        const destination = path.join(targetExtensionRoot, 'media', application);
        await recreate(destination);
        await copyTree(path.join(repositoryRoot, 'web-dist', application), destination);
    }
    const physicalModels = path.join(targetExtensionRoot, 'resources', 'physical-models');
    await recreate(physicalModels);
    const interfaces = path.join(physicalModels, 'interfaces');
    await recreate(interfaces);
    const source = path.join(repositoryRoot, 'data', 'physical-models', 'interfaces');
    for (const name of await readdir(source)) {
        if (!/\.(fixed|expansion)\.json$/.test(name)) continue;
        const file = path.join(source, name);
        const model = JSON.parse(await readFile(file, 'utf8'));
        if (!['fixed', 'expansion'].includes(model.kind))
            throw new Error(`Expected reusable physical interface: ${file}`);
        await copyFile(file, path.join(interfaces, name));
    }
}

export async function buildVscode() {
    runNpm(['run', 'build:shared'], root);
    runNpm(['run', 'compile:ts'], extensionRoot);
    await buildWeb({ buildDependencies: false });
    execFileSync(process.execPath, [path.join(extensionRoot, 'scripts/build.mjs')], {
        cwd: extensionRoot,
        stdio: 'inherit',
    });

    await syncVscodeWebAssets();
}

const isMain = process.argv[1]
    && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (isMain) {
    await buildVscode();
}
