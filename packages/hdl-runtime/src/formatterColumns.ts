export type HdlAlignmentColumns = readonly [number, number, number, number, number];

export const DEFAULT_HDL_ALIGNMENT_COLUMNS: HdlAlignmentColumns = Object.freeze([4, 12, 20, 44, 56]);

export function validateAlignmentColumns(value: unknown): HdlAlignmentColumns {
    if (!Array.isArray(value) || value.length !== 5
        || value.some((column, i) => !Number.isInteger(column) || column < 1 || column > 240
            || (i > 0 && column <= value[i - 1])) || value[0] > 8) {
        throw new Error('HDL columns must be five increasing integer offsets (first: 1–8, maximum: 240)');
    }
    return [...value] as unknown as HdlAlignmentColumns;
}

export function paddingToColumn(currentLength: number, target: number, minimum: number): string {
    return ' '.repeat(Math.max(minimum, target - currentLength));
}
