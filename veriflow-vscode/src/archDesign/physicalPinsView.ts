import { randomBytes } from 'crypto';

export function physicalPinsHtml(): string {
    const nonce = randomBytes(18).toString('hex');
    return String.raw`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';"><style>
    *{box-sizing:border-box}html,body{height:100%;margin:0}body{font:13px var(--vscode-font-family,Segoe UI,sans-serif);color:var(--vscode-foreground,#ccc);background:var(--vscode-editor-background,#1f1f1f);padding:18px;display:flex;flex-direction:column;gap:12px}
    select,button{font:inherit;color:var(--vscode-input-foreground,#ddd);background:var(--vscode-input-background,#313131);border:1px solid var(--vscode-input-border,#555);padding:6px;border-radius:3px}button{cursor:pointer}button:disabled{cursor:default;opacity:.5}h1{font-size:20px;margin:0}h2{font-size:14px;margin:0}h3{font-size:13px;margin:12px 0 6px}p{margin:0}small,.hint{color:var(--vscode-descriptionForeground,#999);font-size:12px}header{display:flex;align-items:center;gap:12px;flex-wrap:wrap}#board{min-width:200px;max-width:400px;flex:1}.settings{display:flex;gap:12px;flex-wrap:wrap}.settings label{font-size:12px}.settings select{margin-left:5px}.columns{display:grid;grid-template-columns:minmax(225px,1fr) minmax(310px,1.4fr) minmax(225px,1fr);gap:12px;flex:1;min-height:220px;overflow:auto}.column{border:1px solid var(--vscode-panel-border,#414141);border-radius:5px;display:flex;flex-direction:column;min-height:0;overflow:hidden}.column-head{padding:12px;border-bottom:1px solid var(--vscode-panel-border,#414141)}.column-head p{margin-top:5px}.column-content{padding:10px;overflow:auto;flex:1}.interface{border-bottom:1px solid var(--vscode-panel-border,#414141);padding:7px 0}.interface summary{cursor:pointer}.interface summary label{display:inline-flex;align-items:center;gap:6px}.choices{padding:5px 2px 5px 14px}.choice{display:flex;align-items:center;gap:6px;min-height:27px}.choice.blocked{color:var(--vscode-disabledForeground,#777)}.choice input{accent-color:var(--vscode-focusBorder,#007acc)}.group{font-weight:600}.members{display:grid;grid-template-columns:repeat(auto-fit,minmax(100px,1fr));gap:0 6px}.port,.signal{padding:10px;border:1px solid var(--vscode-panel-border,#414141);border-radius:4px;margin-bottom:7px}.port[draggable=true]{cursor:grab}.port.selected,.signal.drag-over{border-color:var(--vscode-focusBorder,#007acc);background:var(--vscode-list-hoverBackground,#2a2d2e)}.port.bound{border-left:3px solid var(--vscode-textLink-foreground,#4daafc)}.signal{border-style:dashed}.signal.bound{border-style:solid}.signal-title{display:flex;justify-content:space-between;gap:6px;align-items:center}.signal select{width:100%;min-width:0;font-size:12px;padding:4px}.signal{padding:8px;margin-bottom:6px}.signal-controls{display:grid;grid-template-columns:minmax(0,1.2fr) minmax(0,1fr);gap:7px;margin-top:6px}.signal-info{font-size:12px;line-height:18px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.fixed-voltage{display:inline-flex;align-items:center;font-size:12px;color:var(--vscode-descriptionForeground,#999)}.signal-actions{display:flex;gap:6px;align-items:center;margin-top:8px}.signal-actions button{font-size:12px;padding:3px 7px}.signal small,.port small{display:block;margin-top:4px;overflow-wrap:anywhere}.mapped{color:var(--vscode-textLink-foreground,#4daafc)}.empty{padding:15px 5px;line-height:1.7}.error{color:var(--vscode-errorForeground,#f48771);white-space:pre-line}#diagnostics{font-size:12px;max-height:110px;overflow:auto}#diagnostics ul{padding-left:20px;margin:6px 0}footer{display:flex;align-items:center;justify-content:space-between;gap:12px}.primary{background:var(--vscode-button-background,#007acc);color:var(--vscode-button-foreground,#fff);border-color:transparent;padding:8px 16px}#notice{color:var(--vscode-testing-iconPassed,#73c991)}#output{overflow-wrap:anywhere}
    </style></head><body>
    <header><h1>Pin Constraints</h1><select id="board" aria-label="Board"></select><button id="library">Manage Boards…</button><button id="import">Import board JSON…</button></header>
    <p id="mode" class="hint"></p><div id="settings" class="settings"></div><p id="error" role="alert" class="error"></p>
    <main class="columns"><section class="column"><div class="column-head"><h2>1. Select interfaces</h2><p class="hint">Select signals first. Conflicting pins and required groups are locked automatically.</p></div><div id="interfaces" class="column-content"></div></section>
    <section class="column"><div class="column-head"><h2>2. Assign ports</h2><p class="hint">Drag a port here or use the dropdown. Choose an IO standard at the selected Bank voltage.</p></div><div id="assignments" class="column-content"></div></section>
    <section class="column"><div class="column-head"><h2>3. Top-level ports</h2><p class="hint">Drag a port left. Clear its assignment using the empty port dropdown option.</p></div><div id="ports" class="column-content"></div></section></main>
    <details id="diagnostics"><summary id="issue-count"></summary><ul id="issues"></ul></details>
    <footer><div><small id="output"></small><p id="notice" role="status"></p></div><button id="confirm" class="primary">Confirm &amp; Generate XDC</button></footer>
    <script nonce="${nonce}">
    const vscode=acquireVsCodeApi(),el=id=>document.getElementById(id);let state;
    function post(type,data={}){el('error').textContent='';document.body.dataset.pending='true';document.querySelectorAll('select,button,input').forEach(c=>c.disabled=true);vscode.postMessage({type,revision:state?.revision,...data});}
    function option(value,text){const o=document.createElement('option');o.value=value;o.textContent=text;return o;}
    const expand=(def,signal)=>def.bus?.[signal]===undefined?[signal]:Array.from({length:def.bus[signal]},(_,i)=>signal+'.'+(def.bus[signal]-1-i));
    const signalLabel=(def,signal)=>def.bus?.[signal]===undefined?signal.replace(/\.(\d+)$/, '[$1]'):signal+'['+(def.bus[signal]-1)+':0]';
    const pairedMembers=def=>(def.kind==='fixed'?def.differentialPairs??[]:[]).flatMap(p=>expand(def,p.positive).map((positive,i)=>({positive,negative:expand(def,p.negative)[i]})));
    function slots(def,members){
        const entries=def.signals.flatMap(signal=>{const bits=expand(def,signal);return bits.every(m=>members.includes(m))?[{signal,bits}]:bits.filter(m=>members.includes(m)).map(m=>({signal:m,bits:[m]}));});
        const covered=new Set(),pairs=pairedMembers(def),result=[];
        for(const entry of entries){
            if(covered.has(entry.signal))continue;
            const partners=entry.bits.map(m=>pairs.find(p=>p.positive===m)?.negative??pairs.find(p=>p.negative===m)?.positive);
            const mate=partners.every(Boolean)?entries.find(e=>JSON.stringify(e.bits)===JSON.stringify(partners)):undefined;
            let primary=entry,secondary=mate;
            if(mate&&pairs.some(p=>p.negative===entry.bits[0])){primary=mate;secondary=entry;}
            covered.add(entry.signal);if(mate)covered.add(mate.signal);
            result.push({...primary,allBits:secondary?[...primary.bits,...secondary.bits]:primary.bits,label:signalLabel(def,primary.signal)+(secondary?' / '+signalLabel(def,secondary.signal):'')});
        }
        return result;
    }
    const selected=iface=>state.configuration.selections?.find(s=>s.interface===iface)?.members??(state.configuration.selections===undefined?state.configuration.bindings.filter(b=>b.source.interface===iface).map(b=>b.source.member):[]);
    function settings(){const railVoltages=[];el('settings').querySelectorAll('select').forEach(s=>{if(s.value)railVoltages.push({rail:s.dataset.rail,millivolts:Number(s.value)});});post('settings',{railVoltages});}
    function choice(iface,members,label,reason,group){const row=document.createElement('label');row.className='choice'+(reason?' blocked':'')+(group?' group':'');row.title=reason||label;const box=document.createElement('input');box.type='checkbox';box.setAttribute('aria-label',label);const count=members.filter(m=>selected(iface).includes(m)).length;box.checked=count===members.length;box.indeterminate=count>0&&count<members.length;box.disabled=!!reason&&!box.checked;box.onclick=e=>e.stopPropagation();box.onchange=()=>post('select',{interface:iface,members,checked:box.checked});row.onclick=e=>e.stopPropagation();row.append(box,document.createTextNode(label.startsWith(iface+' / ')?label.slice(iface.length+3):label));return row;}
    function render(){
        const positions=Object.fromEntries(['interfaces','assignments','ports'].map(id=>[id,el(id).scrollTop]));const expanded=new Map([...el('interfaces').querySelectorAll('details')].map(d=>[d.dataset.iface??d.dataset.slot,d.open]));
        document.body.dataset.pending='false';document.querySelectorAll('select,button,input').forEach(c=>c.disabled=false);el('confirm').disabled=!state.canConfirm;el('mode').textContent=state.isAd?'Choose a saved user board → select signals → assign ports → confirm. Confirmation saves the bindings inside this AD file.':'Choose a saved user board → select signals → assign ports → confirm. Bindings stay in this panel; confirmation asks where to save the XDC.';
        el('board').replaceChildren(option('','Choose a saved board'),...state.choices.map(c=>option(c.reference,c.label)));el('board').value=state.configuration.board;
        el('output').textContent=state.isAd?'Output: '+state.output:'Choose output filename and location on confirmation';el('notice').textContent=state.notice||'';
        el('issues').replaceChildren();for(const issue of state.issues.slice(0,12)){const li=document.createElement('li');li.textContent=issue.message;li.className=issue.severity==='error'?'error':'';el('issues').append(li);}if(state.issues.length>12){const li=document.createElement('li');li.textContent='… '+(state.issues.length-12)+' more';el('issues').append(li);}el('issue-count').textContent=state.issues.length+' issue(s)';el('diagnostics').hidden=!state.issues.length;
        el('settings').replaceChildren();for(const rail of state.board?.rails??[]){
            const banks=state.board.banks.filter(b=>b.supplyRail===rail.id).map(b=>b.id).join('/');
            const label=document.createElement('label');label.textContent='Bank '+banks;label.title=rail.id;
            if(Array.isArray(rail.millivolts)){const select=document.createElement('select');select.dataset.rail=rail.id;select.setAttribute('aria-label','Bank '+banks+' voltage');select.append(option('','Select Bank voltage'),...rail.millivolts.map(v=>option(String(v),(v/1000)+' V')));select.value=String(state.configuration.railVoltages?.find(v=>v.rail===rail.id)?.millivolts??'');select.onchange=settings;label.append(select);}
            else{label.className='fixed-voltage';label.textContent+=' · '+(rail.millivolts===undefined?'Voltage unknown':rail.millivolts/1000+' V');}
            el('settings').append(label);
        }
        el('interfaces').replaceChildren();for(const [iface,def] of Object.entries(state.interfaces??{})){const availability=state.availability[iface],detail=document.createElement('details');detail.className='interface';detail.dataset.iface=iface;detail.open=expanded.get(iface)??false;const summary=document.createElement('summary');summary.append(choice(iface,def.members,iface,availability.interface,true));detail.append(summary);const body=document.createElement('div');body.className='choices';for(const group of def.groups??[])body.append(choice(iface,[...new Set(group.members.flatMap(m=>expand(def,m)))],iface+' / '+group.id,availability.groups[group.id],true));const members=document.createElement('div');members.className='members';for(const slot of slots(def,def.members)){
            const checkbox=choice(iface,slot.allBits,iface+' / '+slot.label,slot.allBits.map(m=>availability.members[m]).find(Boolean),false);
            if(def.bus?.[slot.signal]!==undefined){const bus=document.createElement('details');bus.dataset.slot=iface+' / '+slot.signal;bus.open=expanded.get(bus.dataset.slot)??false;bus.style.gridColumn='1 / -1';const title=document.createElement('summary');title.append(checkbox);bus.append(title);const bits=document.createElement('div');bits.className='members';for(const member of slot.bits){const pair=pairedMembers(def).find(p=>p.positive===member||p.negative===member);const selectedBits=pair?[pair.positive,pair.negative]:[member];const label=selectedBits.map(m=>signalLabel(def,m)).join(' / ');bits.append(choice(iface,selectedBits,iface+' / '+label,selectedBits.map(m=>availability.members[m]).find(Boolean),false));}bus.append(bits);members.append(bus);}else members.append(checkbox);
        }body.append(members);detail.append(body);el('interfaces').append(detail);}
        if(!state.choices.length&&!state.board){const hint=document.createElement('p');hint.className='empty hint';hint.textContent='No saved boards. Use Import board to save a board and its interface definitions in your user configuration.';el('interfaces').append(hint);}
        el('assignments').replaceChildren();let assignmentCount=0;for(const [iface,def] of Object.entries(state.interfaces??{})){const members=selected(iface);if(!members.length)continue;const heading=document.createElement('h3');heading.textContent=iface;el('assignments').append(heading);for(const slot of slots(def,members)){
            assignmentCount++;
            const {signal,bits,allBits}=slot,bindings=state.configuration.bindings.filter(b=>b.source.interface===iface&&bits.includes(b.source.member)),row=document.createElement('div');
            row.className='signal'+(bindings.length===bits.length?' bound':'');row.dataset.iface=iface;row.dataset.signal=signal;
            const info=document.createElement('div');info.className='signal-info';
            const pins=state.board.routes.filter(r=>r.interface===iface&&allBits.includes(r.member)).map(r=>{const pin=state.board.fpgaPins.find(p=>p.id===r.pin);return r.pin+(pin?.bank?' / B'+pin.bank:'');}).join(', ');
            info.textContent=slot.label+' · '+pins;info.title=info.textContent;row.append(info);
            const controls=document.createElement('div');controls.className='signal-controls';
            const port=document.createElement('select');port.dataset.portSelect='';port.setAttribute('aria-label',iface+' / '+signal+' port');
            const leg=pairedMembers(def).some(p=>p.negative===bits[0])?/_n$/:/_p$/;
            port.append(option('','— Unassigned —'),...state.ports.filter(p=>!p.unresolved&&(!p.indices?1:p.indices.length)===bits.length&&(allBits.length===bits.length||leg.test(p.name))).map(p=>option(p.name,p.name+(p.indices?' ['+p.indices[0]+':'+p.indices[p.indices.length-1]+']':''))));
            port.value=bindings.length===bits.length&&new Set(bindings.map(b=>b.port.name)).size===1?bindings[0].port.name:'';
            if(bindings.length&&!port.value){const stale=option('__existing__',bindings.map(b=>b.port.name).join(', ')+' (partial / missing)');stale.disabled=true;port.append(stale);port.value=stale.value;}
            port.onchange=()=>post('bind',{interface:iface,signal,port:port.value});controls.append(port);
            const standard=document.createElement('select');standard.dataset.standard='';standard.setAttribute('aria-label',iface+' / '+signal+' IO standard');
            const options=(state.ioOptions[iface][bits[0]]??[]).filter(o=>allBits.every(m=>(state.ioOptions[iface][m]??[]).some(x=>x.name===o.name)));
            standard.append(option('','— IO standard —'),...options.map(o=>{const value=option(o.name,o.name+(o.millivolts?' · '+o.millivolts/1000+' V':''));value.title=o.description||'';return value;}));
            const configured=allBits.map(m=>state.configuration.ioStandards?.find(e=>e.interface===iface&&e.member===m)?.standard);
            if(configured.every(v=>v===configured[0])&&configured[0]){
                if(!options.some(o=>o.name===configured[0])){const invalid=option(configured[0],configured[0]+' (unavailable)');invalid.disabled=true;standard.append(invalid);}
                standard.value=configured[0];
            }
            standard.title=options.length?'IO standards allowed by the device, Bank voltage and signal type':'Select a supported Bank voltage above';
            standard.onchange=()=>post('standard',{interface:iface,members:allBits,standard:standard.value});controls.append(standard);row.append(controls);
            row.ondragover=e=>{e.preventDefault();row.classList.add('drag-over');};row.ondragleave=()=>row.classList.remove('drag-over');
            row.ondrop=e=>{e.preventDefault();post('bind',{interface:iface,signal,port:e.dataTransfer.getData('text/plain')});};
            el('assignments').append(row);
        }}
        if(!assignmentCount){const hint=document.createElement('p');hint.className='empty hint';hint.textContent='Select an interface, group or signal on the left. Its assignment slots will appear here.';el('assignments').append(hint);}
        el('ports').replaceChildren();
        const missing=[...new Set(state.configuration.bindings.map(b=>b.port.name))].filter(n=>!state.ports.some(p=>p.name===n)).map(name=>({name,direction:'missing',unresolved:true}));
        for(const p of [...state.ports,...missing]){
            const bindings=state.configuration.bindings.filter(b=>b.port.name===p.name),item=document.createElement('div');
            item.className='port'+(bindings.length?' bound':'');item.dataset.port=p.name;item.draggable=!p.unresolved;
            const name=document.createElement('strong');name.textContent=p.name+(p.indices?' ['+p.indices[0]+':'+p.indices[p.indices.length-1]+']':'');item.append(name);
            const info=document.createElement('small');info.textContent=p.direction+(p.unresolved?' · unresolved range':'')+(bindings.length?' · '+bindings.length+' bound':'');item.append(info);
            item.ondragstart=e=>e.dataTransfer.setData('text/plain',p.name);
            if(bindings.length){const mapped=document.createElement('small');mapped.className='mapped';const targets=[];for(const [iface,def] of Object.entries(state.interfaces??{}))for(const signal of def.signals){const bits=expand(def,signal),used=bits.filter(m=>bindings.some(b=>b.source.interface===iface&&b.source.member===m));if(used.length===bits.length)targets.push(iface+'.'+signalLabel(def,signal));else targets.push(...used.map(m=>iface+'.'+signalLabel(def,m)));}mapped.textContent=targets.join(', ');item.append(mapped);}
            el('ports').append(item);
        }
        for(const [id,position] of Object.entries(positions))el(id).scrollTop=position;
    }
    window.addEventListener('message',e=>{if(e.data.type==='state'){state=e.data;render();}else if(e.data.type==='error'){document.body.dataset.pending='false';el('error').textContent=e.data.message;}});
    el('board').onchange=()=>post('board',{reference:el('board').value});el('import').onclick=()=>post('import');el('library').onclick=()=>post('library');el('confirm').onclick=()=>post('confirm');post('ready');
    </script></body></html>`;
}
