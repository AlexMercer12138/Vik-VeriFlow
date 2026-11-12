import { createHash, randomUUID } from 'node:crypto';
import { readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

export interface WorkbenchDocumentSnapshot {
    text: string;
    version: string;
}

export interface WorkbenchDocumentHost {
    readText(filepath: string): Promise<WorkbenchDocumentSnapshot>;
    replaceText(filepath: string, expectedVersion: string, nextText: string): Promise<WorkbenchDocumentSnapshot>;
}

export class NodeFileDocumentHost implements WorkbenchDocumentHost {
    private readonly writeTails = new Map<string, Promise<void>>();

    async readText(filepath: string): Promise<WorkbenchDocumentSnapshot> {
        const absolutePath = path.resolve(filepath);
        const text = await readFile(absolutePath, 'utf8');
        return { text, version: versionOf(text) };
    }

    async replaceText(
        filepath: string,
        expectedVersion: string,
        nextText: string,
    ): Promise<WorkbenchDocumentSnapshot> {
        const absolutePath = path.resolve(filepath);
        const key = process.platform === 'win32' ? absolutePath.toLowerCase() : absolutePath;
        const previous = this.writeTails.get(key) ?? Promise.resolve();
        const operation = previous.then(async () => {
            const current = await this.readText(absolutePath);
            if (current.version !== expectedVersion) {
                throw new Error(`Document changed since it was read: ${absolutePath}`);
            }

            const temporaryPath = `${absolutePath}.veriflow-${randomUUID()}.tmp`;
            try {
                await writeFile(temporaryPath, nextText, 'utf8');
                const latest = await this.readText(absolutePath);
                if (latest.version !== expectedVersion) {
                    throw new Error(`Document changed since it was read: ${absolutePath}`);
                }
                await rename(temporaryPath, absolutePath);
                return { text: nextText, version: versionOf(nextText) };
            } finally {
                await rm(temporaryPath, { force: true });
            }
        });
        const tail = operation.then(() => undefined, () => undefined);
        this.writeTails.set(key, tail);
        try {
            return await operation;
        } finally {
            if (this.writeTails.get(key) === tail) this.writeTails.delete(key);
        }
    }
}

function versionOf(text: string): string {
    return createHash('sha256').update(text, 'utf8').digest('hex');
}
