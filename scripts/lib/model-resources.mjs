import { mkdir, readFile, readdir, copyFile, unlink } from 'node:fs/promises';
import path from 'node:path';

export async function copyPhysicalInterfaces(root, destination) {
    await mkdir(destination, { recursive: true });
    const source = path.join(root, 'data/physical-models/interfaces');
    const names = (await readdir(source)).filter(name => /\.(fixed|expansion)\.json$/.test(name)).sort();
    for (const name of await readdir(destination)) {
        if (/\.(fixed|expansion)\.json$/.test(name) && !names.includes(name)) await unlink(path.join(destination, name));
    }
    for (const name of names) {
        if (!/\.(fixed|expansion)\.json$/.test(name)) continue;
        const file = path.join(source, name);
        const model = JSON.parse(await readFile(file, 'utf8'));
        if (!['fixed', 'expansion'].includes(model.kind)) throw new Error(`Invalid reusable interface: ${file}`);
        await copyFile(file, path.join(destination, name));
    }
}
