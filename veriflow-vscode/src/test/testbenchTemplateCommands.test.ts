import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import Module = require('module');

function harness() {
    const handlers = new Map<string, () => Promise<void>>();
    const configurations = new Map<unknown, unknown>();
    const position = { line: 3, character: 7 };
    const selection = { active: position, isEqual(other: unknown) { return other === this; } };
    const state = {
        picker: async (items: any[]): Promise<any> => items.find(item => item.id === 'waveform'),
        inserted: [] as any[][],
        information: [] as string[],
        warnings: [] as { message: string; actions: string[] }[],
        executed: [] as unknown[][],
        configurationRequests: [] as unknown[][],
        writable: true,
        warningAction: undefined as string | undefined,
    };
    const editor: any = {
        document: { languageId: 'verilog', uri: { scheme: 'file', path: '/project-a/test.v' }, version: 1, eol: 2, isClosed: false },
        selections: [selection], selection,
        insertSnippet: async (...args: any[]) => { state.inserted.push(args); return true; },
    };
    class SnippetString {
        value = '';
        appendText(text: string) { this.value += text.replace(/[$}\\]/g, '\\$&'); return this; }
        appendPlaceholder(value: string, index: number) { this.value += '$' + '{' + index + ':' + value.replace(/[$}\\]/g, '\\$&') + '}'; return this; }
        appendTabstop(index: number) { this.value += '$' + index; return this; }
    }
    const fake = {
        window: {
            activeTextEditor: editor,
            showQuickPick: (items: any[]) => state.picker(items),
            showInformationMessage: async (message: string) => { state.information.push(message); },
            showWarningMessage: async (message: string, ...actions: string[]) => { state.warnings.push({ message, actions }); return state.warningAction; },
            showErrorMessage: async () => {},
        },
        workspace: {
            fs: { isWritableFileSystem: () => state.writable },
            getConfiguration: (section: string, uri: unknown) => {
                state.configurationRequests.push([section, uri]);
                return { get: (key: string) => { assert.equal(key, 'hdlTemplates'); return configurations.get(uri); } };
            },
        },
        EndOfLine: { CRLF: 2 }, SnippetString,
        commands: {
            registerCommand: (id: string, handler: any) => { handlers.set(id, handler); return { dispose() {} }; },
            executeCommand: async (...args: unknown[]) => { state.executed.push(args); },
        },
        Disposable: { from: () => ({ dispose() {} }) },
    };
    const loader = Module as typeof Module & { _load: any };
    const original = loader._load;
    loader._load = function(request: string, ...args: any[]) { return request === 'vscode' ? fake : original.call(this, request, ...args); };
    try {
        delete require.cache[require.resolve('../testbench/templateCommands')];
        require('../testbench/templateCommands').registerHdlTemplateCommands();
    } finally { loader._load = original; }
    return {
        state, editor, fake, position, selection, configurations,
        run: (id?: string) => handlers.get('veriflow.insertHdlTemplate' + (id ? '.' + id : ''))!(),
    };
}

test('native insertion retains cursor, EOL, literal tasks, undo and invocation guards', async () => {
    const { state, editor, fake, position, selection, run } = harness();
    await run();
    assert.equal(state.inserted.length, 1);
    assert.equal(state.inserted[0][1], position);
    assert.deepEqual(state.inserted[0][2], { undoStopBefore: true, undoStopAfter: true });
    assert.ok(state.inserted[0][0].value.includes('\\$dumpfile("$' + '{1:waves.vcd}")'));
    assert.ok(state.inserted[0][0].value.includes('\r\n'));
    state.inserted = [];
    state.picker = async () => undefined; await run(); assert.equal(state.inserted.length, 0);
    state.picker = async items => { editor.document.version++; return items[0]; }; await run(); assert.equal(state.inserted.length, 0);
    state.picker = async items => { editor.selection = { ...selection }; return items[0]; }; await run(); assert.equal(state.inserted.length, 0); editor.selection = selection;
    state.picker = async items => { fake.window.activeTextEditor = {}; return items[0]; }; await run(); assert.equal(state.inserted.length, 0); fake.window.activeTextEditor = editor;
    state.picker = async items => { editor.document.isClosed = true; return items[0]; }; await run(); assert.equal(state.inserted.length, 0); editor.document.isClosed = false;
    state.picker = async items => { state.writable = false; return items[0]; }; await run(); assert.equal(state.inserted.length, 0); state.writable = true;
    state.writable = false; await run(); assert.equal(state.inserted.length, 0); state.writable = true;
    editor.selections = [selection, selection]; await run(); assert.equal(state.inserted.length, 0); editor.selections = [selection];
    await run('clock');
    assert.ok(state.inserted[0][0].value.includes('$' + '{1:clk}'));
    assert.ok(state.inserted[0][0].value.includes('${1} = ~${1}'));
});

test('legacy commands read overrides for the current document and refresh them on every invocation', async () => {
    const { state, editor, configurations, run } = harness();
    const projectA = editor.document.uri;
    const projectB = { scheme: 'file', path: '/project-b/test.v' };
    configurations.set(projectA, { clock: { body: 'project_a;' } });
    configurations.set(projectB, { clock: { body: 'project_b;' } });
    await run('clock');
    editor.document.uri = projectB;
    await run('clock');
    configurations.set(projectB, { clock: { body: 'updated_b;' } });
    await run('clock');
    assert.deepEqual(state.inserted.map(args => args[0].value), ['project_a;', 'project_b;', 'updated_b;']);
    assert.deepEqual(state.configurationRequests, [['veriflow', projectA], ['veriflow', projectB], ['veriflow', projectB]]);
});

test('disabled and language-inapplicable legacy templates do not fall back to built-ins', async () => {
    const { state, editor, configurations, run } = harness();
    configurations.set(editor.document.uri, { clock: { enabled: false }, reset: { languages: ['systemverilog'] } });
    await run('clock');
    await run('reset');
    assert.equal(state.inserted.length, 0);
    assert.equal(state.information.length, 2);
    assert.match(state.information[0], /clock/);
    assert.match(state.information[1], /reset/);
    editor.document.languageId = 'systemverilog';
    await run('reset');
    assert.equal(state.inserted.length, 1);
});

test('picker filters by language and combines configuration issues into one actionable warning', async () => {
    const { state, editor, configurations, run } = harness();
    configurations.set(editor.document.uri, {
        custom: { body: '$finish;' },
        onlySv: { body: 'logic foo;', languages: ['systemverilog'] },
        clock: { body: 123 },
        invalid: { languages: [] },
    });
    state.warningAction = 'Open Settings';
    state.picker = async items => {
        assert.equal(items.some(item => item.id === 'onlySv'), false);
        assert.match(items.find(item => item.id === 'clock').body, /\{\{1:clk\}\}/);
        return items.find(item => item.id === 'custom');
    };
    await run();
    assert.equal(state.inserted[0][0].value, '\\$finish;');
    assert.equal(state.warnings.length, 1);
    for (const path of ['clock.body', 'invalid.body', 'invalid.languages']) assert.ok(state.warnings[0].message.includes('veriflow.hdlTemplates.' + path));
    assert.deepEqual(state.warnings[0].actions, ['Open Settings']);
    assert.deepEqual(state.executed, [['workbench.action.openSettings', 'veriflow.hdlTemplates']]);
});

test('custom bodies preserve literal dollars and backslashes, mirror placeholders, and normalize EOL once', async () => {
    const { state, editor, configurations, run } = harness();
    configurations.set(editor.document.uri, { custom: { body: 'reg {{1:data}};\r\n$display("C:\\logs", {{1}});\r$finish;\n{{0}}' } });
    state.picker = async items => items.find(item => item.id === 'custom');
    await run();
    assert.equal(state.inserted[0][0].value, 'reg $' + '{1:data};\r\n\\$display("C:\\\\logs", ${1});\r\n\\$finish;\r\n${0}');
    editor.document.eol = 1;
    await run();
    assert.equal(state.inserted[1][0].value, 'reg $' + '{1:data};\n\\$display("C:\\\\logs", ${1});\n\\$finish;\n${0}');
});

test('empty configured bodies cause no insertion or undo record', async () => {
    const { state, editor, configurations, run } = harness();
    configurations.set(editor.document.uri, { clock: { body: '' } });
    await run('clock');
    assert.equal(state.inserted.length, 0);
});

test('numeric text after a mirror or final tabstop cannot change the snippet index', async () => {
    const { state, editor, configurations, run } = harness();
    configurations.set(editor.document.uri, { clock: { body: '{{1:bus}}{{1}}0 {{0}}7 $display;' } });
    await run('clock');
    assert.equal(state.inserted[0][0].value, '${1:bus}${1}0 ${0}7 \\$display;');
});

test('unsafe placeholder indices remain literal instead of rounding or emitting Infinity', async () => {
    const { state, editor, configurations, run } = harness();
    const hugeIndex = '9'.repeat(400);
    configurations.set(editor.document.uri, { clock: {
        body: '{{9007199254740993:too-big}} {{' + hugeIndex + '}} {{0001:ok}}{{0001}}2',
    } });
    await run('clock');
    assert.equal(state.inserted[0][0].value,
        '{{9007199254740993:too-big\\}\\} {{' + hugeIndex + '\\}\\} ${1:ok}${1}2');
});
