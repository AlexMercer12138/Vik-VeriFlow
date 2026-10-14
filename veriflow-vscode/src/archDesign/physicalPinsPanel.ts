import * as crypto from 'crypto';
import * as path from 'path';
import * as vscode from 'vscode';
import { isDeepStrictEqual } from 'util';
import { applyArchDesignEdit, bindPhysicalSignal, bindPhysicalGroup, createPhysicalBoard, generateXdc, parseArchDesignText, parsePhysicalConfiguration, physicalMembers, physicalGroupMembers, physicalPairs, physicalSignalMembers, serializeArchDesign, type PhysicalBoard, type PhysicalConfiguration, type PhysicalPort, } from '@veriflow/schematic-core/arch-design';
import { archDesignXdcOutputPath, publishGeneratedFile } from './archDesignExport';
type BoardChoice = {
    label: string;
    reference: string;
    uri: vscode.Uri;
};
export type PhysicalPinsPanelServices = {
    ports(document: vscode.TextDocument): Promise<readonly PhysicalPort[]>;
};
const excluded = '**/{node_modules,.git,.trash,.veriflow,dist,out,web-dist}/**';
const readJson = async (uri: vscode.Uri): Promise<unknown> => JSON.parse(Buffer.from(await vscode.workspace.fs.readFile(uri)).toString('utf8'));
function folder(uri: vscode.Uri): vscode.Uri { return uri.with({ path: path.posix.dirname(uri.path) }); }
function relative(owner: vscode.Uri, target: vscode.Uri): string { return path.posix.relative(path.posix.dirname(owner.path), target.path); }
export class PhysicalPinsPanel {
    private readonly panels = new Map<string, vscode.WebviewPanel>();
    constructor(private readonly context: vscode.ExtensionContext, private readonly services: PhysicalPinsPanelServices) { }
    dispose(): void { for (const panel of [...this.panels.values()])
        panel.dispose(); }
    private libraryRoot(): vscode.Uri { return vscode.Uri.joinPath(this.context.extensionUri, 'resources', 'physical-models'); }
    private resolveBoard(owner: vscode.Uri, reference: string): vscode.Uri {
        if (reference.startsWith('library:')) {
            const suffix = reference.slice(8);
            if (!suffix || suffix.split('/').includes('..') || suffix.startsWith('/'))
                throw new Error('Invalid library board path');
            return vscode.Uri.joinPath(this.libraryRoot(), suffix);
        }
        if (path.isAbsolute(reference) || /^[A-Za-z]+:/.test(reference))
            throw new Error('Use a relative workspace board path');
        return vscode.Uri.joinPath(folder(owner), reference);
    }
    private async boards(owner: vscode.Uri): Promise<BoardChoice[]> {
        const builtins: BoardChoice[] = [];
        const walk = async (dir: vscode.Uri): Promise<void> => {
            for (const [name, type] of await vscode.workspace.fs.readDirectory(dir)) {
                const uri = vscode.Uri.joinPath(dir, name);
                if (type === vscode.FileType.Directory)
                    await walk(uri);
                else if (name === 'board.json')
                    builtins.push({ label: path.posix.basename(folder(uri).path), reference: 'library:' + path.posix.relative(this.libraryRoot().path, uri.path), uri });
            }
        };
        try {
            await walk(vscode.Uri.joinPath(this.libraryRoot(), 'boards'));
        }
        catch (error) {
            if ((error as {
                code?: string;
            }).code !== 'FileNotFound')
                throw error;
        }
        const files = await vscode.workspace.findFiles('**/*.json', excluded);
        const workspace: BoardChoice[] = [];
        for (let start = 0; start < files.length; start += 32) {
            await Promise.all(files.slice(start, start + 32).map(async (uri) => {
                if (uri.scheme !== owner.scheme || uri.authority !== owner.authority)
                    return;
                try {
                    if ((await readJson(uri) as {
                        kind?: string;
                    })?.kind === 'board')
                        workspace.push({ label: vscode.workspace.asRelativePath(uri), reference: relative(owner, uri), uri });
                }
                catch { /* Non-model JSON is not a board candidate. */ }
            }));
        }
        return [...builtins, ...workspace.sort((a, b) => a.reference.localeCompare(b.reference))];
    }
    async loadBoard(owner: vscode.Uri, reference: string, references?: (sources: vscode.Uri[]) => void): Promise<PhysicalBoard> {
        const uri = this.resolveBoard(owner, reference);
        const value = await readJson(uri) as {
            interfaces?: {
                definition: string;
            }[];
        };
        if (!value || !Array.isArray(value.interfaces))
            throw new Error('Board is missing interfaces');
        references?.([uri, ...value.interfaces.filter(instance => typeof instance?.definition === 'string').map(instance => vscode.Uri.joinPath(folder(uri), instance.definition))]);
        const definitions: Record<string, unknown> = Object.create(null);
        for (const instance of value.interfaces) {
            if (!instance || typeof instance.definition !== 'string' || path.isAbsolute(instance.definition) || /^[A-Za-z]+:/.test(instance.definition))
                throw new Error('Interface definition must use a relative path');
            definitions[instance.definition] = await readJson(vscode.Uri.joinPath(folder(uri), instance.definition));
        }
        // A workspace copy of the same hardware model uses the same generator circuit rules.
        const builtin = 'library:boards/atk-au15p/board.json';
        const profile = reference === builtin || isDeepStrictEqual(value, await readJson(this.resolveBoard(owner, builtin))) ? 'atk-au15p' : undefined;
        return createPhysicalBoard(value, definitions, profile);
    }
    async open(uri?: vscode.Uri): Promise<void> {
        uri ??= vscode.window.activeTextEditor?.document.uri;
        if (!uri || !/\.(ad|v|sv)$/i.test(uri.path))
            throw new Error('Choose an .ad, .v or .sv file');
        if (uri.scheme !== 'file')
            throw new Error('Pin constraints currently require a local workspace file');
        const existing = this.panels.get(uri.toString());
        if (existing) {
            existing.reveal();
            return;
        }
        const document = await vscode.workspace.openTextDocument(uri);
        const isAd = /\.ad$/i.test(uri.path);
        const choices = await this.boards(uri);
        let ports = await this.services.ports(document);
        if (isAd && parseArchDesignText(document.getText()).status !== 'editable')
            throw new Error('AD is not editable');
        const panel = vscode.window.createWebviewPanel('veriflow.physicalPins', `Pins · ${path.posix.basename(uri.path)}`, vscode.ViewColumn.Beside, { enableScripts: true, retainContextWhenHidden: true });
        this.panels.set(uri.toString(), panel);
        let disposed = false, board: PhysicalBoard | undefined, configuration: PhysicalConfiguration = { board: '', bindings: [] };
        let revision = 0, tail = Promise.resolve(), boardError: string | undefined, loadedVersion = document.version, ownEditText: string | undefined;
        let modelSources: vscode.Uri[] = [];
        const getDesign = () => { const parsed = parseArchDesignText(document.getText()); if (parsed.status !== 'editable')
            throw new Error('AD is not editable'); return parsed.design; };
        const load = async () => {
            const version = document.version;
            ports = await this.services.ports(document);
            if (document.version !== version)
                throw new Error('RTL ports changed; wait for refresh');
            if (isAd)
                configuration = getDesign().physical ?? { board: '', bindings: [] };
            board = undefined;
            boardError = undefined;
            if (configuration.board)
                try {
                    modelSources = [this.resolveBoard(uri!, configuration.board)];
                    board = await this.loadBoard(uri!, configuration.board, sources => { modelSources = sources; });
                }
                catch (e) {
                    boardError = e instanceof Error ? e.message : String(e);
                }
            if (document.version !== version)
                throw new Error('Document changed; wait for refresh');
            loadedVersion = version;
            if (configuration.board && !choices.some(c => c.reference === configuration.board))
                choices.push({ label: configuration.board, reference: configuration.board, uri: this.resolveBoard(uri!, configuration.board) });
        };
        const publish = async () => {
            if (disposed)
                return;
            const result = board ? generateXdc(board, configuration, ports) : undefined;
            const issues = boardError ? [{ severity: 'error', message: boardError }] : [...result?.diagnostics ?? []];
            let output: string | undefined;
            try { output = isAd ? archDesignXdcOutputPath(uri!.fsPath, getDesign()) : uri!.fsPath.replace(/\.(v|sv)$/i, '.xdc'); }
            catch (error) { issues.push({ severity: 'error', message: error instanceof Error ? error.message : String(error) }); }
            await panel.webview.postMessage({ type: 'state', revision: ++revision, isAd, choices, ports, configuration,
                board: board?.model, interfaces: board && Object.fromEntries(Object.entries(board.definitions).map(([id, def]) => [id, { ...def, members: physicalMembers(def) }])),
                issues, output: output ?? '(fix export settings)',
                canExport: !!output && !!result?.text && configuration.bindings.length > 0 });
        };
        const save = async (next: PhysicalConfiguration) => {
            if (isAd) {
                const version = document.version, design = getDesign();
                if (version !== loadedVersion)
                    throw new Error('AD changed; retry after refresh');
                const text = serializeArchDesign(applyArchDesignEdit(design, { type: 'setPhysical', physical: next }));
                if (document.version !== version)
                    throw new Error('AD changed; retry the binding');
                const edit = new vscode.WorkspaceEdit();
                edit.replace(uri!, new vscode.Range(document.positionAt(0), document.positionAt(document.getText().length)), text);
                ownEditText = text;
                try {
                    if (!await vscode.workspace.applyEdit(edit))
                        throw new Error('Unable to update AD pin bindings');
                }
                finally {
                    ownEditText = undefined;
                }
                loadedVersion = document.version;
            }
            configuration = next;
        };
        const subscription = vscode.workspace.onDidChangeTextDocument(event => {
            if (event.document.uri.toString() !== uri!.toString() || !event.contentChanges.length)
                return;
            if (ownEditText !== undefined && event.document.getText() === ownEditText)
                return;
            tail = tail.then(async () => { await load(); await publish(); }).catch(report);
        });
        const report = async (error: unknown) => { if (!disposed)
            await panel.webview.postMessage({ type: 'error', message: error instanceof Error ? error.message : String(error) }); };
        const watcher = vscode.workspace.createFileSystemWatcher('**/*.json');
        const refresh = (changed: vscode.Uri) => {
            if (!configuration.board)
                return;
            const boardUri = this.resolveBoard(uri!, configuration.board);
            const sources = [boardUri, ...modelSources];
            if (!sources.some(source => source.toString() === changed.toString()))
                return;
            tail = tail.then(async () => { await load(); await publish(); }).catch(report);
        };
        const changes = [watcher.onDidChange(refresh), watcher.onDidCreate(refresh), watcher.onDidDelete(refresh)];
        panel.onDidDispose(() => { disposed = true; subscription.dispose(); watcher.dispose(); changes.forEach(s => s.dispose()); this.panels.delete(uri!.toString()); });
        panel.webview.onDidReceiveMessage(message => {
            tail = tail.then(async () => {
                if (disposed)
                    return;
                if (message?.type === 'ready') {
                    await load();
                    await publish();
                    return;
                }
                if (message?.revision !== revision)
                    throw new Error('Pins changed; retry this action');
                if (document.version !== loadedVersion)
                    throw new Error('Document changed; retry after refresh');
                if (message.type === 'board') {
                    const choice = choices.find(c => c.reference === message.reference);
                    if (!choice)
                        throw new Error('Unknown board');
                    const loaded = await this.loadBoard(uri!, choice.reference);
                    await save({ board: choice.reference, bindings: [] });
                    board = loaded;
                    boardError = undefined;
                    modelSources = [choice.uri, ...loaded.model.interfaces.map(i => vscode.Uri.joinPath(folder(choice.uri), i.definition))];
                }
                else if (message.type === 'settings') {
                    const next = parsePhysicalConfiguration({ ...configuration, boardSettings: message.boardSettings, railVoltages: message.railVoltages });
                    await save(next);
                }
                else if (message.type === 'bind') {
                    if (!board)
                        throw new Error('Choose a board first');
                    const bindings = bindPhysicalSignal(board, ports, message.interface, message.signal, message.port);
                    // Rebinding replaces that port and its differential partner, but never another physical source.
                    const names = new Set(bindings.map(b => b.port.name));
                    await save({ ...configuration, bindings: [...configuration.bindings.filter(b => !names.has(b.port.name)), ...bindings] });
                }
                else if (message.type === 'group') {
                    if (!board || !board.definitions[message.interface] || typeof message.checked !== 'boolean' || (message.group !== undefined && typeof message.group !== 'string'))
                        throw new Error('Invalid interface group');
                    if (message.checked) {
                        const bindings = bindPhysicalGroup(board, ports, message.interface, message.group, configuration.bindings);
                        const names = new Set(bindings.map(b => b.port.name));
                        await save({ ...configuration, bindings: [...configuration.bindings.filter(b => !names.has(b.port.name)), ...bindings] });
                    }
                    else {
                        const def = board.definitions[message.interface], members = new Set(physicalGroupMembers(def, message.group));
                        if (def.kind === 'fixed')
                            for (const pair of physicalPairs(def))
                                if (members.has(pair.positive) || members.has(pair.negative)) {
                                    members.add(pair.positive);
                                    members.add(pair.negative);
                                }
                        await save({ ...configuration, bindings: configuration.bindings.filter(b => b.source.interface !== message.interface || !members.has(b.source.member)) });
                    }
                }
                else if (message.type === 'remove') {
                    if (typeof message.port !== 'string')
                        throw new Error('Invalid port');
                    const names = new Set([message.port]);
                    // Pair membership comes from actual bindings, rather than occupying an unused expansion mate.
                    if (board)
                        for (const b of configuration.bindings.filter(b => b.port.name === message.port)) {
                            const def = board.definitions[b.source.interface];
                            if (def?.kind === 'fixed')
                                for (const pair of def.differentialPairs ?? []) {
                                    const p = physicalSignalMembers(def, pair.positive), n = physicalSignalMembers(def, pair.negative);
                                    if (p.includes(b.source.member) || n.includes(b.source.member))
                                        for (const partner of configuration.bindings)
                                            if (partner.source.interface === b.source.interface && [...p, ...n].includes(partner.source.member))
                                                names.add(partner.port.name);
                                }
                        }
                    await save({ ...configuration, bindings: configuration.bindings.filter(b => !names.has(b.port.name)) });
                }
                else if (message.type === 'export') {
                    if (!board)
                        throw new Error('Choose a board first');
                    if (isAd && !await document.save())
                        throw new Error('Save AD before exporting XDC');
                    await load();
                    if (!board)
                        throw new Error(boardError ?? 'Board could not be loaded');
                    if (isAd && document.isDirty)
                        throw new Error('AD changed during save; retry export');
                    const exportVersion = document.version;
                    const result = generateXdc(board!, configuration, ports);
                    if (!result.text || !configuration.bindings.length)
                        throw new Error(result.diagnostics.map(d => d.message).join('\n') || 'Bind at least one port');
                    const defaultPath = isAd ? archDesignXdcOutputPath(uri!.fsPath, getDesign()) : uri!.fsPath.replace(/\.(v|sv)$/i, '.xdc');
                    const target = isAd ? vscode.Uri.file(defaultPath) : await vscode.window.showSaveDialog({ defaultUri: vscode.Uri.file(defaultPath), filters: { XDC: ['xdc'] }, saveLabel: 'Export XDC' });
                    if (!target) {
                        await publish();
                        return;
                    }
                    if (!/\.xdc$/i.test(target.path))
                        throw new Error('Output must use .xdc');
                    if (target.scheme !== 'file') throw new Error('XDC output must be a local file');
                    if (document.version !== exportVersion)
                        throw new Error('Document changed during export; retry export');
                    const relativeSource = path.relative(path.dirname(target.fsPath), uri!.fsPath);
                    const source = path.isAbsolute(relativeSource) ? uri!.fsPath : relativeSource;
                    const marker = '# vik-veriflow:generated xdc source=' + encodeURIComponent(source.replace(/\\/g, '/')) + '\n';
                    await publishGeneratedFile(target.fsPath, marker + '# Board: ' + configuration.board + '\n' + result.text, {}, text => text.startsWith(marker));
                    await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(target), { preview: true });
                }
                else
                    return;
                await publish();
            }).catch(async (error) => { await report(error); await publish().catch(report); });
        });
        panel.webview.html = physicalPinsHtml();
    }
}
function physicalPinsHtml(): string {
    const nonce = crypto.randomBytes(18).toString('hex');
    return String.raw `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';"><style>
    body{font:var(--vscode-font-size) var(--vscode-font-family);color:var(--vscode-foreground);background:var(--vscode-editor-background);padding:16px}select,button,input{font:inherit;color:var(--vscode-input-foreground);background:var(--vscode-input-background);border:1px solid var(--vscode-input-border);padding:5px}button{cursor:pointer}h2{font-size:1.1em}.columns{display:grid;grid-template-columns:minmax(190px,1fr) minmax(280px,2fr);gap:20px}.port,.signal{padding:8px;margin:4px 0;border:1px solid var(--vscode-panel-border);border-radius:3px}.port[draggable=true]{cursor:grab}.signal:hover{border-color:var(--vscode-focusBorder)}.signal button{float:right}label{display:block;margin:6px 0}small{color:var(--vscode-descriptionForeground)}.error{color:var(--vscode-errorForeground)}.settings{display:flex;gap:16px;flex-wrap:wrap}.bound{color:var(--vscode-textLink-foreground)}header{display:flex;gap:10px;align-items:center;flex-wrap:wrap}#issues{white-space:pre-line}button:disabled{opacity:.5}.toolbar{margin:12px 0}summary{cursor:pointer}details{margin-bottom:10px}#interfaces,#ports{max-height:65vh;overflow:auto}</style></head><body>
    <header><h1>Board / Pins</h1><select id="board" aria-label="Board"></select><button id="export">Export XDC</button></header>
    <p id="mode"></p><small id="output"></small><div id="settings" class="settings"></div><p id="error" role="alert" class="error"></p><p id="issues" role="status"></p>
    <div class="columns"><section><h2>RTL ports</h2><p><small>Drag a port onto a board signal or bus. You can also select a port and click Bind. Differential P/N ports bind together. Interface/group checkboxes fill unambiguous matching port names; uncheck to remove their bindings.</small></p><div id="ports"></div></section><section><h2>Board interfaces</h2><div id="interfaces"></div></section></div>
    <script nonce="${nonce}">
    const vscode=acquireVsCodeApi();let state,selectedPort;const el=id=>document.getElementById(id);
    const post=(type,data={})=>{el('error').textContent='';document.body.dataset.pending='true';document.querySelectorAll('select,button,input').forEach(control=>control.disabled=true);vscode.postMessage({type,revision:state?.revision,...data});};
    const option=(value,text)=>{const o=document.createElement('option');o.value=value;o.textContent=text;return o;};
    const settings=()=>{const boardSettings=[],railVoltages=[];el('settings').querySelectorAll('select').forEach(s=>{if(!s.value)return;if(s.dataset.selector)boardSettings.push({selector:s.dataset.selector,value:s.value});else railVoltages.push({rail:s.dataset.rail,millivolts:Number(s.value)});});post('settings',{boardSettings,railVoltages});};
    const bind=(iface,signal,port)=>{if(!port){el('error').textContent='Select or drag an RTL port first';return;}post('bind',{interface:iface,signal,port});};
    function render(){const scrollPorts=el('ports').scrollTop,scrollInterfaces=el('interfaces').scrollTop,expanded=new Map([...el('interfaces').querySelectorAll('details')].map(d=>[d.dataset.iface,d.open]));document.body.dataset.pending='false';document.querySelectorAll('select,button,input').forEach(control=>control.disabled=false);el('mode').textContent=state.isAd?'Bindings are saved inside the .ad document. Use Save to persist them to disk.':'Quick tool: bindings stay in this panel only.';el('output').textContent='Output: '+state.output;
    el('board').replaceChildren(option('','Choose a board'),...state.choices.map(c=>option(c.reference,c.label)));el('board').value=state.configuration.board;el('export').disabled=!state.canExport;
    el('issues').textContent=state.issues.map(i=>i.severity+': '+i.message).join('\n');el('settings').replaceChildren();
    for(const rail of state.board?.rails??[]){if(!Array.isArray(rail.millivolts))continue;const label=document.createElement('label');label.textContent=rail.id+' ';const s=document.createElement('select');s.dataset.rail=rail.id;s.append(option('','Actual voltage'),...rail.millivolts.map(v=>option(String(v),(v/1000)+' V')));s.value=String(state.configuration.railVoltages?.find(v=>v.rail===rail.id)?.millivolts??'');s.onchange=settings;label.append(s);el('settings').append(label);}
    for(const selector of state.board?.selectors??[]){const label=document.createElement('label');label.textContent=selector.id+' ';const s=document.createElement('select');s.dataset.selector=selector.id;s.append(option('','Actual jumper'),...selector.values.map(v=>option(v,v)));s.value=state.configuration.boardSettings?.find(v=>v.selector===selector.id)?.value??'';s.onchange=settings;label.append(s);el('settings').append(label);}
    el('ports').replaceChildren();const missing=[...new Set(state.configuration.bindings.map(b=>b.port.name))].filter(name=>!state.ports.some(p=>p.name===name)).map(name=>({name,direction:'missing',unresolved:true}));for(const p of [...state.ports,...missing]){const item=document.createElement('div');item.className='port'+(p.name===selectedPort?' bound':'');item.draggable=!p.unresolved;item.tabIndex=0;item.setAttribute('role','button');item.textContent=p.name+(p.indices?' ['+p.indices[0]+':'+p.indices[p.indices.length-1]+']':'')+' · '+p.direction+(p.unresolved?' (unresolved range)':'');item.ondragstart=e=>e.dataTransfer.setData('text/plain',p.name);item.onclick=()=>{selectedPort=p.name;el('ports').querySelectorAll('.port').forEach(x=>x.classList.remove('bound'));item.classList.add('bound');};item.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();item.click();}};
    const bound=state.configuration.bindings.filter(b=>b.port.name===p.name);if(bound.length){const text=document.createElement('small');text.textContent=' → '+bound.map(b=>b.source.interface+'.'+b.source.member).join(', ');item.append(document.createElement('br'),text);const remove=document.createElement('button');remove.textContent='Unbind';remove.onclick=e=>{e.stopPropagation();post('remove',{port:p.name});};item.append(remove);}el('ports').append(item);}
    const expand=(def,signal)=>{const bus=def.bus?.[signal];return typeof bus==='number'?Array.from({length:bus},(_,i)=>signal+'.'+(bus-1-i)):bus??[signal];};
    const groupBox=(iface,def,group)=>{const label=document.createElement('label'),box=document.createElement('input');box.type='checkbox';box.setAttribute('aria-label',iface+(group?' / '+group.id:''));const members=group?[...new Set(group.members.flatMap(m=>expand(def,m)))]:def.members;const count=members.filter(m=>state.configuration.bindings.some(b=>b.source.interface===iface&&b.source.member===m)).length;box.checked=count===members.length;box.indeterminate=count>0&&count<members.length;box.onclick=e=>e.stopPropagation();box.onchange=()=>post('group',{interface:iface,group:group?.id,checked:box.checked});label.append(box,document.createTextNode(' '+(group?group.id:'Select interface')));return label;};
    el('interfaces').replaceChildren();for(const [iface,def] of Object.entries(state.interfaces??{})){const detail=document.createElement('details');detail.dataset.iface=iface;detail.open=expanded.get(iface)??true;const summary=document.createElement('summary');summary.textContent=iface+' · '+(state.board.interfaces.find(i=>i.id===iface).function??Object.keys(def.function??{})[0]??'expansion');detail.append(summary,groupBox(iface,def));for(const group of def.groups??[])detail.append(groupBox(iface,def,group));
    const signals=[...Object.keys(def.bus??{}),...def.signals.filter(s=>!Object.hasOwn(def.bus??{},s))];for(const signal of signals){const row=document.createElement('div');row.className='signal';const bus=def.bus?.[signal];const members=typeof bus==='number'?Array.from({length:bus},(_,i)=>signal+'.'+(bus-1-i)):bus??[signal];const routes=state.board.routes.filter(r=>r.interface===iface&&members.includes(r.member));row.textContent=signal+(bus?' ['+members.length+']':'')+' · '+routes.map(r=>{const pin=state.board.fpgaPins.find(p=>p.id===r.pin);return r.pin+' / B'+pin.bank;}).join(', ');row.ondragover=e=>e.preventDefault();row.ondrop=e=>{e.preventDefault();bind(iface,signal,e.dataTransfer.getData('text/plain'));};const button=document.createElement('button');button.textContent='Bind';button.onclick=()=>bind(iface,signal,selectedPort);row.append(button);detail.append(row);}el('interfaces').append(detail);}el('ports').scrollTop=scrollPorts;el('interfaces').scrollTop=scrollInterfaces;}
    window.addEventListener('message',e=>{if(e.data.type==='state'){state=e.data;render();}else if(e.data.type==='error'){document.body.dataset.pending='false';document.querySelectorAll('select,button,input').forEach(control=>control.disabled=false);el('export').disabled=!state?.canExport;el('error').textContent=e.data.message;}});el('board').onchange=()=>post('board',{reference:el('board').value});el('export').onclick=()=>post('export');post('ready');
    </script></body></html>`;
}
