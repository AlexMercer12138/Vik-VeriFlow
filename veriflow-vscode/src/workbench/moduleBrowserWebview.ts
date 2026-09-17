import { filterModuleBrowserTree } from './moduleBrowserFilter';

/** A separate scroll surface keeps the filter visible even in short sidebar views. */
export function moduleBrowserHtml(nonce: string): string {
    return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
<style nonce="${nonce}">
*{box-sizing:border-box}html,body{height:100%;margin:0;overflow:hidden}body{display:flex;flex-direction:column;color:var(--vscode-foreground);background:var(--vscode-sideBar-background);font-family:var(--vscode-font-family, sans-serif);font-size:var(--vscode-font-size,13px)}
.filter-bar{flex:none;padding:6px 10px 7px;background:var(--vscode-sideBar-background)}input{width:100%;height:26px;padding:3px 7px;border:1px solid var(--vscode-input-border,transparent);border-radius:2px;background:var(--vscode-input-background);color:var(--vscode-input-foreground);font:inherit;outline:none}input:focus{border-color:var(--vscode-focusBorder)}input::placeholder{color:var(--vscode-input-placeholderForeground)}
#tree-scroll{flex:1;min-height:0;overflow:auto}#tree{padding:0 0 8px;outline:none}.row{display:flex;align-items:center;gap:5px;min-height:22px;padding-right:8px;white-space:nowrap;cursor:default;user-select:none;outline:none}.row:hover{background:var(--vscode-list-hoverBackground);color:var(--vscode-list-hoverForeground)}.row[aria-selected=true]{background:var(--vscode-list-inactiveSelectionBackground);color:var(--vscode-list-inactiveSelectionForeground)}#tree:focus-within .row[aria-selected=true]{background:var(--vscode-list-activeSelectionBackground);color:var(--vscode-list-activeSelectionForeground)}.row:focus{outline:1px solid var(--vscode-focusBorder);outline-offset:-1px}.label{overflow:hidden;text-overflow:ellipsis}.twisty{width:12px;height:16px;flex:none;display:grid;place-items:center}.twisty::before{content:'';width:5px;height:5px;border-right:1px solid currentColor;border-bottom:1px solid currentColor;transform:rotate(-45deg)}[aria-expanded=true]>.twisty::before{transform:rotate(45deg)}[data-kind=module]>.twisty::before{display:none}.icon{width:14px;height:12px;flex:none;position:relative}.folder{border:1px solid currentColor;border-radius:1px;height:10px;opacity:.85}.folder::before{content:'';position:absolute;left:0;top:-4px;width:6px;height:3px;border:1px solid currentColor;border-bottom:0}.module{color:var(--vscode-symbolIcon-moduleForeground,var(--vscode-foreground));border:1px solid currentColor;width:11px;height:11px;margin-right:3px}.module::before{content:'';position:absolute;inset:2px;border:1px solid currentColor}#empty{padding:9px 14px;color:var(--vscode-descriptionForeground)}.sr-only{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%)}
.description{margin-left:3px;font-size:.9em;opacity:.7;overflow:hidden;text-overflow:ellipsis}
</style></head><body data-vscode-context='{"webviewSection":"moduleBrowser","preventDefaultContextMenuItems":true}'>
<div class="filter-bar"><label class="sr-only" for="filter">Filter modules</label><input id="filter" type="text" placeholder="Filter modules" autocomplete="off" spellcheck="false" aria-controls="tree"></div>
<div id="tree-scroll"><div id="tree" role="tree" aria-label="HDL modules" aria-multiselectable="true"></div><div id="empty" role="status">Scanning modules…</div></div>
<script nonce="${nonce}">
const filterTree = ${filterModuleBrowserTree.toString()};
const vscode = acquireVsCodeApi();
const saved = vscode.getState() || {};
const input = document.getElementById('filter');
const tree = document.getElementById('tree');
const empty = document.getElementById('empty');
let roots = [], visible = [], selected = new Set(), focused, anchor;
const collapsed = new Set(Array.isArray(saved.collapsed) ? saved.collapsed : []);
const expandedDirectories = new Set(Array.isArray(saved.expanded) ? saved.expanded : []);
input.value = typeof saved.filter === 'string' ? saved.filter : '';
function save() { vscode.setState({ filter: input.value, collapsed: [...collapsed], expanded: [...expandedDirectories] }); }
function selectedKeys() { return visible.filter(entry => entry.node.kind === 'module' && selected.has(entry.node.id)).map(entry => entry.node.moduleKey); }
function updateSelection() {
    const keys = selectedKeys();
    for (const entry of visible) {
        const row = entry.row, node = entry.node;
        row.setAttribute('aria-selected', String(selected.has(node.id)));
        row.tabIndex = node.id === focused ? 0 : -1;
        if (node.kind === 'module') row.dataset.vscodeContext = JSON.stringify({ webviewSection: 'hdlModule', moduleKey: node.moduleKey,
            moduleKeys: selected.has(node.id) ? keys : [node.moduleKey], preventDefaultContextMenuItems: true });
    }
}
function focusRow(id) {
    focused = id; updateSelection();
    const entry = visible.find(entry => entry.node.id === id);
    if (entry) { entry.row.focus({ preventScroll: true }); entry.row.scrollIntoView({ block: 'nearest' }); }
}
function select(entry, event) {
    const id = entry.node.id;
    if (event.shiftKey && anchor && visible.some(value => value.node.id === anchor)) {
        const a = visible.findIndex(value => value.node.id === anchor), b = visible.indexOf(entry);
        if (!event.ctrlKey && !event.metaKey) selected.clear();
        for (const value of visible.slice(Math.min(a,b),Math.max(a,b)+1)) if (value.node.kind === 'module') selected.add(value.node.id);
    } else if (event.ctrlKey || event.metaKey) {
        if (selected.has(id)) selected.delete(id); else selected.add(id);
        anchor = id;
    } else { selected = new Set([id]); anchor = id; }
    focusRow(id);
}
function toggle(entry, expand) {
    if (entry.node.kind === 'module' || input.value.trim()) return;
    if (expand) { collapsed.delete(entry.node.id); expandedDirectories.add(entry.node.id); }
    else { collapsed.add(entry.node.id); expandedDirectories.delete(entry.node.id); }
    save(); render(); focusRow(entry.node.id);
}
function open(entry) { if (entry.node.kind === 'module') vscode.postMessage({ type: 'open', moduleKey: entry.node.moduleKey }); }
function render() {
    const hadFocus = tree.contains(document.activeElement);
    const scroll = document.getElementById('tree-scroll'), top = scroll.scrollTop;
    tree.replaceChildren(); visible = [];
    function append(nodes, depth, parent) {
        nodes.forEach((node,index) => {
            const row = document.createElement('div');
            row.className = 'row'; row.dataset.kind = node.kind; row.style.paddingLeft = (8 + depth * 14) + 'px';
            row.setAttribute('role','treeitem'); row.setAttribute('aria-level',String(depth+1));
            row.setAttribute('aria-setsize',String(nodes.length)); row.setAttribute('aria-posinset',String(index+1));
            row.setAttribute('aria-label',node.label); row.title = node.tooltip || node.label;
            const expanded = !!input.value.trim() || (node.kind === 'root' ? !collapsed.has(node.id) : expandedDirectories.has(node.id));
            if (node.kind !== 'module') row.setAttribute('aria-expanded',String(expanded));
            const twisty = document.createElement('span'); twisty.className = 'twisty'; twisty.setAttribute('aria-hidden','true');
            const icon = document.createElement('span'); icon.className = 'icon ' + (node.kind === 'module' ? 'module' : 'folder'); icon.setAttribute('aria-hidden','true');
            const label = document.createElement('span'); label.className = 'label'; label.textContent = node.label;
            row.append(twisty,icon,label);
            if (node.description) { const description = document.createElement('span'); description.className = 'description'; description.textContent = node.description; row.append(description); }
            tree.append(row);
            const entry = { node, row, parent, expanded }; visible.push(entry);
            row.addEventListener('click',event => {
                select(entry,event);
                if (node.kind !== 'module') toggle(entry,!expanded);
                else if (!event.ctrlKey && !event.metaKey && !event.shiftKey) open(entry);
            });
            row.addEventListener('contextmenu',() => { if (!selected.has(node.id)) selected = new Set([node.id]); focused = node.id; anchor = node.id; updateSelection(); });
            row.addEventListener('keydown',event => keydown(event,entry));
            if (node.kind !== 'module' && expanded) append(node.children || [],depth+1,node.id);
        });
    }
    append(filterTree(roots,input.value),0,undefined);
    selected = new Set([...selected].filter(id => visible.some(entry => entry.node.id === id)));
    if (!visible.some(entry => entry.node.id === focused)) focused = visible[0]?.node.id;
    empty.hidden = visible.length > 0;
    empty.textContent = input.value.trim() ? 'No matching modules' : 'No modules found. Scan the workspace or add a library directory.';
    updateSelection(); scroll.scrollTop = top;
    if (hadFocus && focused) focusRow(focused);
}
function keydown(event,entry) {
    const index = visible.indexOf(entry); let next;
    if (event.key === 'ArrowDown') next = visible[Math.min(index+1,visible.length-1)];
    else if (event.key === 'ArrowUp') next = visible[Math.max(index-1,0)];
    else if (event.key === 'Home') next = visible[0];
    else if (event.key === 'End') next = visible[visible.length-1];
    else if (event.key === 'ArrowRight' && entry.node.kind !== 'module') { if (!entry.expanded) toggle(entry,true); else next = visible[index+1]?.parent === entry.node.id ? visible[index+1] : undefined; }
    else if (event.key === 'ArrowLeft') { if (entry.node.kind !== 'module' && entry.expanded && !input.value.trim()) toggle(entry,false); else next = visible.find(value => value.node.id === entry.parent); }
    else if (event.key === 'Enter') { if (entry.node.kind === 'module') open(entry); else toggle(entry,!entry.expanded); }
    else if (event.key === ' ') select(entry,event);
    else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a') { selected = new Set(visible.filter(value => value.node.kind === 'module').map(value => value.node.id)); updateSelection(); }
    else if (event.key === 'Escape') input.focus();
    else return;
    event.preventDefault();
    if (next) { if (event.shiftKey) select(next,event); else focusRow(next.node.id); }
}
input.addEventListener('input',() => { save(); render(); });
input.addEventListener('keydown',event => {
    if (event.key === 'ArrowDown' && visible.length) { event.preventDefault(); focusRow(visible[0].node.id); }
    if (event.key === 'Escape' && input.value) { input.value = ''; save(); render(); }
});
window.addEventListener('message',event => {
    if (event.data?.type === 'modules' && Array.isArray(event.data.roots)) { roots = event.data.roots; render(); }
    if (event.data?.type === 'error') { empty.hidden = false; empty.textContent = event.data.message; }
});
vscode.postMessage({ type: 'ready' });
</script></body></html>`;
}
