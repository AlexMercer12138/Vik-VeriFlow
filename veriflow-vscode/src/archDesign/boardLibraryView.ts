import { randomBytes } from 'node:crypto';
import { boardLibraryHtml as renderBoardLibraryHtml } from '@veriflow/schematic-webview/boardLibraryView';

export function boardLibraryHtml(): string {
    return renderBoardLibraryHtml(randomBytes(16).toString('hex'));
}
