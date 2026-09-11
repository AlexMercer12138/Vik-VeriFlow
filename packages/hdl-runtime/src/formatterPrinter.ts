import type { Node } from 'web-tree-sitter';

type Token = { text: string; start: number; end: number; node: Node; parents: Node[]; opaque?: boolean };
type Region = { start: number; end: number };
const listTypes = new Set(['list_of_port_declarations', 'list_of_ports', 'parameter_port_list',
    'list_of_port_connections', 'list_of_parameter_value_assignments']);
const blockEnds = new Set(['end', 'endcase', 'endfunction', 'endtask', 'endmodule',
    'endinterface', 'endpackage', 'endclass', 'endprogram', 'endgenerate', 'join', 'join_any',
    'join_none', 'endclocking', 'endproperty', 'endsequence', 'endgroup', 'endchecker']);
const declarationTypes = new Set(['module_declaration', 'interface_declaration', 'package_declaration',
    'class_declaration', 'program_declaration', 'function_declaration', 'task_declaration',
    'clocking_declaration', 'property_declaration', 'sequence_declaration', 'checker_declaration']);
const itemTypes = new Set(['data_declaration', 'net_declaration', 'parameter_declaration',
    'local_parameter_declaration', 'continuous_assign', 'always_construct', 'initial_construct',
    'final_construct', 'module_instantiation', 'interface_instantiation', 'program_instantiation',
    'case_item', 'case_generate_item', 'function_declaration', 'task_declaration']);

/** CST provides boundaries; only gaps between original tokens are rewritten. */
export function printHdlTree(source: string, root: Node, indentSize: number): string {
    const regions: Region[] = [];
    const groupNodes: Array<{ node: Node; group: string }> = [];
    const signalTypes = new Set(['data_declaration', 'net_declaration', 'input_declaration',
        'output_declaration', 'inout_declaration', 'parameter_declaration', 'local_parameter_declaration']);
    const breaks = new Set<number>();
    const tokens: Token[] = [];
    const directives: Region[] = [];
    const directivePattern = /^[ \t]*`[^\r\n]*(?:\\\r?\n[^\r\n]*)*/gm;
    for (const match of source.matchAll(directivePattern)) {
        // Consume continuation lines without interpreting macro bodies.
        let end = match.index! + match[0].length;
        while (source.slice(match.index, end).trimEnd().endsWith('\\') && end < source.length) {
            end = source.indexOf('\n', end + (source[end] === '\r' ? 2 : 1));
            if (end < 0) { end = source.length; break; }
        }
        directives.push({ start: match.index! + match[0].search(/\S/), end });
    }
    function region(start: number, end: number): void { if (start < end) regions.push({ start, end }); }
    function visit(node: Node, parents: Node[]): void {
        const children = node.children;
        if (signalTypes.has(node.type) && node.text.trimEnd().endsWith(';')) {
            groupNodes.push({ node, group: 'signal' });
        } else if (node.type === 'continuous_assign') {
            groupNodes.push({ node, group: 'assign' });
        } else if (/^(module_declaration|always_construct|module_instantiation|interface_instantiation|program_instantiation)$/.test(node.type)) {
            groupNodes.push({ node, group: 'block' });
        }
        if (itemTypes.has(node.type)) breaks.add(node.startIndex);
        if (listTypes.has(node.type)) {
            const open = children.find(c => c.text === '(');
            const close = children.find(c => c.text === ')');
            // Connection lists exclude their parentheses in this grammar.
            if (open && close) {
                region(open.endIndex, close.startIndex);
                breaks.add(open.endIndex); breaks.add(close.startIndex);
            }
        }
        if (declarationTypes.has(node.type)) {
            const header = children.find(c => /header$/.test(c.type));
            const semi = children.find(c => c.text === ';');
            const end = children.find(c => blockEnds.has(c.text));
            if (end && (header || semi)) region((header ?? semi)!.endIndex, end.startIndex);
        }
        if (node.type === 'data_type' && children.some(c => c.text === '{')) {
            const open = children.find(c => c.text === '{')!;
            const close = children.find(c => c.text === '}');
            if (close) {
                region(open.endIndex, close.startIndex);
                breaks.add(open.endIndex); breaks.add(close.startIndex);
            }
        }
        if (node.type === 'seq_block' || node.type === 'par_block' || node.type === 'generate_region') {
            const open = children.find(c => /^(begin|fork|generate)$/.test(c.text));
            const close = children.find(c => blockEnds.has(c.text));
            if (open && close) {
                const label = children[children.indexOf(open) + 1]?.text === ':'
                    ? children[children.indexOf(open) + 2] : undefined;
                region((label ?? open).endIndex, close.startIndex);
                breaks.add((label ?? open).endIndex);
            }
        }
        if (/^(case_statement|case_generate_construct)$/.test(node.type)) {
            const closeParen = children.find(c => c.text === ')');
            const end = children.find(c => c.text === 'endcase');
            if (closeParen && end) {
                region(closeParen.endIndex, end.startIndex); breaks.add(closeParen.endIndex);
            }
        }
        if (node.type === 'statement_or_null' || node.type === 'statement_or_null_item') {
            const parent = parents[parents.length - 1];
            if (parent && /^(conditional_statement|loop_statement|procedural_timing_control_statement)$/.test(parent.type)
                && !/^(begin|if|;)\b/.test(node.text.trim())) {
                region(node.startIndex, node.endIndex); breaks.add(node.startIndex);
            }
        }
        // Preserve strings, numbers, attributes and comments as indivisible source tokens.
        if (!children.length || /^(escaped_identifier|string_literal|integral_number|real_number|time_literal|attribute_instance|text_macro_definition|comment|one_line_comment|block_comment)$/.test(node.type)) {
            tokens.push({ text: node.text, start: node.startIndex, end: node.endIndex, node, parents,
                opaque: /comment|string_literal|attribute_instance|text_macro_definition/.test(node.type) });
        } else {
            for (const child of children) visit(child, [...parents, node]);
        }
    }
    visit(root, []);
    // Directive payloads may contain whitespace-sensitive macro text.
    for (const directive of directives) {
        const first = tokens.find(t => t.start >= directive.start && t.start < directive.end);
        if (first) {
            for (let i = tokens.length - 1; i >= 0; i--) {
                if (tokens[i].start >= directive.start && tokens[i].start < directive.end) tokens.splice(i, 1);
            }
            tokens.push({ ...first, start: directive.start, end: directive.end,
                text: source.slice(directive.start, directive.end), opaque: true });
        }
    }
    tokens.sort((a, b) => a.start - b.start);
    const blankBefore = new Set<number>();
    let blankAtEnd = false;
    for (const { node, group } of groupNodes) {
        let index = tokens.findIndex(t => t.start >= node.endIndex);
        if (index < 0) { blankAtEnd = true; continue; }
        let end = node.endIndex;
        // A trailing comment belongs to the preceding statement, not the next group.
        while (index < tokens.length && /comment/.test(tokens[index].node.type)
            && !source.slice(end, tokens[index].start).includes('\n')) {
            end = tokens[index++].end;
        }
        if (index === tokens.length) { blankAtEnd = true; continue; }
        const next = tokens[index];
        const nextGroup = groupNodes.find(item => item.node.startIndex === next.start);
        if (group !== 'block' && nextGroup?.group === group) continue;
        blankBefore.add(next.start);
    }
    let covered = 0;
    for (const token of tokens) {
        if (token.start < covered || /\S/.test(source.slice(covered, token.start))) {
            throw new Error('HDL grammar did not expose all source tokens; source was left unchanged');
        }
        covered = token.end;
    }
    if (/\S/.test(source.slice(covered))) throw new Error('HDL source contains unrepresented tokens');
    const lines: string[] = [];
    let line = '';
    const flush = (): void => { if (line) { lines.push(line.trimEnd()); line = ''; } };
    const has = (t: Token, type: string): boolean => t.parents.some(p => p.type === type);
    const parent = (t: Token): string => t.parents[t.parents.length - 1]?.type ?? '';
    const listComma = (t: Token): boolean => listTypes.has(parent(t)) || /^(list_of_parameter_value_assignments|list_of_port_connections)$/.test(parent(t));
    const listParen = (t: Token): boolean => listTypes.has(parent(t))
        || (parent(t) === 'hierarchical_instance' && (t.text === '(' || t.text === ')'))
        || (parent(t) === 'parameter_value_assignment' && (t.text === '(' || t.text === ')'));
    // Parentheses enclosing instance lists are outside the list node.
    for (const t of tokens) {
        if (t.text === '(' && listParen(t) && !listTypes.has(parent(t))) {
            const p = t.parents[t.parents.length - 1];
            const close = p.children.find(c => c.text === ')');
            if (close) region(t.end, close.startIndex);
        }
    }
    for (let i = 0; i < tokens.length; i++) {
        const t = tokens[i], prev = tokens[i - 1], next = tokens[i + 1];
        if (!t.text) continue;
        const gap = source.slice(prev?.end ?? 0, t.start);
        const comment = t.text.startsWith('//') || t.text.startsWith('/*');
        const trailingComment = comment && prev && !gap.includes('\n') && !prev.text.startsWith('`');
        const previousBoundary = prev && (breaks.has(prev.end)
            || (prev.text === ';' && !has(prev, 'for_initialization') && !has(prev, 'for_step')
                && !(parent(prev) === 'loop_statement'))
            || (prev.text === ',' && listComma(prev))
            || (prev.text === '(' && listParen(prev))
            || prev.text.startsWith('//') || prev.text.startsWith('`')
            || (blockEnds.has(prev.text) && !['else', ';', ':', ',', ')'].includes(t.text)));
        if (!trailingComment && (previousBoundary || breaks.has(t.start) || blockEnds.has(t.text)
            || (t.text === ')' && listParen(t)) || t.text === 'else' && prev?.text !== 'end'
            || t.text.startsWith('`') || comment && gap.includes('\n'))) flush();
        if (blankBefore.has(t.start)) {
            flush();
            if (lines.length && lines[lines.length - 1] !== '') lines.push('');
        }
        // Preserve author-created logical groups, capped at one empty line.
        if (!line && /\n[ \t\r]*\n/.test(gap) && lines.length && lines[lines.length - 1] !== '') lines.push('');
        if (!line) {
            const depth = regions.filter(r => r.start <= t.start && t.start < r.end).length;
            line = t.text.startsWith('`') ? '' : ' '.repeat(depth * indentSize);
        } else if (needsSpace(prev, t, parent(t), listParen(t))) line += ' ';
        line += t.text;
        if (t.text.startsWith('//') || t.text.startsWith('`') || (comment && next && source.slice(t.end, next.start).includes('\n'))) flush();
    }
    flush();
    while (lines[lines.length - 1] === '') lines.pop();
    const eol = source.includes('\r\n') ? '\r\n' : '\n';
    // Opaque multiline text already carries its own EOLs.
    if (blankAtEnd) lines.push('');
    return alignDeclarations(lines).join('\n').replace(/\r?\n/g, eol) + (lines.length ? eol : '');
}

function needsSpace(prev: Token | undefined, token: Token, parent: string, listParen: boolean): boolean {
    if (!prev) return false;
    const a = prev.text, b = token.text;
    if (a.startsWith('\\')) return true; // Escaped identifiers terminate only at whitespace.
    if (token.opaque || prev.opaque) return ![')', ']', ';', ','].includes(b);
    if ([';', ',', ')', ']', '.', '::'].includes(b) || ['.', '::'].includes(a)) return false;
    if (b === ':') return !/range|dimension|case_item|seq_block/.test(parent);
    if (a === ':') return !/range|dimension/.test(prev.parents[prev.parents.length - 1]?.type ?? '');
    if (b === '[') return /dimension/.test(parent);
    if (['(', '[', '{'].includes(a) || b === '}') return false;
    if (b === '(' && (a === '@' || a === '#')) return false;
    if (b === '(') return listParen || !/^(if|case|casex|casez|for|while|repeat|foreach|wait|@|#)$/.test(a)
        && !/identifier$/.test(prev.node.type);
    if (a === '@' || a === '#' || a === "'") return false;
    if (/^[!~]$/.test(a) || /unary_operator/.test(prev.node.type)) return false;
    if (b === "'") return false;
    if (b === '++' || b === '--' || a === '++' || a === '--') return false;
    return true;
}

/** Align consecutive declarations and named connections without inspecting comment text. */
function alignDeclarations(lines: string[]): string[] {
    const output = [...lines];
    const declaration = /^( +)(input|output|inout|wire|reg|logic|bit|integer|parameter|localparam)\s+(?:(wire|reg|logic|bit|integer)\s+)?(?:(signed|unsigned)\s+)?(\[[^\]]+\])?\s*([a-zA-Z_$][\w$]*)(.*)$/;
    for (let start = 0; start < output.length;) {
        const match = output[start].match(declaration);
        if (!match) { start++; continue; }
        let end = start;
        const group: RegExpMatchArray[] = [];
        while (end < output.length) {
            const row = output[end].match(declaration);
            if (!row || row[1] !== match[1] || /^(parameter|localparam)$/.test(row[2]) !== /^(parameter|localparam)$/.test(match[2])) break;
            group.push(row); end++;
        }
        const prefixes = group.map(row => [row[2], row[3], row[4]].filter(Boolean).join(' '));
        const prefixWidth = Math.max(7, ...prefixes.map(s => s.length));
        const dimensionWidth = Math.max(11, ...group.map(row => (row[5] ?? '').length));
        const nameWidth = Math.max(...group.map(row => row[6].length));
        group.forEach((row, i) => {
            const parameter = /^(parameter|localparam)$/.test(row[2]);
            output[start + i] = row[1] + prefixes[i].padEnd(prefixWidth + 1)
                + (row[5] ?? '').padEnd(dimensionWidth + 1) + row[6]
                + (parameter && row[7].trimStart().startsWith('=') ? ' '.repeat(nameWidth - row[6].length) : '') + row[7];
        });
        start = end;
    }
    const connection = /^( +)\.([a-zA-Z_$][\w$]*)\((.*)\)(,?)(\s*\/\/.*)?$/;
    for (let start = 0; start < output.length;) {
        const first = output[start].match(connection);
        if (!first) { start++; continue; }
        const group: RegExpMatchArray[] = []; let end = start;
        while (end < output.length) {
            const row = output[end].match(connection);
            if (!row || row[1] !== first[1]) break;
            group.push(row); end++;
        }
        const names = Math.max(20, ...group.map(r => r[2].length));
        const values = Math.max(16, ...group.map(r => r[3].trim().length + 1));
        group.forEach((row, i) => { output[start + i] = row[1] + '.' + row[2].padEnd(names + 1)
            + '(' + row[3].trim().padEnd(values) + ')' + row[4] + (row[5] ?? ''); });
        start = end;
    }
    return output;
}
