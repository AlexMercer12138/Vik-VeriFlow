// @ts-nocheck
import { createWebviewTransport, renderIcon } from '@veriflow/webview-ui';
import { portKey, portLabel, selectedPortBits, portGroups, groupLabel } from './portAssignments';

/* Shared constraint workspace. Hosts send state and own all file operations. */
(() => {
    'use strict';
    const $=id => document.getElementById(id),esc=value => String(value??'').replace(/[&<>"']/g,c => ({ '&': '&amp;','<': '&lt;','>': '&gt;','"': '&quot;',"'": '&#39;' }[c]));
    const iconAliases={ board: 'circuit-board', warning: 'triangle-alert', right: 'undo-2', arrow: 'redo-2', chevron: 'chevron-down', input: 'log-in', output: 'log-out', import: 'download', export: 'upload', grip: 'grip-vertical', edit: 'pencil', trash: 'trash-2', close: 'x' };
    const icon=name => renderIcon(iconAliases[name]??name).outerHTML;
    type WorkbenchMessage = { type: string; sourcePath?: string; [key: string]: unknown };
    type WorkbenchViewState = { section?: string };
    const transport=createWebviewTransport<WorkbenchMessage,WorkbenchMessage,WorkbenchViewState>(window);
    let editId=0;
    const viewState=transport.getState()??{};
    const savedViews=new Map();
    let state,draft,page='library',section=viewState.section??'pins',pinName='',selectedKey='',dragPorts=[],filter='all',toastTimer,portAnchor;
    const pickedPorts=new Set(),expandedPorts=new Set();
    let allRows=[],rowIndex=new Map(),bindingIndex=new Map(),activeKeys=new Set(),portIndex=new Map(),usedBits=new Map();
    let librarySignature='',libraryNeedsRender=true,selectionId=0,selectionTimer,expandedSignalPins='';
    const pendingSelections=new Map();
    const selectedPins=new Set(),expanded=new Set();
    const signalKey=(card,iface,signal) => JSON.stringify([card??'',iface,signal]);
    const post=(type,data={}) => { const snapshot=typeof structuredClone==='function'? structuredClone(data):JSON.parse(JSON.stringify(data)); transport.postMessage({ type,sourcePath:state?.source?.path,...snapshot }); };
    const notice=text => {
        if(!text)
            return; $('toast-text').textContent=text; $('toast').classList.add('show'); clearTimeout(toastTimer); toastTimer=setTimeout(() => $('toast').classList.remove('show'),2600);
    };
    document.querySelectorAll('[data-icon]').forEach(el => {
        const name=el.dataset.icon;
        if(name)
            el.replaceChildren(renderIcon(iconAliases[name]??name));
    });
    const basename=file => file?.split(/[\\/]/).pop()??'';
    const modelFor=card => state.models?.[card??''];
    const bindingsFor=row => members(row).map(member=>bindingIndex.get(signalKey(row.card,row.iface,member))).filter(Boolean);
    const members=row => row.signal.pins.length===1? [row.signal.id]:row.signal.pins.map((_,i) => row.signal.id+'.'+(row.signal.pins.length-1-i));
    const rows=() => allRows;
    const current=() => rows().find(row => row.key===selectedKey)??rows()[0];
    const active=row => activeKeys.has(row.key);
    const boundName=row => portGroups(bindingsFor(row).map(b=>b.port)).map(groupLabel).join(', ');
    function indexBindings() {
        allRows=state.interfaces.flatMap(iface=>iface.signals.map(signal=>({card:iface.card,iface:iface.id,signal,key:signalKey(iface.card,iface.id,signal.id)})));
        rowIndex=new Map(allRows.map(row=>[row.key,row]));
        activeKeys=new Set(state.active);
        bindingIndex=new Map((state.configuration?.bindings??[]).map(b=>[signalKey(b.source.card,b.source.interface,b.source.member),b]));
        portIndex=new Map(state.ports.map(port=>[port.name,port]));
        usedBits=new Map((state.configuration?.bindings??[]).map(b=>[portKey(b.port),b]));
    }
    function selectSignals(changes) {
        const id=++selectionId;
        for(const change of changes) pendingSelections.set(signalKey(change.card,change.interface,change.signal),{...change,id});
        applyPendingSelections();
        indexBindings();
        renderBindings();
        clearTimeout(selectionTimer);
        selectionTimer=setTimeout(()=>post('select',{changes:[...pendingSelections.values()],editId:id}),24);
    }
    function applyPendingSelections() {
        const selected=new Set(state.active);
        for(const [key,change] of pendingSelections) change.checked?selected.add(key):selected.delete(key);
        state.active=[...selected];
    }
    const labelFor=card => {
        if(!card)
            return state.boards.find(b => 'user:'+b.id===state.configuration?.board)?.name??'Board'; const cards=state.configuration?.cards??[],ref=cards.find(c => c.id===card)?.board,same=cards.filter(c => c.board===ref),index=same.findIndex(c => c.id===card); return (state.boards.find(b => 'user:'+b.id===ref)?.name??basename(ref))+(index>0? ' '+(index+1):'');
    };
    function changeDraft() { post('board-change',{ draft,editId: ++editId }); renderTemplatePreview(); updateLibraryStatus(); }
    function updateLibraryStatus() {
        if(!state)
            return; $('dirty-dot').classList.toggle('hidden',!state.dirty); $('save-board').disabled=!draft||state.issues.some(i => i.severity==='error'); $('save-board').title=state.issues.map(i => i.message).join('\n'); $('discard').disabled=!state.dirty; $('undo-board').disabled=!state.canUndo; $('redo-board').disabled=!state.canRedo;
    }
    function setPage(next) { page=next; post('page',{ page }); applyPage(); }
    function applyPage() {
        for(const p of ['library','bindings']) {
            const shown=p===page;
            $(p+'-page').classList.toggle('hidden',!shown||(p==='bindings'&&!state.source));
            document.querySelector('[data-page="'+p+'"]').classList.toggle('active',shown);
            document.querySelector('[data-page="'+p+'"]').setAttribute('aria-pressed',String(shown));
            $(p==='library'? 'library-context':'binding-context').classList.toggle('hidden',!shown);
            $(p==='library'? 'library-actions':'binding-actions').classList.toggle('hidden',!shown);
        } $('binding-empty').classList.toggle('hidden',page!=='bindings'||!!state.source); renderFooter();
    }
    function setSection(next) {
        section=next; transport.setState({ section }); for(const p of ['pins','interfaces','details']) {
            $('section-'+p).classList.toggle('hidden',p!==next);
            document.querySelector('[data-section="'+p+'"]').classList.toggle('active',p===next);
            document.querySelector('[data-section="'+p+'"]').setAttribute('aria-pressed',String(p===next));
        }
    }
    function renderFooter() {
        const err=state.error; $('workbench-error').textContent=err; $('workbench-error').classList.toggle('hidden',!err); if(page==='library') {
            $('status').innerHTML='<span class="dot '+(state.dirty? '':'good')+'"></span><span>'+(state.dirty? 'Unsaved board changes':'Board library')+'</span>';
            $('footer-hint').textContent=state.issues[0]?.message??'Available to all projects';
        }
        else {
            $('status').innerHTML='<span class="dot '+(state.canExport? 'good':'')+'"></span><span>'+(state.canExport? 'Ready to export':state.source? 'Ready to edit bindings':'Open a HDL / AD file')+'</span>';
            $('footer-hint').textContent=state.source? (state.source.isAd? 'Saved in '+basename(state.source.path):'Bindings: '+basename(state.source.path).replace(/\.(v|sv)$/i,'.pins.json')):'';
            $('export').disabled=!state.source;
            $('save-bindings').disabled=!state.configuration?.board;
            $('load-bindings').hidden=!!state.source?.isAd;
            $('save-bindings-as').hidden=!!state.source?.isAd;
        }
    }
    function renderBoards() {
        $('board-total').textContent=state.boards.length;
        $('board-list').replaceChildren();
        for(const kind of ['board','daughtercard']) {
            const list=state.boards.filter(b => b.kind===kind&&b.name.toLowerCase().includes($('board-search').value.toLowerCase()));
            const heading=document.createElement('div');
            heading.className='board-list-label';
            heading.textContent=kind==='board'? 'BOARDS':'DAUGHTERCARDS';
            $('board-list').append(heading);
            for(const b of list) {
                const button=document.createElement('button');
                button.className='board-option '+(draft?.id===b.id? 'active':'');
                button.innerHTML=icon('board')+'<span><strong>'+esc(b.name)+'</strong><small>'+b.pins+' pin templates'+(b.dirty? ' · Unsaved':'')+'</small></span>';
                button.onclick=() => { selectedPins.clear(); pinName=''; post('board-open',{ id: b.id }); };
                $('board-list').append(button);
            }
        }
        if(draft&&!state.boards.some(b => b.id===draft.id)) {
            const item=document.createElement('div');
            item.className='board-option active';
            item.innerHTML=icon('board')+'<span><strong>'+esc(draft.name||'New board')+'</strong><small>Not saved</small></span>';
            $('board-list').append(item);
        }
    }
    function pinUsage(name) { return draft?.model.interfaces.flatMap(i => i.signals.filter(s => s.pins.includes(name)).map(s => i.id+'.'+s.id))??[]; }
    function renderLibrary() {
        renderBoards();
        const empty=!draft;
        for(const id of ['section-pins','section-interfaces','section-details'])
            $(id).style.visibility=empty? 'hidden':'visible';
        $('board-title').textContent=draft?.name||'Create your first board';
        $('board-kind').textContent=draft?.model.kind==='daughtercard'? 'Daughtercard':'Board';
        $('use-board').disabled=!draft||!state.source||draft.model.kind!=='board'||state.dirty;
        if(!draft) {
            updateLibraryStatus();
            return;
        }
        if(!(pinName in draft.model.pins))
            pinName=Object.keys(draft.model.pins)[0]??'';
        $('pin-count').textContent=Object.keys(draft.model.pins).length;
        $('library-interface-count').textContent=draft.model.interfaces.length;
        renderPins();
        $('pin-name').value=pinName;
        $('pin-name').disabled=!pinName;
        $('template-text').value=draft.model.pins[pinName]??'';
        $('template-text').disabled=!pinName;
        $('delete-pin').disabled=!pinName;
        $('template-extension').textContent=draft.model.extension;
        const card=draft.model.kind==='daughtercard';
        for(const id of ['insert-pin','guide-pin','example-pin-wrap'])
            $(id).classList.toggle('hidden',!card);
        $('guide-title').textContent=card? 'Daughtercard pin':'Board pin';
        $('guide-subtitle').textContent=card? 'Variable position, independent settings.':'Fixed location, replace the signal.';
        $('template-type').textContent=card? 'Position set in each design':'Fixed position';
        $('detail-name').value=draft.name;
        $('detail-kind').value=draft.model.kind;
        $('detail-extension').value=draft.model.extension;
        renderInterfaceEditors();
        renderTemplatePreview();
        updateLibraryStatus();
        setSection(section);
    }
    function renderPins() {
        $('template-list').replaceChildren(); if(!draft)
            return; for(const name of Object.keys(draft.model.pins).filter(n => n.toLowerCase().includes($('template-search').value.toLowerCase()))) {
                const item=document.createElement('div');
                item.className='template-list-item '+(name===pinName? 'selected':'');
                item.innerHTML='<label><input type="checkbox" '+(selectedPins.has(name)? 'checked':'')+' aria-label="Select template '+esc(name)+'"></label><button aria-label="Edit template '+esc(name)+'"><strong>'+esc(name)+'</strong><small>'+esc(pinUsage(name).join(', ')||'Not grouped')+'</small></button>';
                item.querySelector('button').onclick=() => { pinName=name; renderLibrary(); };
                item.querySelector('input').onchange=e => { e.target.checked? selectedPins.add(name):selectedPins.delete(name); renderSelection(); };
                $('template-list').append(item);
            } renderSelection();
    }
    function renderSelection() { $('selected-pin-count').textContent=selectedPins.size+' pins selected'; $('create-from-pins').disabled=!selectedPins.size; }
    function renderTemplatePreview() {
        if(!draft) return;
        const text=draft.model.pins[pinName]??'',pin=$('example-pin').value,preview=$('template-preview');
        preview.replaceChildren();
        for(const [index,[label,signal]] of [['Single signal','bit'],['Bus bit','bus[0]']].entries()) {
            const comment=document.createElement('span');
            comment.className='preview-comment';
            comment.textContent=(index?(/[\r\n]$/.test(text)?'\n':'\n\n'):'')+'# '+label+': '+signal+'\n';
            preview.append(comment,document.createTextNode(text.replace(/\{signal name\}|\{pin name\}/g,token=>token==='{signal name}'?signal:pin)));
        }
        $('template-preview-label').textContent='bit · bus[0]'+(draft.model.kind==='daughtercard'?' · '+pin:'');
    }
    function field(value,change,type='text') { const el=document.createElement('input'); el.type=type; el.value=String(value); el.onchange=() => change(el.value); return el; }
    function action(label,fn) { const b=document.createElement('button'); b.className='subtle-link'; b.textContent=label; b.onclick=fn; return b; }
    function pinTemplateSelect(iface,signal,index,onChange) {
        const select=document.createElement('select');
        select.setAttribute('aria-label',iface.id+' '+signal.id+' bit '+(signal.pins.length-1-index)+' template');
        select.add(new Option('Choose template',''));
        for(const name of Object.keys(draft.model.pins)) select.add(new Option(name,name));
        select.value=signal.pins[index];
        select.onchange=()=>{signal.pins[index]=select.value;onChange?.();changeDraft();};
        return select;
    }
    function renderSignalPins(iface,signal,container,updateSummary) {
        container.replaceChildren();
        const list=document.createElement('div');
        list.className='signal-pin-list';list.setAttribute('role','group');list.setAttribute('aria-label','Pin templates for '+iface.id+'.'+signal.id);
        signal.pins.forEach((pin,index)=>{
            const label=document.createElement('label'),bit=document.createElement('span');
            bit.textContent=signal.id+'['+(signal.pins.length-1-index)+']';
            label.append(bit,pinTemplateSelect(iface,signal,index,updateSummary));list.append(label);
        });
        const bulk=document.createElement('details');bulk.className='signal-pin-bulk';
        const summary=document.createElement('summary');summary.textContent='Paste pin names';
        const input=document.createElement('textarea');input.className='vf-textarea vf-textarea--mono';input.rows=3;
        input.setAttribute('aria-label','Pin templates for '+iface.id+'.'+signal.id+', high bit first');
        input.placeholder='Paste '+signal.pins.length+' template names, separated by commas or lines. High bit first.';
        const status=document.createElement('div');status.className='signal-pin-error';status.setAttribute('role','status');
        const apply=action('Apply pin names',()=>{
            const names=input.value.trim().split(/[,\s]+/).filter(Boolean);
            const occupied=new Set(iface.signals.filter(other=>other!==signal).flatMap(other=>other.pins).filter(Boolean));
            let error='';
            if(names.length!==signal.pins.length) error='Enter exactly '+signal.pins.length+' template names, high bit first.';
            else if(names.some(name=>!Object.prototype.hasOwnProperty.call(draft.model.pins,name))) error='Unknown template: '+names.find(name=>!Object.prototype.hasOwnProperty.call(draft.model.pins,name));
            else if(new Set(names).size!==names.length) error='Each bit needs a different pin template.';
            else if(names.some(name=>occupied.has(name))) error='Template already used in this interface: '+names.find(name=>occupied.has(name));
            status.textContent=error;input.setAttribute('aria-invalid',String(!!error));
            if(error)return;
            signal.pins=names;updateSummary();changeDraft();
            list.querySelectorAll('select').forEach((select,index)=>select.value=names[index]);
            status.textContent='Assigned '+names.length+' pins, high bit to low bit.';
        });
        apply.className='vf-btn';apply.setAttribute('aria-label','Apply '+iface.id+'.'+signal.id+' pin templates');
        input.oninput=()=>{status.textContent='';input.removeAttribute('aria-invalid');};
        bulk.append(summary,input,apply,status);container.append(list,bulk);
    }
    function renderInterfaceEditors() {
        $('interface-editors').replaceChildren(); if(!draft)
            return; for(const [i,iface] of draft.model.interfaces.entries()) {
                const wrap=document.createElement('div');
                wrap.className='interface-editor';
                const heading=document.createElement('div');
                heading.className='iface-head';
                const name=field(iface.id,v => { iface.id=v; changeDraft(); renderInterfaceEditors(); });
                name.setAttribute('aria-label','Interface name');
                heading.append(name,action('Remove interface',() => { draft.model.interfaces.splice(i,1); changeDraft(); renderInterfaceEditors(); }));
                wrap.append(heading);
                const table=document.createElement('table');
                table.className='edit-table';
                table.innerHTML='<thead><tr><th>SIGNAL</th><th>DIRECTION</th><th>WIDTH</th><th>PIN TEMPLATES</th><th></th></tr></thead>';
                const body=document.createElement('tbody');
                for(const [j,signal] of iface.signals.entries()) {
                    const row=document.createElement('tr');
                    const nameCell=document.createElement('td'),dirCell=document.createElement('td'),widthCell=document.createElement('td'),pinsCell=document.createElement('td'),remove=document.createElement('td');
                    const signalName=field(signal.id,v => { signal.id=v; changeDraft(); renderInterfaceEditors(); });
                    signalName.setAttribute('aria-label','Signal name');
                    nameCell.append(signalName);
                    const dir=document.createElement('select');
                    dir.setAttribute('aria-label','Signal direction');
                    for(const value of ['input','output','inout'])
                        dir.add(new Option(value,value));
                    dir.value=signal.direction;
                    dir.onchange=() => { signal.direction=dir.value; changeDraft(); };
                    dirCell.append(dir);
                    const width=field(signal.pins.length,v => {
                        const count=Number(v); if(!Number.isInteger(count)||count<1||count>4096)
                            return; signal.pins=Array.from({ length: count },(_,k) => signal.pins[k]??''); changeDraft(); renderInterfaceEditors();
                    },'number');
                    width.min='1';
                    width.max='4096';
                    width.setAttribute('aria-label','Signal width');
                    widthCell.append(width);
                    let detail;
                    if(signal.pins.length===1) pinsCell.append(pinTemplateSelect(iface,signal,0));
                    else {
                        const key=JSON.stringify([draft.id,i,j]),edit=action('',()=>{expandedSignalPins=expandedSignalPins===key?'':key;renderInterfaceEditors();});
                        edit.className='signal-pins-toggle subtle-link';
                        edit.setAttribute('aria-label','Edit '+iface.id+'.'+signal.id+' pin templates');
                        edit.setAttribute('aria-expanded',String(expandedSignalPins===key));
                        const updateSummary=()=>{edit.textContent=signal.pins.filter(pin=>Object.prototype.hasOwnProperty.call(draft.model.pins,pin)).length+'/'+signal.pins.length+' pins · '+(expandedSignalPins===key?'Close':'Edit');};
                        updateSummary();pinsCell.append(edit);
                        if(expandedSignalPins===key) {
                            detail=document.createElement('tr');detail.className='signal-pins-detail';
                            const cell=document.createElement('td'),editor=document.createElement('div');cell.colSpan=5;editor.className='signal-pin-editor';
                            renderSignalPins(iface,signal,editor,updateSummary);cell.append(editor);detail.append(cell);
                        }
                    }
                    remove.append(action('×',() => { iface.signals.splice(j,1); changeDraft(); renderInterfaceEditors(); }));
                    row.append(nameCell,dirCell,widthCell,pinsCell,remove);
                    body.append(row);
                    if(detail)body.append(detail);
                }
                table.append(body);
                const footer=document.createElement('div');
                footer.className='iface-footer';
                footer.append(action('+ Add signal',() => { iface.signals.push({ id: 'signal'+iface.signals.length,direction: 'input',pins: [''] }); changeDraft(); renderInterfaceEditors(); }));
                wrap.append(table,footer);
                $('interface-editors').append(wrap);
            }
    }
    function portValid(row,refs) {
        if(typeof refs==='string') refs=selectedPortBits(state.ports,new Set([portKey({name:refs})]));
        const previous=new Set(bindingsFor(row));
        return refs.length===row.signal.pins.length&&refs.every(ref=>{
            const port=portIndex.get(ref.name),used=usedBits.get(portKey(ref));
            return port&&!port.unresolved&&port.direction===row.signal.direction&&(port.indices?port.indices.includes(ref.bit):ref.bit===undefined)&&(!used||previous.has(used));
        });
    }
    function pickedBits() { return selectedPortBits(state.ports,pickedPorts); }
    function markTargets(refs) {
        for(const row of $('binding-rows').querySelectorAll('tr[data-key]')) {
            const data=rowIndex.get(row.dataset.key);
            row.classList.toggle('drop-compatible',!!refs.length&&portValid(data,refs));
            row.classList.toggle('drop-incompatible',!!refs.length&&!portValid(data,refs));
            if(!refs.length)
                row.classList.remove('drop-over');
        } $('drag-hint').textContent=refs.length? 'Drop '+refs.length+' selected bit'+(refs.length===1?'':'s')+' onto a highlighted row.':'Select ports or expand a bus, then drag to a signal.';
    }
    function bind(row,refs) {
        if(refs.length&&!portValid(row,refs)) {
            notice('Total width or direction does not match, or a selected bit is already assigned.');
            return;
        } pickedPorts.clear(); dragPorts=[]; post('bind',{ card: row.card,interface: row.iface,signal: row.signal.id,ports: refs });
    }
    function renderBindings() {
        const restoredView=state.source?.path&&savedViews.get(state.source.path);
        if(restoredView&&selectedKey==='') {
            selectedKey=restoredView.selectedKey;
        }
        const source=state.source;
        $('current-file').querySelector('strong').textContent=basename(source?.path);
        $('current-file').querySelector('.typepill').textContent=source?.module??'';
        $('port-browser').querySelector('h2').textContent=source?.module??'Top-level ports';
        const select=$('board-context');
        select.replaceChildren(new Option('Choose a board',''));
        for(const b of state.boards.filter(b => b.kind==='board'&&b.saved!==false))
            select.add(new Option(b.name,'user:'+b.id));
        if(state.configuration?.board&&!Array.from(select.options).some(o => o.value===state.configuration.board))
            select.add(new Option(state.configuration.board,state.configuration.board));
        select.value=state.configuration?.board??'';
        const all=rows();
        if(!all.some(r => r.key===selectedKey))
            selectedKey=all[0]?.key??'';
        $('interfaces').replaceChildren();
        for(const card of [undefined,...(state.configuration?.cards??[]).map(c => c.id)]) {
            const head=document.createElement('div');
            head.className='source-section';
            head.textContent=labelFor(card);
            $('interfaces').append(head);
            for(const iface of state.interfaces.filter(i => i.card===card)) {
                const group=document.createElement('div');
                group.className='interface-group';
                const title=document.createElement('label');
                title.className='group-line';
                const box=document.createElement('input');
                box.type='checkbox';
                box.checked=iface.signals.length>0&&iface.signals.every(s => activeKeys.has(signalKey(card,iface.id,s.id)));
                box.indeterminate=!box.checked&&iface.signals.some(s => activeKeys.has(signalKey(card,iface.id,s.id)));
                box.onchange=() => {
                    selectSignals(iface.signals.map(s=>({card,interface:iface.id,signal:s.id,checked:box.checked})));
                };
                title.append(box,document.createTextNode(iface.id));
                group.append(title);
                for(const signal of iface.signals.filter(s => (iface.id+'.'+s.id).toLowerCase().includes($('interface-search').value.toLowerCase()))) {
                    const row=rowIndex.get(signalKey(card,iface.id,signal.id));
                    const label=document.createElement('div');
                    label.className='signal-item '+(row.key===selectedKey? 'selected':'');
                    const check=document.createElement('input');
                    check.type='checkbox';
                    check.checked=active(row);
                    check.setAttribute('aria-label','Select signal '+iface.id+'.'+signal.id);
                    const toggle=checked=>{ selectedKey=row.key; selectSignals([{card,interface:iface.id,signal:signal.id,checked}]); };
                    check.onchange=() => toggle(check.checked);
                    const button=document.createElement('button');
                    button.textContent=signal.id+(signal.pins.length>1? ' ['+(signal.pins.length-1)+':0]':'');
                    button.onclick=() => toggle(!active(row));
                    label.append(check,button);
                    group.append(label);
                }
                $('interfaces').append(group);
            }
        }
        $('binding-rows').replaceChildren();
        const activeRows=all.filter(active);
        let ready=0;
        const visibleRows=[];
        for(const row of activeRows) {
            const bs=bindingsFor(row),name=boundName(row),model=modelFor(row.card),needs=row.signal.pins.some(pin => model.pins[pin]?.includes('{pin name}')),complete=bs.length===row.signal.pins.length&&(!needs||bs.every(b => b.pin?.trim()));
            if(complete)
                ready++;
            if(filter==='incomplete'&&complete)
                continue;
            visibleRows.push({ row,bs,name,model,needs,complete,label: row.iface+'.'+row.signal.id });
        }
        const groupCounts=new Map();
        for(const item of visibleRows) {
            const key=(item.row.card??'')+'|'+item.row.iface;
            groupCounts.set(key,(groupCounts.get(key)??0)+1);
        }
        let lastGroup='';
        for(const item of visibleRows) {
            const { row,bs,name,model,needs,complete,label }=item;
            const groupKey=(row.card??'')+'|'+row.iface;
            if(groupKey!==lastGroup) {
                lastGroup=groupKey;
                const groupRow=document.createElement('tr');
                groupRow.className='cx-group';
                const groupCell=document.createElement('td');
                groupCell.colSpan=4;
                groupCell.className='cx-group-cell';
                groupCell.innerHTML='<span class="cx-group-icon">'+icon('route')+'</span><span class="cx-group-name">'+esc(row.iface)+'</span><span class="cx-group-source">'+esc(labelFor(row.card))+'</span><span class="vf-spacer"></span><span class="vf-count">'+(groupCounts.get(groupKey)??0)+'</span>';
                groupRow.append(groupCell);
                $('binding-rows').append(groupRow);
            }
            const tr=document.createElement('tr');
            tr.dataset.key=row.key;
            tr.className=(row.key===selectedKey? 'current ':'')+(!complete? 'needs':'');
            const dotClass=complete? 'ok':name? 'warn':'';
            const dir=row.signal.direction;
            tr.innerHTML='<td class="row-select"><span class="bind-dot '+dotClass+'"></span><span class="signal-name">'+esc(row.signal.id)+'</span><span class="direction '+dir+'" title="'+esc(dir)+'" aria-label="'+esc(dir)+'">'+icon(dir==='inout'? 'route':dir==='input'?'input':'output')+'</span></td><td><span class="width">'+row.signal.pins.length+'</span></td><td><div class="port-dropzone '+(name? 'has-port':'empty-port')+'"><button class="port-drop-action" aria-label="Bind '+esc(labelFor(row.card)+' '+label)+'">'+icon(name? 'route':'plus')+'</button><span class="port-chips"></span>'+(name? '<button class="clear-binding" aria-label="Clear '+esc(label)+'">×</button>':'')+'</div></td><td class="physical-cell"></td>';
            const groups=portGroups(bs.map(b=>b.port));
            groups.forEach((group,index)=>{
                const chip=document.createElement('span');
                chip.className='port-chip'; chip.textContent=groupLabel(group); chip.draggable=true; chip.tabIndex=0;
                chip.title='Drag left or right to reorder; Alt+Left / Alt+Right';
                chip.ondragstart=e=>{e.stopPropagation();dragPorts=[];e.dataTransfer.setData('application/x-veriflow-port-order',JSON.stringify({key:row.key,index}));e.dataTransfer.effectAllowed='move';};
                const move=target=>{const reordered=groups.slice(),[item]=reordered.splice(index,1);reordered.splice(target,0,item);bind(row,reordered.flat());};
                chip.onkeydown=e=>{if(e.altKey&&['ArrowLeft','ArrowRight'].includes(e.key)){e.preventDefault();move(Math.max(0,Math.min(groups.length-1,index+(e.key==='ArrowLeft'?-1:1))));}};
                chip.ondragover=e=>{if(e.dataTransfer.types.includes('application/x-veriflow-port-order')){e.preventDefault();e.stopPropagation();e.dataTransfer.dropEffect='move';chip.classList.add('reorder-over');}};
                chip.ondragleave=()=>chip.classList.remove('reorder-over');
                chip.ondrop=e=>{if(!e.dataTransfer.types.includes('application/x-veriflow-port-order'))return;e.preventDefault();e.stopPropagation();const source=JSON.parse(e.dataTransfer.getData('application/x-veriflow-port-order'));if(source.key!==row.key)return;const reordered=groups.slice(),[item]=reordered.splice(source.index,1);let target=index+(e.clientX>chip.getBoundingClientRect().x+chip.getBoundingClientRect().width/2?1:0);if(source.index<target)target--;reordered.splice(target,0,item);bind(row,reordered.flat());};
                tr.querySelector('.port-chips').append(chip);
            });
            tr.querySelector('.row-select').onclick=() => {
                selectedKey=row.key; if(row.signal.pins.length>1) {
                    expanded.has(row.key)? expanded.delete(row.key):expanded.add(row.key);
                } renderBindings();
            };
            tr.querySelector('.port-drop-action').onclick=() => {
                selectedKey=row.key; if(pickedPorts.size)
                    bind(row,pickedBits());
                else {
                    renderBindings();
                    $('port-search').focus();
                }
            };
            tr.querySelector('.clear-binding')?.addEventListener('click',() => bind(row,[]));
            const cell=tr.querySelector('.physical-cell');
            if(!row.card||!needs)
                cell.innerHTML='<span class="fixed-label" title="Defined by the board template">'+icon('lock')+'<span class="vf-visually-hidden">Fixed in template</span></span>';
            else if(row.signal.pins.length>1)
                cell.append(action('Edit '+row.signal.pins.length+' pins',() => { expanded.has(row.key)? expanded.delete(row.key):expanded.add(row.key); renderBindings(); }));
            else {
                const input=field(bs[0]?.pin??'',v => post('pin',{ card: row.card,interface: row.iface,member: row.signal.id,pin: v }));
                input.className='pin-entry';
                input.placeholder=name? 'FPGA pin':'Bind port first';
                input.disabled=!name;
                input.setAttribute('aria-label',label+' FPGA pin');
                cell.append(input);
            }
            tr.ondragover=e => {
                if(!dragPorts.length)
                    return; e.preventDefault(); const valid=portValid(row,dragPorts); e.dataTransfer.dropEffect=valid? 'copy':'none'; tr.classList.toggle('drop-over',valid);
            };
            tr.ondragleave=e => {
                if(!tr.contains(e.relatedTarget))
                    tr.classList.remove('drop-over');
            };
            tr.ondrop=e => { if(!dragPorts.length)return;e.preventDefault();bind(row,dragPorts); };
            $('binding-rows').append(tr);
            if(expanded.has(row.key)&&row.signal.pins.length>1) {
                const detail=document.createElement('tr');
                detail.className='bus-expansion';
                const td=document.createElement('td');
                td.colSpan=4;
                members(row).forEach((member,i) => {
                    const b=bs.find(b => b.source.member===member); const item=document.createElement('div'); item.className='bus-bit-row'; item.innerHTML='<span>'+esc(member)+'</span><span>'+esc(row.signal.pins[i])+'</span><span>'+esc(b? b.port.name+(b.port.bit!==undefined? '['+b.port.bit+']':''):'Not bound')+'</span>'; if(row.card&&model.pins[row.signal.pins[i]]?.includes('{pin name}')) {
                        const input=field(b?.pin??'',v => post('pin',{ card: row.card,interface: row.iface,member,pin: v }));
                        input.disabled=!b;
                        input.placeholder='FPGA pin';
                        input.setAttribute('aria-label',label+' '+member+' FPGA pin');
                        item.append(input);
                    } td.append(item);
                });
                detail.append(td);
                $('binding-rows').append(detail);
            }
        }
        $('selected-count').textContent=activeRows.length;
        $('incomplete-count').textContent=activeRows.length-ready;
        $('interface-count').textContent=state.interfaces.length;
        $('export-preview').textContent=state.preview;
        $('output-filename').textContent=basename(state.output);
        $('incomplete-note').textContent=state.diagnostics.length? 'Complete the selected bindings, then export for details.':'';
        const cards=state.configuration?.cards??[];
        $('card-count').textContent=cards.length+' added';
        $('card-instance').replaceChildren();
        $('card-instance').classList.toggle('hidden',!cards.length);
        cards.forEach(c => { const wrap=document.createElement('div'); wrap.innerHTML='<strong>'+esc(labelFor(c.id))+'</strong>'; wrap.append(action('Remove',() => post('remove-card',{ card: c.id }))); $('card-instance').append(wrap); });
        renderPorts();
        markTargets(dragPorts.length?dragPorts:pickedBits());
    }
    function renderPorts() {
        const row=current();
        $('port-list').replaceChildren();
        const entries=state.ports.filter(p=>p.name.toLowerCase().includes($('port-search').value.toLowerCase())).flatMap(p=>[
            {p,ref:{name:p.name},indices:p.indices},
            ...(expandedPorts.has(p.name)?(p.indices??[]).map(bit=>({p,ref:{name:p.name,bit},indices:[bit]})):[]),
        ]);
        const entryBits=entry=>(entry.indices??[undefined]).map(bit=>({name:entry.p.name,...(bit===undefined?{}:{bit})}));
        const isUsed=entry=>entryBits(entry).map(ref=>usedBits.get(portKey(ref))).find(Boolean);
        const togglePort=(entry,checked)=>{
            if(checked){
                if(entry.ref.bit===undefined) for(const bit of entry.p.indices??[]) pickedPorts.delete(portKey({name:entry.p.name,bit}));
                else pickedPorts.delete(portKey({name:entry.p.name}));
                pickedPorts.add(portKey(entry.ref));
            }else pickedPorts.delete(portKey(entry.ref));
        };
        $('compatible-count').textContent=state.ports.reduce((sum,p)=>sum+(p.indices??[undefined]).filter(bit=>!usedBits.has(portKey({name:p.name,bit}))).length,0)+' bits free';
        for(const [index,entry] of entries.entries()) {
            const {p,ref,indices}=entry,key=portKey(ref),used=isUsed(entry),button=document.createElement('button'),wrap=document.createElement('div');
            wrap.className='port-entry'+(ref.bit!==undefined?' port-bit':'');
            const check=document.createElement('input');check.type='checkbox';check.checked=pickedPorts.has(key);check.disabled=!!used||p.unresolved;
            check.setAttribute('aria-label','Select port '+portLabel(p.name,ref.bit===undefined?undefined:[ref.bit]));
            check.onchange=()=>{togglePort(entry,check.checked);renderPorts();markTargets(pickedBits());};
            wrap.append(check);
            if(p.indices&&ref.bit===undefined){
                const expand=document.createElement('button');expand.className='port-expand vf-icon-btn vf-icon-btn--sm';
                expand.setAttribute('aria-label',(expandedPorts.has(p.name)?'Collapse':'Expand')+' port '+p.name);
                expand.setAttribute('aria-expanded',String(expandedPorts.has(p.name)));
                expand.innerHTML=icon(expandedPorts.has(p.name)?'chevron-down':'chevron-right');
                expand.onclick=()=>{expandedPorts.has(p.name)?expandedPorts.delete(p.name):expandedPorts.add(p.name);renderPorts();};wrap.append(expand);
            }
            button.dataset.port=p.name;
            if(ref.bit!==undefined)button.dataset.bit=String(ref.bit);
            button.className='port-item '+(used||p.unresolved?'used-port ':'')+(pickedPorts.has(key)?'picked-port':'');
            button.draggable=!used&&!p.unresolved;
            button.setAttribute('aria-label','Port '+portLabel(p.name,ref.bit===undefined?undefined:[ref.bit]));
            button.setAttribute('aria-pressed',String(pickedPorts.has(key)));
            button.innerHTML=icon(used?'check':'grip')+'<span><strong>'+esc(portLabel(p.name,indices))+'</strong><small>'+esc(p.direction)+' · '+(indices?.length??1)+' bit'+(p.unresolved?' · unresolved':'')+'</small></span>';
            button.onclick=e=>{
                if(used){const target=rows().find(r=>r.card===used.source.card&&r.iface===used.source.interface&&members(r).includes(used.source.member));if(target)selectedKey=target.key;renderBindings();return;}
                if(p.unresolved)return;
                if(e.shiftKey&&portAnchor!==undefined){for(const item of entries.slice(Math.min(portAnchor,index),Math.max(portAnchor,index)+1))if(!isUsed(item)&&!item.p.unresolved)togglePort(item,true);}
                else if(e.ctrlKey||e.metaKey)togglePort(entry,!pickedPorts.has(key));
                else {const selected=pickedPorts.has(key)&&pickedPorts.size===1;pickedPorts.clear();if(!selected)togglePort(entry,true);}
                portAnchor=index;renderPorts();markTargets(pickedBits());
            };
            button.ondragstart=e=>{
                if(!pickedPorts.has(key)){pickedPorts.clear();togglePort(entry,true);}
                dragPorts=pickedBits();e.dataTransfer.setData('text/plain',portGroups(dragPorts).map(groupLabel).join(', '));e.dataTransfer.effectAllowed='copy';markTargets(dragPorts);
            };
            button.ondragend=()=>{dragPorts=[];markTargets(pickedBits());};
            wrap.append(button);$('port-list').append(wrap);
        }
        if(row) {
            const model=modelFor(row.card),text=model?.pins[row.signal.pins[0]]??'';
            $('binding-selected-title').textContent=row.iface+'.'+row.signal.id;
            $('binding-selected-detail').textContent=labelFor(row.card)+' · '+row.signal.direction;
            $('binding-template').textContent=text;
            $('signal-example').textContent=boundName(row)||'Not assigned';
            $('binding-pin-example').classList.toggle('hidden',!row.card||!text.includes('{pin name}'));
            $('pin-example').textContent=bindingsFor(row)[0]?.pin||'Not entered';
            $('selected-summary').textContent=row.card? 'Uses the daughtercard’s own template.':'Position is fixed in the board template.';
        }
    }
    function receive(message: WorkbenchMessage) {
        const scroll={ library: document.querySelector('.library-main').scrollTop,main: document.querySelector('.main').scrollTop,inspector: document.querySelector('#port-browser').scrollTop }; const next=message?.data??message; if(next.type!=='state')
            return; if(state?.source?.path&&state.source.path!==next.source?.path) {
                savedViews.set(state.source.path,{ selectedKey });
                selectedKey='';
                pickedPorts.clear();expandedPorts.clear();pendingSelections.clear();clearTimeout(selectionTimer);
            }
        if(next.reason==='select') for(const [key,change] of pendingSelections)if(change.id<=next.editId)pendingSelections.delete(key);
        const signature=JSON.stringify([next.draft,next.boards]);
        if(signature!==librarySignature)libraryNeedsRender=true;
        librarySignature=signature;
        state=next;applyPendingSelections();indexBindings();page=state.page; const focused=document.activeElement; const keep=next.reason==='board-change'&&draft?.id===next.draft?.id; if(!keep)
            draft=structuredClone(next.draft);
        if(page==='library'&&!keep&&libraryNeedsRender){renderLibrary();libraryNeedsRender=false;}
        else if(page==='library'&&keep){
            updateLibraryStatus();
            renderBoards();
            libraryNeedsRender=false;
        }else updateLibraryStatus();
        renderBindings(); applyPage(); if(next.notice)
            notice(next.notice); if(keep&&focused?.isConnected)
            focused.focus(); document.querySelector('.library-main').scrollTop=scroll.library; document.querySelector('.main').scrollTop=scroll.main; document.querySelector('#port-browser').scrollTop=scroll.inspector;
    }
    transport.onMessage(receive);
    document.addEventListener('visibilitychange',()=>{if(!document.hidden&&state?.source&&page==='bindings')post('source-refresh');});
    document.querySelectorAll('[data-page]').forEach(b => b.onclick=() => setPage(b.dataset.page));
    document.querySelectorAll('[data-section]').forEach(b => b.onclick=() => setSection(b.dataset.section));
    document.querySelectorAll('[data-filter]').forEach(b => b.onclick=() => { filter=b.dataset.filter; document.querySelectorAll('[data-filter]').forEach(x => { x.classList.toggle('active',x===b); x.setAttribute('aria-pressed',String(x===b)); }); renderBindings(); });
    $('toggle-interfaces').onclick=() => $('bindings-page').classList.toggle('interfaces-open');
    $('close-interfaces').onclick=() => $('bindings-page').classList.remove('interfaces-open');
    $('board-context').onchange=e => post('choose-board',{ board: e.target.value });
    $('refresh-source').onclick=() => post('source-refresh');
    $('save-bindings-as').onclick=() => post('bindings-save',{ saveAs: true });
    $('load-bindings').onclick=() => post('bindings-load');
    $('open-file').onclick=() => post('source-open');
    $('new-board').onclick=() => { $('new-board-dialog').showModal(); $('new-name').focus(); };
    $('confirm-new-board').onclick=() => {
        if(!$('new-name').value.trim()) { $('new-name').setCustomValidity('Enter a board name'); $('new-name').reportValidity(); return; }
        $('new-name').setCustomValidity('');
        if(!$('new-extension').reportValidity()) return;
        post('board-new',{ name: $('new-name').value,kind: $('new-kind').value,extension: $('new-extension').value }); $('new-board-dialog').close(); pinName=''; section='pins';
    };
    $('new-name').oninput=() => $('new-name').setCustomValidity('');
    $('import-board').onclick=() => post('board-import');
    for(const [id,type] of [['save-board','board-save'],['discard','board-discard'],['copy-board','board-copy'],['export-board','board-export'],['delete-board','board-delete'],['undo-board','board-undo'],['redo-board','board-redo'],['use-board','board-use'],['save-bindings','bindings-save'],['export','export']])
        $(id).onclick=() => post(type);
    const editBoard=card => {
        const ref=card? state.configuration.cards.find(c => c.id===card)?.board:state.configuration?.board; if(ref?.startsWith('user:')) {
            pinName='';
            section='pins';
            post('board-open',{ id: ref.slice(5) });
        }
        else
            notice('Import this board file into the board library to edit it.');
    };
    $('edit-board').onclick=() => editBoard();
    $('edit-selected-template').onclick=() => {
        const row=current(); if(row)
            editBoard(row.card);
    };
    $('add-card').onclick=() => {
        const select=$('card-model'); select.replaceChildren(); state.boards.filter(b => b.kind==='daughtercard'&&b.saved!==false).forEach(b => select.add(new Option(b.name,b.id))); if(!select.options.length) {
            notice('Create or import a daughtercard in the board library first.');
            setPage('library');
            return;
        } $('card-dialog').showModal();
    };
    $('confirm-card').onclick=() => { post('add-card',{ id: $('card-model').value }); $('card-dialog').close(); };
    document.querySelectorAll('[data-close]').forEach(b => b.onclick=() => $(b.dataset.close).close());
    $('template-text').oninput=e => {
        if(!draft||!pinName)
            return; draft.model.pins[pinName]=e.target.value; changeDraft();
    };
    $('pin-name').onchange=e => {
        const next=e.target.value.trim(); if(!draft||!pinName||!next||next===pinName)
            return; if(Object.prototype.hasOwnProperty.call(draft.model.pins,next)) {
                notice('Use a unique template name');
                return;
            } const pins=Object.fromEntries(Object.entries(draft.model.pins).map(([name,text]) => [name===pinName? next:name,text])); draft.model.pins=pins; draft.model.interfaces.forEach(i => i.signals.forEach(s => s.pins=s.pins.map(p => p===pinName? next:p))); pinName=next; changeDraft(); renderLibrary();
    };
    $('add-pin').onclick=() => {
        if(!draft)
            return; let name='pin'; for(let n=1;Object.prototype.hasOwnProperty.call(draft.model.pins,name);n++)
            name='pin'+n; draft.model.pins[name]=''; pinName=name; changeDraft(); renderLibrary(); $('pin-name').focus(); $('pin-name').select();
    };
    $('delete-pin').onclick=() => {
        if(pinUsage(pinName).length) {
            notice('Remove the interface reference before deleting this template.');
            return;
        } delete draft.model.pins[pinName]; pinName=''; changeDraft(); renderLibrary();
    };
    $('create-from-pins').onclick=() => { draft.model.interfaces.push({ id: 'INTERFACE'+(draft.model.interfaces.length+1),signals: [...selectedPins].map(name => ({ id: name,direction: 'input',pins: [name] })) }); selectedPins.clear(); changeDraft(); renderLibrary(); setSection('interfaces'); };
    $('add-interface').onclick=() => { draft.model.interfaces.push({ id: 'INTERFACE'+(draft.model.interfaces.length+1),signals: [] }); changeDraft(); renderInterfaceEditors(); };
    $('detail-name').onchange=e => { draft.name=e.target.value; changeDraft(); renderLibrary(); };
    $('detail-extension').onchange=e => { draft.model.extension=e.target.value; changeDraft(); renderLibrary(); };
    $('detail-kind').onchange=e => { draft.model.kind=e.target.value; changeDraft(); renderLibrary(); };
    for(const [id,token] of [['insert-signal','{signal name}'],['insert-pin','{pin name}']])
        $(id).onclick=() => {
            const input=$('template-text'); if(input.disabled)
                return; input.setRangeText(token,input.selectionStart,input.selectionEnd,'end'); input.dispatchEvent(new Event('input')); input.focus();
        };
    $('example-pin').oninput=renderTemplatePreview;
    $('interface-search').oninput=() => state&&renderBindings();
    $('port-search').oninput=() => state&&renderPorts();
    $('board-search').oninput=() => state&&renderBoards();
    $('template-search').oninput=() => state&&renderPins();
    $('collapse-preview').onclick=() => $('export-preview').classList.toggle('hidden');
    $('copy-preview').onclick=() => { void navigator.clipboard?.writeText(state.preview).then(() => notice('Preview copied')); };
    $('match-names').onclick=() => {
        let count=0; for(const row of rows().filter(active).filter(r => !boundName(r))) {
            if(portValid(row,row.signal.id)) {
                post('bind',{ card: row.card,interface: row.iface,signal: row.signal.id,port: row.signal.id });
                count++;
            }
        } if(!count)
            notice('No additional exact matches. Drag a port to assign it.');
    };
    document.addEventListener('keydown',e => {
        if(e.key==='Escape') {
            $('bindings-page').classList.remove('interfaces-open');
            pickedPorts.clear();
            dragPorts=[];
            renderPorts();markTargets([]);
        } if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='s') {
            e.preventDefault();
            post(page==='library'? 'board-save':'bindings-save');
        } if(page==='library'&&(e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='z'&&!['INPUT','TEXTAREA'].includes(document.activeElement.tagName)) {
            e.preventDefault();
            post(e.shiftKey? 'board-redo':'board-undo');
        }
    });
    post('ready');
})();
