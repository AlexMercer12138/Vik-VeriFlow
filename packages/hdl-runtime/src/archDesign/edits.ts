import { applyArchDesignEdit, type ArchDesign, type ArchDesignEdit } from '@veriflow/schematic-core/arch-design';
import { canonicalizeSourceUri } from '@veriflow/hdl-core/preprocessor';
import { pathToFileURL } from 'node:url';
import * as path from 'node:path';
import type { HdlDefinitionSummary } from '../workspaceIndexTypes';

export function editOperations(value: unknown, kind: 'arch' | 'task'): unknown[] {
    const envelope = value as { format?: unknown; schemaVersion?: unknown; operations?: unknown };
    if (!envelope || envelope.format !== `veriflow-${kind}-edits` || envelope.schemaVersion !== 1 || !Array.isArray(envelope.operations))
        throw new Error(`Expected veriflow-${kind}-edits schemaVersion 1 with operations array`);
    return envelope.operations;
}
export function applyEditBatch<T>(document: T, operations: unknown[], apply: (document: T, operation: any) => T): T {
    let result = structuredClone(document);
    for (let index = 0; index < operations.length; index++) {
        try {
            const operation = operations[index];
            if (!operation || typeof operation !== 'object' || Array.isArray(operation) || typeof (operation as { type?: unknown }).type !== 'string')
                throw new Error('Operation must be an object with a type');
            result = apply(result, operation);
        } catch (error) { throw new Error(`$.operations[${index}] [EDIT_INVALID] ${(error as Error).message}`); }
    }
    return result;
}
export function applyArchDesignOperations(design: ArchDesign, operations: unknown[], owner: string, definitions: readonly HdlDefinitionSummary[]): ArchDesign {
    return applyEditBatch(design, operations, (current, operation) => {
        if (operation.type === 'addSourceInstance') {
            const source = operation.source;
            if (!source || source.kind !== 'hdl' || typeof source.path !== 'string' || path.isAbsolute(source.path) || /[\r\n\0]/.test(source.path))
                throw new Error('Arch instance source requires a relative HDL path and module');
            const uri = canonicalizeSourceUri(pathToFileURL(path.resolve(path.dirname(owner), source.path)).toString());
            const matches = definitions.filter(definition => canonicalizeSourceUri(definition.uri) === uri && definition.name === source.module);
            if (matches.length !== 1) throw new Error(`Expected one definition for ${source.path}#${source.module}, found ${matches.length}`);
            return applyArchDesignEdit(current, { type: 'addInstance', instance: { name: operation.id, module: source.module, definitionKey: matches[0].key, parameters: operation.parameters ?? {} } });
        }
        return applyArchDesignEdit(current, operation as ArchDesignEdit);
    });
}

export async function applyEditBatchAsync<T>(document: T, operations: unknown[], apply: (document: T, operation: any) => Promise<T>): Promise<T> {
    let result = structuredClone(document);
    for (let index = 0; index < operations.length; index++) {
        try {
            const operation = operations[index];
            if (!operation || typeof operation !== 'object' || Array.isArray(operation) || typeof (operation as { type?: unknown }).type !== 'string')
                throw new Error('Operation must be an object with a type');
            result = await apply(result, operation);
        } catch (error) { throw new Error(`$.operations[${index}] [EDIT_INVALID] ${(error as Error).message}`); }
    }
    return result;
}
