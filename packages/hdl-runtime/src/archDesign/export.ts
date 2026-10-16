import { randomBytes } from 'crypto';
import {
    link,
    mkdir,
    open,
    readFile,
    realpath,
    rename,
    unlink,
} from 'fs/promises';
import * as path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

import {
    exportArchDesignRtl,
    parseArchDesignRtlMarker,
    type ArchDesign,
    type ArchDesignDiagnostic,
    type ArchDesignLanguage,
} from '@veriflow/schematic-core/arch-design';
import type { InterfaceProtocolCatalog } from '@veriflow/schematic-core/interfaces';

import type { HdlDefinitionSummary } from '../workspaceIndexTypes';
import { canonicalizeSourceUri } from '@veriflow/hdl-core/preprocessor';
import { toArchDesignModuleDefinitions } from './definitions';

import { publishGeneratedFile, type ArchDesignExportFileOperations } from '../artifacts/generatedFile';
export * from '../artifacts/generatedFile';
export type ArchDesignFileExportOptions = Partial<ArchDesignExportFileOperations> & Readonly<{
    interfaceCatalog?: InterfaceProtocolCatalog;
}>;

export type ArchDesignFileExportResult =
    | Readonly<{
        status: 'published';
        outputPath: string;
        language: ArchDesignLanguage;
    }>
    | Readonly<{
        status: 'invalid';
        diagnostics: readonly ArchDesignDiagnostic[];
    }>;

function outputPathFor(designPath: string, design: ArchDesign): {
    language: ArchDesignLanguage;
    outputPath: string;
} {
    const language = design.export.language ?? 'verilog';
    const extension = language === 'verilog' ? '.v' : '.sv';
    const outputPath = design.export.output === undefined
        ? path.join(
            path.dirname(designPath),
            `${path.basename(designPath, path.extname(designPath))}${extension}`
        )
        : path.resolve(path.dirname(designPath), design.export.output);
    if (path.extname(outputPath).toLowerCase() !== extension) {
        throw new Error(
            `Output file extension must be ${extension} for ${language}: ${outputPath}`
        );
    }
    return { language, outputPath };
}

export function archDesignXdcOutputPath(designPath: string, design: ArchDesign): string {
    const rtl = outputPathFor(designPath, design).outputPath;
    const output = design.export.xdcOutput === undefined
        ? rtl.slice(0, -path.extname(rtl).length) + '.xdc'
        : path.resolve(path.dirname(designPath), design.export.xdcOutput);
    if (path.extname(output).toLowerCase() !== '.xdc') throw new Error('Constraint output must use .xdc');
    return output;
}

function portableSourcePath(designPath: string, outputPath: string): string {
    const relative = path.relative(path.dirname(outputPath), designPath);
    return (path.isAbsolute(relative) ? designPath : relative).replace(/\\/g, '/');
}

function canonicalFileUri(filepath: string): string {
    return canonicalizeSourceUri(pathToFileURL(filepath).toString());
}

async function canonicalPhysicalEntryUri(
    filepath: string
): Promise<string | undefined> {
    try {
        const realParent = await realpath(path.dirname(filepath));
        return canonicalFileUri(path.join(realParent, path.basename(filepath)));
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
        throw error;
    }
}

export async function excludeOutputDefinitions(
    definitions: readonly HdlDefinitionSummary[],
    outputPath: string
): Promise<HdlDefinitionSummary[]> {
    const outputUri = canonicalFileUri(outputPath);
    let selected = definitions.filter(definition =>
        canonicalizeSourceUri(definition.uri) !== outputUri
    );
    const physicalOutputUri = await canonicalPhysicalEntryUri(outputPath);
    if (physicalOutputUri === undefined) return selected;
    const physicalDefinitionUris = await Promise.all(selected.map(async definition => {
        try {
            return await canonicalPhysicalEntryUri(fileURLToPath(definition.uri));
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code === 'ERR_INVALID_URL_SCHEME') {
                return undefined;
            }
            throw error;
        }
    }));
    selected = selected.filter(
        (_definition, index) => physicalDefinitionUris[index] !== physicalOutputUri
    );
    return selected;
}

export async function exportArchDesignToFile(
    designPath: string,
    design: ArchDesign,
    definitions: readonly HdlDefinitionSummary[],
    options: ArchDesignFileExportOptions = {}
): Promise<ArchDesignFileExportResult> {
    const { interfaceCatalog, ...operationOverrides } = options;
    const resolvedDesignPath = path.resolve(designPath);
    const { language, outputPath } = outputPathFor(resolvedDesignPath, design);
    const selectedDefinitions = await excludeOutputDefinitions(definitions, outputPath);
    const exportDefinitions = toArchDesignModuleDefinitions(
        selectedDefinitions
    );
    const generated = exportArchDesignRtl(design, exportDefinitions, {
        language,
        sourcePath: portableSourcePath(resolvedDesignPath, outputPath),
        ...(interfaceCatalog === undefined ? {} : { interfaceCatalog }),
    });
    if (generated.status === 'invalid') {
        return Object.freeze({
            status: 'invalid',
            diagnostics: generated.diagnostics,
        });
    }

    await publishGeneratedFile(outputPath, generated.text, operationOverrides);
    return Object.freeze({ status: 'published', outputPath, language });
}
