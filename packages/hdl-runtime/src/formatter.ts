// eslint-disable-next-line @typescript-eslint/no-require-imports
import TreeSitter = require('web-tree-sitter');
import { printHdlTree } from './formatterPrinter';

export interface HdlFormatOptions {
    indentSize?: number;
    runtimeWasmPath?: string;
    languageWasmPath?: string;
}

let initialization: Promise<void> | undefined;
const languages = new Map<string, Promise<TreeSitter.Language>>();

/** Format original source, never the preprocessed/semantic projection. */
export async function formatHdl(source: string, options: HdlFormatOptions = {}): Promise<string> {
    const indentSize = options.indentSize ?? 4;
    if (!Number.isInteger(indentSize) || indentSize < 1 || indentSize > 8) {
        throw new Error('HDL indentation must be between 1 and 8 spaces');
    }
    initialization ??= TreeSitter.Parser.init(options.runtimeWasmPath
        ? { locateFile: () => options.runtimeWasmPath! } : undefined).catch(error => {
        initialization = undefined;
        throw error;
    });
    await initialization;
    const languagePath = options.languageWasmPath
        ?? require.resolve('tree-sitter-systemverilog/tree-sitter-systemverilog.wasm');
    let language = languages.get(languagePath);
    if (!language) {
        language = TreeSitter.Language.load(languagePath).catch(error => {
            languages.delete(languagePath);
            throw error;
        });
        languages.set(languagePath, language);
    }
    const parser = new TreeSitter.Parser().setLanguage(await language);
    let tree: TreeSitter.Tree | null = null;
    let verified: TreeSitter.Tree | null = null;
    try {
        tree = parser.parse(source);
        if (!tree || tree.rootNode.hasError) {
            throw new Error('Cannot safely format HDL containing syntax errors or unsupported syntax');
        }
        const result = printHdlTree(source, tree.rootNode, indentSize);
        verified = parser.parse(result);
        if (!verified || verified.rootNode.hasError
            || fingerprint(tree.rootNode) !== fingerprint(verified.rootNode)) {
            throw new Error('HDL formatting changed the syntax tree; source was left unchanged');
        }
        return result;
    } finally {
        verified?.delete();
        tree?.delete();
        parser.delete();
    }
}

/** Includes lexical text: detects changed literals, operators and comment attachment. */
function fingerprint(node: TreeSitter.Node): string {
    const parts: string[] = [];
    function collect(current: TreeSitter.Node): void {
        parts.push(current.type, '(');
        if (!current.childCount || /comment|string_literal|text_macro_definition|escaped_identifier/.test(current.type)) {
            parts.push(JSON.stringify(current.text.replace(/\r\n/g, '\n').replace(/\r$/, '')));
        } else {
            for (const child of current.children) collect(child);
        }
        parts.push(')');
    }
    collect(node);
    return parts.join('');
}
