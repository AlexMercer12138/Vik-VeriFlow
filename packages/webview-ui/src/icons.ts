import { createElement, icons, type IconNode } from 'lucide';

export function renderIcon(name: string): SVGElement {
    const key = name.split(/[-_\s]/).map(part => part.charAt(0).toUpperCase() + part.slice(1)).join('');
    const icon = (icons as Record<string, IconNode>)[key];
    if (!icon) throw new Error(`Unknown Lucide icon: ${name}`);
    return createElement(icon, { width: 16, height: 16, 'aria-hidden': 'true' });
}
