import { randomBytes } from 'crypto';
import {
    link,
    mkdir,
    open,
    readFile,
    rename,
    unlink,
} from 'fs/promises';
import * as path from 'path';
import { parseArchDesignRtlMarker } from '@veriflow/schematic-core/arch-design';

export type ArchDesignExportFileOperations = Readonly<{
    readFile(filepath: string): Promise<string>;
    makeDirectory(directory: string): Promise<void>;
    writeTemporary(filepath: string, text: string): Promise<void>;
    link(source: string, target: string): Promise<void>;
    rename(source: string, target: string): Promise<void>;
    remove(filepath: string): Promise<void>;
}>;

export class ArchDesignGeneratedFileConflictError extends Error {
    readonly code = 'AD_GENERATED_FILE_CONFLICT';

    constructor(readonly outputPath: string) {
        super(`Generated file conflict: ${outputPath}`);
        this.name = 'ArchDesignGeneratedFileConflictError';
    }
}

async function writeTemporary(filepath: string, text: string): Promise<void> {
    const handle = await open(filepath, 'wx');
    let failed = false;
    try {
        await handle.writeFile(text, 'utf8');
        await handle.sync();
    } catch (error) {
        failed = true;
        throw error;
    } finally {
        try {
            await handle.close();
        } catch (error) {
            if (!failed) throw error;
        }
    }
}

const DEFAULT_FILE_OPERATIONS: ArchDesignExportFileOperations = Object.freeze({
    readFile: filepath => readFile(filepath, 'utf8'),
    makeDirectory: directory => mkdir(directory, { recursive: true }).then(() => undefined),
    writeTemporary,
    link,
    rename,
    remove: unlink,
});

function hasErrorCode(error: unknown, code: string): boolean {
    return (error as NodeJS.ErrnoException).code === code;
}

async function inspectTarget(
    outputPath: string,
    operations: ArchDesignExportFileOperations
): Promise<{ exists: false } | { exists: true; text: string }> {
    try {
        return { exists: true, text: await operations.readFile(outputPath) };
    } catch (error) {
        if (hasErrorCode(error, 'ENOENT')) return { exists: false };
        throw error;
    }
}

function temporaryPathFor(outputPath: string): string {
    return path.join(
        path.dirname(outputPath),
        `${path.basename(outputPath)}.${process.pid}.${randomBytes(16).toString('hex')}.tmp`
    );
}

export async function publishGeneratedFile(
    outputPath: string,
    text: string,
    operationOverrides: Partial<ArchDesignExportFileOperations> = {},
    generated: (text: string) => boolean = text => parseArchDesignRtlMarker(text) !== undefined
): Promise<void> {
    const operations: ArchDesignExportFileOperations = {
        ...DEFAULT_FILE_OPERATIONS,
        ...operationOverrides,
    };
    const initial = await inspectTarget(outputPath, operations);
    const check = (text: string): void => { if (!generated(text)) throw new ArchDesignGeneratedFileConflictError(outputPath); };
    if (initial.exists) check(initial.text);

    await operations.makeDirectory(path.dirname(outputPath));
    const temporaryPath = temporaryPathFor(outputPath);
    let temporaryMayExist = false;
    let failed = false;
    try {
        try {
            await operations.writeTemporary(temporaryPath, text);
            temporaryMayExist = true;
        } catch (error) {
            temporaryMayExist = !hasErrorCode(error, 'EEXIST');
            throw error;
        }

        const publishWithoutClobber = async (): Promise<void> => {
            try {
                await operations.link(temporaryPath, outputPath);
            } catch (error) {
                if (hasErrorCode(error, 'EEXIST')) {
                    throw new ArchDesignGeneratedFileConflictError(outputPath);
                }
                throw error;
            }
        };
        if (!initial.exists) {
            await publishWithoutClobber();
            return;
        }

        const current = await inspectTarget(outputPath, operations);
        if (!current.exists) {
            await publishWithoutClobber();
            return;
        }
        check(current.text);
        if (current.text !== initial.text) throw new ArchDesignGeneratedFileConflictError(outputPath);
        await operations.rename(temporaryPath, outputPath);
        temporaryMayExist = false;
    } catch (error) {
        failed = true;
        throw error;
    } finally {
        if (temporaryMayExist) {
            try {
                await operations.remove(temporaryPath);
            } catch (error) {
                if (!hasErrorCode(error, 'ENOENT') && !failed) throw error;
            }
        }
    }
}
