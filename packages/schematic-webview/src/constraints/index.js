/* Shared constraint workspace. Hosts send state and own all file operations. */
(() => {
    'use strict';
    const $=id => document.getElementById(id),esc=value => String(value??'').replace(/[&<>"']/g,c => ({ '&': '&amp;','<': '&lt;','>': '&gt;','"': '&quot;',"'": '&#39;' }[c]));
    const icon=name => '<svg aria-hidden="true"><use href="#i-'+name+'"/></svg>';
    const host=window.__boardEditorHost??(typeof acquireVsCodeApi==='function'? acquireVsCodeApi():undefined);
    let editId=0;
    const viewState=host?.getState?.()??{};
    const savedViews=new Map();
    let state,draft,page='library',section=viewState.section??'pins',pinName='',selectedKey='',dragPort='',pickedPort='',filter='all',toastTimer;
    const selectedPins=new Set(),expanded=new Set();
    const signalKey=(card,iface,signal) => JSON.stringify([card??'',iface,signal]);
    const post=(type,data={}) => { const snapshot=typeof structuredClone==='function'? structuredClone(data):JSON.parse(JSON.stringify(data)); host?.postMessage({ type,sourcePath:state?.source?.path,...snapshot }); };
    const notice=text => {
        if(!text)
            return; $('toast-text').textContent=text; $('toast').classList.add('show'); clearTimeout(toastTimer); toastTimer=setTimeout(() => $('toast').classList.remove('show'),2600);
    };
    document.querySelectorAll('[data-icon]').forEach(el => el.innerHTML=icon(el.dataset.icon));
    const basename=file => file?.split(/[\\/]/).pop()??'';
    const modelFor=card => state.models?.[card??''];
    const bindingsFor=row => (state.configuration?.bindings??[]).filter(b => b.source.card===row.card&&b.source.interface===row.iface&&members(row).includes(b.source.member));
    const members=row => row.signal.pins.length===1? [row.signal.id]:row.signal.pins.map((_,i) => row.signal.id+'.'+(row.signal.pins.length-1-i));
    const rows=() => state.interfaces.flatMap(iface => iface.signals.map(signal => ({ card: iface.card,iface: iface.id,signal,key: signalKey(iface.card,iface.id,signal.id) })));
    const current=() => rows().find(row => row.key===selectedKey)??rows()[0];
    const active=row => state.active.includes(row.key);
    const boundName=row => { const bs=bindingsFor(row); return bs.length===row.signal.pins.length&&new Set(bs.map(b => b.port.name)).size===1? bs[0]?.port.name:''; };
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
            $(p==='library'? 'library-context':'binding-context').classList.toggle('hidden',!shown);
            $(p==='library'? 'library-actions':'binding-actions').classList.toggle('hidden',!shown);
        } $('binding-empty').classList.toggle('hidden',page!=='bindings'||!!state.source); renderFooter();
    }
    function setSection(next) {
        section=next; host?.setState?.({ section }); for(const p of ['pins','interfaces','details']) {
            $('section-'+p).classList.toggle('hidden',p!==next);
            document.querySelector('[data-section="'+p+'"]').classList.toggle('active',p===next);
        }
    }
    function renderFooter() {
        const err=state.error; $('workbench-error').textContent=err; $('workbench-error').classList.toggle('hidden',!err); if(page==='library') {
            $('status').innerHTML='<span class="dot '+(state.dirty? '':'good')+'"></span><span>'+(state.dirty? 'Unsaved board changes':'Board library')+'</span>';
            $('footer-hint').textContent=state.issues[0]?.message??'Available to all projects';
        }
        else {
            $('status').innerHTML='<span class="dot '+(state.canExport? 'good':'')+'"></span><span>'+esc(state.diagnostics[0]?.message??(state.canExport? 'Ready to export':state.source? 'Select a board and assign signals':'Open a HDL / AD file'))+'</span>';
            $('footer-hint').textContent=state.source? (state.source.isAd? 'Saved in '+basename(state.source.path):'Bindings: '+basename(state.source.path).replace(/\.(v|sv)$/i,'.pins.json')):'';
            $('export').disabled=!state.canExport;
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
        $('board-subtitle').textContent=draft? draft.model.interfaces.length+' interfaces · '+Object.keys(draft.model.pins).length+' pin templates · '+draft.model.extension:'New board or Import board to get started';
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
        $('template-owner').textContent=pinUsage(pinName).join(', ')||'Not grouped';
        const card=draft.model.kind==='daughtercard';
        for(const id of ['insert-pin','guide-pin','example-pin-wrap'])
            $(id).classList.toggle('hidden',!card);
        $('guide-title').textContent=card? 'Daughtercard pin':'Board pin';
        $('guide-subtitle').textContent=card? 'Variable position, independent settings.':'Fixed location, replace the signal.';
        $('template-type').textContent=card? 'Position set in each design':'Fixed position';
        $('template-caption').textContent=card? 'Write the card’s complete constraint. The design supplies its signal and FPGA pin.':'Write the physical pin directly in this text. Only the signal name is replaced.';
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
        if(!draft)
            return; const text=draft.model.pins[pinName]??'',signal=$('example-signal').value,pin=$('example-pin').value; const rendered=text.replace(/\{signal name\}|\{pin name\}/g,t => t==='{signal name}'? signal:pin); $('template-preview').textContent=rendered; $('template-preview-label').textContent=signal+(draft.model.kind==='daughtercard'? ' · '+pin:'');
    }
    function field(value,change,type='text') { const el=document.createElement('input'); el.type=type; el.value=String(value); el.onchange=() => change(el.value); return el; }
    function action(label,fn) { const b=document.createElement('button'); b.className='subtle-link'; b.textContent=label; b.onclick=fn; return b; }
    function renderInterfaceEditors() {
        $('interface-editors').replaceChildren(); if(!draft)
            return; for(const [i,iface] of draft.model.interfaces.entries()) {
                const wrap=document.createElement('div');
                wrap.className='interface-editor';
                const heading=document.createElement('div');
                heading.className='iface-head';
                const name=field(iface.id,v => { iface.id=v; changeDraft(); });
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
                    const signalName=field(signal.id,v => { signal.id=v; changeDraft(); });
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
                    signal.pins.forEach((pin,k) => {
                        const select=document.createElement('select'); select.setAttribute('aria-label',iface.id+' '+signal.id+' bit '+(signal.pins.length-1-k)+' template'); select.add(new Option('Choose template','')); for(const name of Object.keys(draft.model.pins))
                            select.add(new Option(name,name)); select.value=pin; select.onchange=() => { signal.pins[k]=select.value; changeDraft(); }; pinsCell.append(select);
                    });
                    remove.append(action('×',() => { iface.signals.splice(j,1); changeDraft(); renderInterfaceEditors(); }));
                    row.append(nameCell,dirCell,widthCell,pinsCell,remove);
                    body.append(row);
                }
                table.append(body);
                const footer=document.createElement('div');
                footer.className='iface-footer';
                footer.append(action('+ Add signal',() => { iface.signals.push({ id: 'signal'+iface.signals.length,direction: 'input',pins: [''] }); changeDraft(); renderInterfaceEditors(); }));
                wrap.append(table,footer);
                $('interface-editors').append(wrap);
            }
    }
    function portValid(row,name) { const port=state.ports.find(p => p.name===name); return !!port&&!port.unresolved&&port.direction===row.signal.direction&&(port.indices?.length??1)===row.signal.pins.length&&!state.configuration.bindings.some(b => b.port.name===name&&!bindingsFor(row).includes(b)); }
    function markTargets(name) {
        for(const row of $('binding-rows').querySelectorAll('tr[data-key]')) {
            const data=rows().find(r => r.key===row.dataset.key);
            row.classList.toggle('drop-compatible',!!name&&portValid(data,name));
            row.classList.toggle('drop-incompatible',!!name&&!portValid(data,name));
            if(!name)
                row.classList.remove('drop-over');
        } $('drag-hint').textContent=name? 'Drop '+name+' onto a highlighted row.':'Drag a port to a signal, or select a port then click a row.';
    }
    function bind(row,name) {
        if(name&&!portValid(row,name)) {
            notice('Direction or width does not match, or this port is already assigned.');
            return;
        } pickedPort=''; dragPort=''; post('bind',{ card: row.card,interface: row.iface,signal: row.signal.id,port: name });
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
                box.checked=iface.signals.length>0&&iface.signals.every(s => state.active.includes(signalKey(card,iface.id,s.id)));
                box.indeterminate=!box.checked&&iface.signals.some(s => state.active.includes(signalKey(card,iface.id,s.id)));
                box.onchange=() => {
                    for(const s of iface.signals)
                        post('select',{ card,interface: iface.id,signal: s.id,checked: box.checked });
                };
                title.append(box,document.createTextNode(iface.id));
                group.append(title);
                for(const signal of iface.signals.filter(s => (iface.id+'.'+s.id).toLowerCase().includes($('interface-search').value.toLowerCase()))) {
                    const row=all.find(r => r.key===signalKey(card,iface.id,signal.id));
                    const label=document.createElement('label');
                    label.className='signal-item '+(row.key===selectedKey? 'selected':'');
                    const check=document.createElement('input');
                    check.type='checkbox';
                    check.checked=active(row);
                    check.onchange=() => post('select',{ card,interface: iface.id,signal: signal.id,checked: check.checked });
                    const button=document.createElement('button');
                    button.textContent=signal.id+(signal.pins.length>1? ' ['+(signal.pins.length-1)+':0]':'');
                    button.onclick=() => { selectedKey=row.key; renderBindings(); };
                    label.append(check,button);
                    group.append(label);
                }
                $('interfaces').append(group);
            }
        }
        $('binding-rows').replaceChildren();
        let total=0,ready=0;
        for(const row of all.filter(active)) {
            total++;
            const bs=bindingsFor(row),name=boundName(row),model=modelFor(row.card),needs=row.signal.pins.some(pin => model.pins[pin]?.includes('{pin name}')),complete=!!name&&(!needs||bs.every(b => b.pin?.trim()));
            if(complete)
                ready++;
            if(filter==='incomplete'&&complete)
                continue;
            const tr=document.createElement('tr');
            tr.dataset.key=row.key;
            tr.className=(row.key===selectedKey? 'current ':'')+(!complete? 'needs':'');
            const label=row.iface+'.'+row.signal.id;
            tr.innerHTML='<td class="row-select"><span class="signal-name">'+esc(label)+'</span><span class="binding-source-type">'+esc(labelFor(row.card))+'</span></td><td><span class="direction '+row.signal.direction+'">'+icon(row.signal.direction==='inout'? 'route':row.signal.direction)+' '+row.signal.direction+'</span><span class="width">'+row.signal.pins.length+'b</span></td><td><div class="port-dropzone '+(name? 'has-port':'empty-port')+'"><button class="port-drop-action" aria-label="Bind '+esc(labelFor(row.card)+' '+label)+'">'+icon(name? 'route':'plus')+'<span>'+esc(name||'Drop port here')+'</span></button>'+(name? '<button class="clear-binding" aria-label="Clear '+esc(label)+'">×</button>':'')+'</div></td><td class="physical-cell"></td><td class="statuscell">'+icon(complete? 'circle-check':'warning')+'</td>';
            tr.querySelector('.row-select').onclick=() => {
                selectedKey=row.key; if(row.signal.pins.length>1) {
                    expanded.has(row.key)? expanded.delete(row.key):expanded.add(row.key);
                } renderBindings();
            };
            tr.querySelector('.port-drop-action').onclick=() => {
                selectedKey=row.key; if(pickedPort)
                    bind(row,pickedPort);
                else {
                    renderBindings();
                    $('port-search').focus();
                }
            };
            tr.querySelector('.clear-binding')?.addEventListener('click',() => bind(row,''));
            const cell=tr.querySelector('.physical-cell');
            if(!row.card||!needs)
                cell.innerHTML='<span class="fixed-label">'+icon('code')+'Fixed in template</span>';
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
                if(!dragPort)
                    return; e.preventDefault(); const valid=portValid(row,dragPort); e.dataTransfer.dropEffect=valid? 'copy':'none'; tr.classList.toggle('drop-over',valid);
            };
            tr.ondragleave=e => {
                if(!tr.contains(e.relatedTarget))
                    tr.classList.remove('drop-over');
            };
            tr.ondrop=e => { e.preventDefault(); bind(row,e.dataTransfer.getData('text/plain')); };
            $('binding-rows').append(tr);
            if(expanded.has(row.key)&&row.signal.pins.length>1) {
                const detail=document.createElement('tr');
                detail.className='bus-expansion';
                const td=document.createElement('td');
                td.colSpan=5;
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
        $('progress-label').textContent=ready+' of '+total+' ready';
        $('progress-detail').textContent=state.ports.length+' ports';
        $('progress-track').style.width=(ready/Math.max(total,1)*100)+'%';
        $('selected-count').textContent=total;
        $('incomplete-count').textContent=total-ready;
        $('interface-count').textContent=state.interfaces.length;
        $('export-preview').textContent=state.preview;
        $('output-filename').textContent=basename(state.output);
        $('incomplete-note').textContent=state.diagnostics[0]?.message??'';
        const cards=state.configuration?.cards??[];
        $('card-count').textContent=cards.length+' added';
        $('card-instance').replaceChildren();
        $('card-instance').classList.toggle('hidden',!cards.length);
        cards.forEach(c => { const wrap=document.createElement('div'); wrap.innerHTML='<strong>'+esc(labelFor(c.id))+'</strong>'; wrap.append(action('Remove',() => post('remove-card',{ card: c.id }))); $('card-instance').append(wrap); });
        renderPorts();
        markTargets(pickedPort||dragPort);
    }
    function renderPorts() {
        const row=current();
        $('port-list').replaceChildren();
        const available=state.ports.filter(p => !state.configuration?.bindings.some(b => b.port.name===p.name));
        $('compatible-count').textContent=available.length+' free';
        for(const p of [...available,...state.ports.filter(p => !available.includes(p))].filter(p => p.name.toLowerCase().includes($('port-search').value.toLowerCase()))) {
            const used=state.configuration?.bindings.find(b => b.port.name===p.name),button=document.createElement('button');
            button.dataset.port=p.name;
            button.className='port-item '+(used||p.unresolved? 'used-port ':'')+(pickedPort===p.name? 'picked-port':'');
            button.draggable=!used&&!p.unresolved;
            button.style.width='100%';
            button.style.textAlign='left';
            button.setAttribute('aria-label','Port '+p.name);
            button.innerHTML=icon(used? 'check':'grip')+'<span><strong>'+esc(p.name+(p.indices? '['+p.indices.join(',')+']':''))+'</strong><small>'+esc(p.direction)+' · '+(p.indices?.length??1)+' bit'+(p.unresolved? ' · unresolved':'')+'</small></span>';
            button.onclick=() => {
                if(used) {
                    const target=rows().find(r => r.card===used.source.card&&r.iface===used.source.interface&&members(r).includes(used.source.member));
                    if(target)
                        selectedKey=target.key;
                    renderBindings();
                    return;
                } if(p.unresolved)
                    return; pickedPort=pickedPort===p.name? '':p.name; renderPorts(); markTargets(pickedPort);
            };
            button.ondragstart=e => { dragPort=p.name; pickedPort=''; e.dataTransfer.setData('text/plain',p.name); e.dataTransfer.effectAllowed='copy'; markTargets(dragPort); };
            button.ondragend=() => { dragPort=''; markTargets(pickedPort); };
            $('port-list').append(button);
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
    function receive(message) {
        const scroll={ library: document.querySelector('.library-main').scrollTop,main: document.querySelector('.main').scrollTop,inspector: document.querySelector('#port-browser').scrollTop }; const next=message?.data??message; if(next.type!=='state')
            return; if(state?.source?.path&&state.source.path!==next.source?.path) {
                savedViews.set(state.source.path,{ selectedKey });
                selectedKey='';
            } state=next; page=state.page; const focused=document.activeElement; const keep=next.reason==='board-change'&&draft?.id===next.draft?.id; if(!keep)
            draft=structuredClone(next.draft); if(!keep)
            renderLibrary();
        else {
            updateLibraryStatus();
            renderBoards();
        } renderBindings(); applyPage(); if(next.notice)
            notice(next.notice); if(keep&&focused?.isConnected)
            focused.focus(); document.querySelector('.library-main').scrollTop=scroll.library; document.querySelector('.main').scrollTop=scroll.main; document.querySelector('#port-browser').scrollTop=scroll.inspector;
    }
    host?.onMessage?.(receive);
    if(!host?.onMessage)
        window.addEventListener('message',receive);
    document.querySelectorAll('[data-page]').forEach(b => b.onclick=() => setPage(b.dataset.page));
    document.querySelectorAll('[data-section]').forEach(b => b.onclick=() => setSection(b.dataset.section));
    document.querySelectorAll('[data-filter]').forEach(b => b.onclick=() => { filter=b.dataset.filter; document.querySelectorAll('[data-filter]').forEach(x => x.classList.toggle('active',x===b)); renderBindings(); });
    $('theme').onclick=() => { document.documentElement.dataset.theme=document.documentElement.dataset.theme==='dark'? 'light':'dark'; };
    $('toggle-interfaces').onclick=() => $('bindings-page').classList.toggle('interfaces-open');
    $('close-interfaces').onclick=() => $('bindings-page').classList.remove('interfaces-open');
    $('board-context').onchange=e => post('choose-board',{ board: e.target.value });
    $('refresh-source').onclick=() => post('source-refresh');
    $('save-bindings-as').onclick=() => post('bindings-save',{ saveAs: true });
    $('load-bindings').onclick=() => post('bindings-load');
    $('open-file').onclick=() => post('source-open');
    $('new-board').onclick=() => $('new-board-dialog').showModal();
    $('confirm-new-board').onclick=() => {
        if(!$('new-name').value.trim()||!$('new-extension').value.trim())
            return; post('board-new',{ name: $('new-name').value,kind: $('new-kind').value,extension: $('new-extension').value }); $('new-board-dialog').close(); pinName=''; section='pins';
    };
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
    for(const id of ['example-signal','example-pin'])
        $(id).oninput=renderTemplatePreview;
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
            pickedPort='';
            dragPort='';
            markTargets('');
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
