import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ConstraintWorkbench, UserPhysicalBoardLibrary, type ConstraintSource } from '../src/physical';
import { applyArchDesignEdit, createEmptyArchDesign, parseArchDesignText, serializeArchDesign } from '@veriflow/schematic-core/arch-design';
test('workbench retains board and RTL drafts, generated identities, history, pin values and safe export', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'vf-workbench-'));
    try {
        const library = new UserPhysicalBoardLibrary({ configPath: path.join(root, 'config.json') });
        library.saveBoard({ id: 'b', name: 'Board', model: { kind: 'board', extension: '.pcf', pins: { tx: 'set_io {signal name} A1\n' }, interfaces: [{ id: 'U', signals: [{ id: 'tx', direction: 'output', pins: ['tx'] }] }] } });
        library.saveBoard({ id: 'c', name: 'Card', model: { kind: 'daughtercard', extension: '.pcf', pins: { rx: 'set_io {signal name} {pin name}\n' }, interfaces: [{ id: 'U', signals: [{ id: 'rx', direction: 'input', pins: ['rx'] }] }] } });
        const file = path.join(root, 'top.v');
        await writeFile(file, 'module top(output tx,input rx);endmodule');
        const source = async (): Promise<ConstraintSource> => { const text = await readFile(file, 'utf8'); return { path: file, text, module: 'top', isAd: false, ports: [{ name: 'tx', direction: 'output' }, { name: 'rx', direction: 'input' }], configurationPath: path.join(root, 'top.pins.json'), inputs: [{ path: file, text }] }; };
        let state: any, snapshot: unknown;
        const session = new ConstraintWorkbench({ library, source, saveAd: async (s) => s, openFile: async () => undefined, saveFile: async (_k, s) => s, confirmDelete: async () => true, persist: async (v) => { snapshot = v; } }, m => { state = m; });
        await session.open(file);
        await session.dispatch({ type: 'choose-board', board: 'user:b' });
        await session.dispatch({ type: 'bind', interface: 'U', signal: 'tx', port: 'tx' });
        assert.equal(state.preview, 'set_io tx A1\n');
        await session.dispatch({ type: 'add-card', id: 'c' });
        const card = state.configuration.cards[0].id;
        assert.match(card, /^[0-9a-f-]{36}$/);
        await session.dispatch({ type: 'bind', card, interface: 'U', signal: 'rx', port: 'rx' });
        assert.equal(state.canExport, false);
        await session.dispatch({ type: 'pin', card, interface: 'U', member: 'rx', pin: 'B7' });
        assert.equal(state.preview, 'set_io tx A1\nset_io rx B7\n');
        assert.equal(state.canExport, true);
        await session.dispatch({ type: 'board-open', id: 'b' });
        const original = state.draft;
        await session.dispatch({ type: 'board-change', draft: { ...original, name: 'Renamed' } });
        await session.dispatch({ type: 'board-undo' });
        assert.equal(state.draft.name, 'Board');
        await session.dispatch({ type: 'board-redo' });
        assert.equal(state.draft.id, 'b');
        assert.equal(state.draft.name, 'Renamed');
        await session.dispatch({ type: 'page', page: 'bindings' });
        assert.equal(state.configuration.bindings[1].pin, 'B7');
        await session.dispatch({ type: 'bindings-save' });
        assert.equal(JSON.parse(await readFile(path.join(root, 'top.pins.json'), 'utf8')).bindings[1].pin, 'B7');
        await session.dispatch({ type: 'export' });
        assert.equal(await readFile(path.join(root, 'top.pcf'), 'utf8'), 'set_io tx A1\nset_io rx B7\n');
        await writeFile(path.join(root, 'top.pcf'), 'manual');
        await session.dispatch({ type: 'export' });
        assert.match(state.error, /conflict/i);
        assert.equal(await readFile(path.join(root, 'top.pcf'), 'utf8'), 'manual');
        const savedBoard = library.get('b');
        library.saveBoard({ ...savedBoard, model: { ...savedBoard.model, pins: { tx: 'set_io {signal name} A9\n' } } }, savedBoard);
        await session.dispatch({ type: 'export' });
        assert.match(state.error, /templates changed/i);
        assert.equal(await readFile(path.join(root, 'top.pcf'), 'utf8'), 'manual');
        const restored = new ConstraintWorkbench(session.services, m => { state = m; });
        restored.restore(snapshot);
        await restored.publish();
        assert.equal(state.draft.name, 'Renamed');
        assert.equal(state.configuration.bindings[1].pin, 'B7');
        await session.dispatch({ type: 'board-copy' });
        assert.notEqual(state.draft.id, 'b');
        assert.match(state.draft.id, /^[0-9a-f-]{36}$/);
        await writeFile(file, 'changed');
        await session.dispatch({ type: 'bindings-save' });
        assert.match(state.error, /Source changed/);
    }
    finally {
        await rm(root, { recursive: true, force: true });
    }
});
test('an active unassigned signal blocks direct export even when other bindings are valid', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'vf-selected-export-'));
    try {
        const file = path.join(root, 'top.v'), text = 'module top(output tx,output other);endmodule';
        await writeFile(file, text);
        const library = new UserPhysicalBoardLibrary({ configPath: path.join(root, 'library.json') });
        library.saveBoard({ id: 'b', name: 'B', model: { kind: 'board', extension: '.txt', pins: { tx: 'one {signal name}', other: 'two {signal name}' }, interfaces: [{ id: 'U', signals: [{ id: 'tx', direction: 'output', pins: ['tx'] }, { id: 'other', direction: 'output', pins: ['other'] }] }] } });
        let state: any;
        const workbench = new ConstraintWorkbench({ library, source: async () => ({ path: file, text, module: 'top', isAd: false, ports: [{ name: 'tx', direction: 'output' }, { name: 'other', direction: 'output' }], configurationPath: path.join(root, 'top.pins.json'), inputs: [{ path: file, text }] }), saveAd: async (s) => s, openFile: async () => undefined, saveFile: async () => { throw new Error('Export dialog must not open'); }, confirmDelete: async () => false }, m => { state = m; });
        await workbench.open(file);
        await workbench.dispatch({ type: 'choose-board', board: 'user:b' });
        await workbench.dispatch({ type: 'bind', interface: 'U', signal: 'tx', port: 'tx' });
        await workbench.dispatch({ type: 'select', interface: 'U', signal: 'other', checked: true });
        await workbench.dispatch({ type: 'export' });
        assert.match(state.error, /Assign selected signal/);
        await assert.rejects(readFile(path.join(root, 'top.txt')), { code: 'ENOENT' });
    }
    finally {
        await rm(root, { recursive: true, force: true });
    }
});

test('opening the workbench removes obsolete saved boards without reporting an idle error', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'vf-obsolete-boards-'));
    try {
        const configPath = path.join(root, 'config.json');
        await writeFile(configPath, JSON.stringify({ language: 'zh', boards: [
            { id: 'old', name: 'Old', model: { pins: [{ name: 'A1' }], interfaces: [] } },
            { id: 'good', name: 'Good', model: { kind: 'board', extension: '.pcf', pins: {}, interfaces: [] } }
        ] }));
        const library = new UserPhysicalBoardLibrary({ configPath });
        let state: any;
        const workbench = new ConstraintWorkbench({ library, source: async () => { throw new Error('unused'); }, saveAd: async s => s,
            openFile: async () => undefined, saveFile: async () => undefined, confirmDelete: async () => false }, message => { state = message; });
        await workbench.open();
        assert.equal(state.error, '');
        assert.deepEqual(state.boards.map((board: any) => board.id), ['good']);
        assert.deepEqual(JSON.parse(await readFile(configPath, 'utf8')).boards.map((board: any) => board.id), ['good']);
        assert.equal(JSON.parse(await readFile(configPath, 'utf8')).language, 'zh');
        await workbench.dispatch({ type: 'board-new', name: 'New', kind: 'board', extension: '.xdc' });
        assert.equal(state.draft.name, 'New');
        assert.equal(state.error, '');
    } finally { await rm(root, { recursive: true, force: true }); }
});

test('obsolete recovery drafts do not block an empty board library', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'vf-obsolete-recovery-'));
    try {
        const configPath = path.join(root, 'config.json');
        await writeFile(configPath, JSON.stringify({ boards: [{ id: 'old', name: 'Old', model: { pins: {}, interfaces: [], extension: '.xdc' } }] }));
        const library = new UserPhysicalBoardLibrary({ configPath });
        let state: any;
        const workbench = new ConstraintWorkbench({ library, source: async () => { throw new Error('unused'); }, saveAd: async s => s,
            openFile: async () => undefined, saveFile: async () => undefined, confirmDelete: async () => false }, message => { state = message; });
        workbench.restore({ drafts: [{ value: { id: 'old', name: 'Old draft', model: { pins: {}, interfaces: [], extension: '.xdc' } } }], board: 'old', page: 'library' });
        await workbench.open();
        assert.equal(state.error, '');
        assert.equal(state.notice, '');
        assert.deepEqual(state.boards, []);
        assert.equal(state.draft, undefined);
        await workbench.dispatch({ type: 'board-new', name: 'Fresh', kind: 'board', extension: '.xdc' });
        assert.equal(state.draft.name, 'Fresh');
    } finally { await rm(root, { recursive: true, force: true }); }
});

test('ready message before opening cleans obsolete boards and publishes a usable state', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'vf-ready-boards-'));
    try {
        const configPath = path.join(root, 'config.json');
        await writeFile(configPath, JSON.stringify({ boards: [{ id: 'old', name: 'Old', model: { pins: [] } }] }));
        let state: any;
        const workbench = new ConstraintWorkbench({ library: new UserPhysicalBoardLibrary({ configPath }), source: async () => { throw new Error('unused'); },
            saveAd: async s => s, openFile: async () => undefined, saveFile: async () => undefined, confirmDelete: async () => false }, message => { state = message; });
        await workbench.dispatch({ type: 'ready' });
        assert.equal(state.error, '');
        assert.deepEqual(state.boards, []);
        await workbench.dispatch({ type: 'board-new', name: 'Fresh', kind: 'board', extension: '.xdc' });
        assert.equal(state.draft.name, 'Fresh');
    } finally { await rm(root, { recursive: true, force: true }); }
});

test('recovery retains an editable V1 draft with unfinished pin templates', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'vf-draft-boards-'));
    try {
        let state: any;
        const workbench = new ConstraintWorkbench({ library: new UserPhysicalBoardLibrary({ configPath: path.join(root, 'config.json') }), source: async () => { throw new Error('unused'); },
            saveAd: async s => s, openFile: async () => undefined, saveFile: async () => undefined, confirmDelete: async () => false }, message => { state = message; });
        workbench.restore({ drafts: [{ value: { id: 'draft', name: 'Work in progress', model: { kind: 'board', extension: '', pins: { p: '' }, interfaces: [] } } }], board: 'draft', page: 'library' });
        await workbench.open();
        assert.equal(state.draft.name, 'Work in progress');
        assert.equal(state.draft.model.extension, '');
    } finally { await rm(root, { recursive: true, force: true }); }
});

test('AD export saves bindings in the source while retaining input and output ownership protection',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'vf-ad-constraints-'));
 try{const file=path.join(root,'top.ad'),library=new UserPhysicalBoardLibrary({configPath:path.join(root,'library.json')});library.saveBoard({id:'b',name:'Board',model:{kind:'board',extension:'.txt',pins:{tx:'signal={signal name}'},interfaces:[{id:'U',signals:[{id:'tx',direction:'output',pins:['tx']}]}]}});await writeFile(file,serializeArchDesign({...createEmptyArchDesign('top'),ports:[{name:'tx',direction:'output'}],defaults:{'tx.value':"1'b0"}}));
 const source=async():Promise<ConstraintSource>=>{const text=await readFile(file,'utf8'),parsed=parseArchDesignText(text);assert.equal(parsed.status,'editable');if(parsed.status!=='editable')throw new Error();return{path:file,text,module:'top',isAd:true,ports:[{name:'tx',direction:'output'}],configurationPath:file,configuration:parsed.design.physical,inputs:[{path:file,text}]};};let state:any;const workbench=new ConstraintWorkbench({library,source,saveAd:async(previous,config)=>{assert.equal(await readFile(file,'utf8'),previous.text);const parsed=parseArchDesignText(previous.text);if(parsed.status!=='editable')throw new Error();await writeFile(file,serializeArchDesign(applyArchDesignEdit(parsed.design,{type:'setPhysical',physical:config})));return source();},openFile:async()=>undefined,saveFile:async(_k,s)=>s,confirmDelete:async()=>false},m=>{state=m;});await workbench.open(file);await workbench.dispatch({type:'choose-board',board:'user:b'});await workbench.dispatch({type:'bind',interface:'U',signal:'tx',port:'tx'});await workbench.dispatch({type:'export'});assert.equal(state.error,'');assert.equal(await readFile(path.join(root,'top.txt'),'utf8'),'signal=tx');const persisted=parseArchDesignText(await readFile(file,'utf8'));assert.equal(persisted.status,'editable');if(persisted.status==='editable')assert.equal(persisted.design.physical?.bindings.length,1);await workbench.dispatch({type:'export'});assert.equal(state.error,'');
 }finally{await rm(root,{recursive:true,force:true});}
});
