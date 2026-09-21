import type { Node } from 'web-tree-sitter';
import type { HdlAlignmentColumns } from './formatterColumns';

export interface ColumnAlignment {
    targets: Map<number, number>;
    breaks: Set<number>;
    joinedClosings: Set<number>;
}

const identifiers = new Set(['simple_identifier', 'escaped_identifier']);
const parameterTypes = new Set(['parameter_declaration', 'local_parameter_declaration']);
const instanceTypes = new Set(['module_instantiation', 'interface_instantiation', 'program_instantiation']);
const signalTypes = new Set(['data_declaration', 'net_declaration', 'input_declaration', 'output_declaration', 'inout_declaration']);
const builtinTypes = new Set(['wire', 'tri', 'tri0', 'tri1', 'triand', 'trior', 'trireg', 'uwire', 'wand', 'wor',
    'reg', 'logic', 'bit', 'integer', 'int', 'shortint', 'longint', 'byte', 'time', 'real', 'shortreal', 'realtime', 'string']);

/** Mark source token offsets using CST ownership, never by matching rendered HDL text. */
export function createColumnAlignment(root: Node, columns: HdlAlignmentColumns, depthAt: (offset: number) => number): ColumnAlignment {
    const result: ColumnAlignment = { targets: new Map(), breaks: new Set(), joinedClosings: new Set() };
    const mark = (node: Node | undefined, column: number, anchor: Node): void => {
        if (node) result.targets.set(node.startIndex, columns[column] + (depthAt(anchor.startIndex) - 1) * columns[0]);
    };
    // Only headers consisting of primitive types, signs and packed dimensions qualify.
    function headerParts(node: Node, end: number): { type?: Node; sign?: Node; dimension?: Node } | undefined {
        const parts: { type?: Node; sign?: Node; dimension?: Node } = {};
        let supported = true;
        function visit(current: Node): void {
            if (current.startIndex >= end) return;
            if (current.type === 'packed_dimension') { parts.dimension ??= current; return; }
            if (/comment/.test(current.type)) { supported = false; return; }
            if (current.children.length) { current.children.forEach(visit); return; }
            if (builtinTypes.has(current.text)) parts.type ??= current;
            else if (current.text === 'signed' || current.text === 'unsigned') parts.sign = current;
            else if (!['input', 'output', 'inout', 'parameter', 'localparam', 'var', 'const', 'static', 'automatic'].includes(current.text)) supported = false;
        }
        visit(node);
        return supported ? parts : undefined;
    }
    function declaration(node: Node): void {
        const ansi = node.type === 'ansi_port_declaration';
        const parameter = parameterTypes.has(node.type);
        const port = ansi || /^(input|output|inout)_declaration$/.test(node.type);
        const list = node.children.find(child => /^list_of_(param_assignments|variable_decl_assignments|net_decl_assignments|port_identifiers|variable_identifiers)$/.test(child.type));
        const assignments = ansi ? [] : list?.namedChildren.filter(child => !/comment/.test(child.type)) ?? [];
        const names = ansi ? node.children.filter(child => identifiers.has(child.type))
            : assignments.map(child => identifiers.has(child.type) ? child : child.children.find(part => identifiers.has(part.type))).filter((name): name is Node => !!name);
        if (!names.length || (!parameter && names.length !== 1)) return;
        const header = headerParts(node, names[0].startIndex);
        if (!header) return;
        const anchor = node;
        // Signals start with their type in C1; ports/parameters have a preceding keyword.
        if (port || parameter) mark(header.type, 1, anchor);
        mark(header.sign, port || parameter ? 2 : 1, anchor);
        if (!header.sign || (!port && !parameter)) mark(header.dimension, port || parameter || header.sign ? 2 : 1, anchor);
        names.forEach((name, i) => {
            mark(name, 3, anchor);
            if (parameter) {
                mark(assignments[i]?.children.find(child => child.text === '='), 4, anchor);
                if (i > 0) result.breaks.add(name.startIndex);
            }
        });
        if (!parameter) {
            mark(node.children.find(child => child.text === ';'), 4, anchor);
            if (ansi) {
                const sibling = node.nextSibling;
                if (sibling?.text === ',') mark(sibling, 4, anchor);
            }
        }
    }
    function instance(node: Node): void {
        const parameters = node.children.find(child => child.type === 'parameter_value_assignment');
        mark(parameters?.children.find(child => child.text === '#'), 3, node);
        const instances = node.children.filter(part => part.type === 'hierarchical_instance');
        for (const [index, child] of instances.entries()) {
            mark(child.children.find(part => part.text === '('), 3, node);
            if (parameters || index > 0) result.breaks.add(child.startIndex);
        }
        function connections(listOwner: Node): void {
            const list = listOwner.children.find(child => /^list_of_(port_connections|parameter_value_assignments)$/.test(child.type));
            if (!list || !list.namedChildren.length || list.namedChildren.some(child => !/^(named_port_connection|named_parameter_assignment|comment|one_line_comment|block_comment)$/.test(child.type))) return;
            for (const connection of list.namedChildren) {
                if (/comment/.test(connection.type)) continue;
                mark(connection.children.find(child => child.text === '('), 3, node);
                mark(connection.children.find(child => child.text === ')'), 4, node);
            }
            const closing = listOwner.children.find(child => child.text === ')');
            if (closing) result.joinedClosings.add(closing.startIndex);
        }
        if (parameters) connections(parameters);
        instances.forEach(connections);
    }
    function visit(node: Node): void {
        if (parameterTypes.has(node.type) || signalTypes.has(node.type) || node.type === 'ansi_port_declaration') declaration(node);
        if (node.type === 'param_assignment' && (node.parent?.type === 'parameter_port_list'
            || (node.parent?.type === 'list_of_param_assignments' && node.parent.parent?.type === 'parameter_port_list'))) {
            const name = node.children.find(child => identifiers.has(child.type));
            mark(name, 3, node);
            mark(node.children.find(child => child.text === '='), 4, node);
            if (name) result.breaks.add(name.startIndex);
        }
        if (node.type === 'continuous_assign') {
            const list = node.children.find(child => child.type === 'list_of_net_assignments');
            const assignments = list?.children.filter(child => child.type === 'net_assignment') ?? [];
            if (assignments.length === 1) {
                mark(assignments[0].children.find(child => child.type === 'net_lvalue'), 1, node);
                mark(assignments[0].children.find(child => child.text === '='), 3, node);
                mark(node.children.find(child => child.text === ';'), 4, node);
            }
        }
        if (instanceTypes.has(node.type)) instance(node);
        // Macro bodies, comments and literals are indivisible, just as in the printer.
        if (/comment|string_literal|text_macro_definition|attribute_instance/.test(node.type)) return;
        for (const child of node.children) visit(child);
    }
    visit(root);
    return result;
}
