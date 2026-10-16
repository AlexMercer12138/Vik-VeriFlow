import { copyPhysicalInterfaces } from './lib/model-resources.mjs';
import { execFileSync } from 'node:child_process';
import { copyFile, mkdir } from 'node:fs/promises';
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
    await copyPhysicalInterfaces(repositoryRoot, interfaces);
    const schemas = path.join(targetExtensionRoot, 'schemas');
    await mkdir(schemas, { recursive: true });
    await copyFile(path.join(repositoryRoot, 'packages/hdl-runtime/schemas/simulation-task.schema.json'), path.join(schemas, 'simulation-task.schema.json'));
    await copyFile(path.join(repositoryRoot, 'packages/schematic-core/schemas/physical-interface-model.schema.json'), path.join(schemas, 'physical-interface-model.schema.json'));
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
