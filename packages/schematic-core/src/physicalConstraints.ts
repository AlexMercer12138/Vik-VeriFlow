/** Raw constraint text is parsed only to locate literal port and pin references. Tcl is never evaluated. */
export type ConstraintCommand = {
    text: string;
    ports?: {
        start: number;
        end: number;
        names: string[];
        quoting: 'braced' | 'quoted' | 'bare';
    };
    pin?: {
        start: number;
        end: number;
        name: string;
    };
    anchors: string[];
    error?: string;
};
function commands(text: string): string[] {
    const result: string[] = [];
    let start = 0, braces = 0, brackets = 0, quoted = false, comment = false, beginning = true;
    for (let i = 0; i < text.length; i++) {
        const c = text[i];
        if (c === '\\') {
            if (text[i + 1] === '\r' && text[i + 2] === '\n')
                i += 2;
            else
                i++;
            continue;
        }
        if (!comment) {
            if (beginning && c === '#')
                comment = true;
            if (!/\s/.test(c))
                beginning = false;
            if (c === '"' && braces === 0)
                quoted = !quoted;
            if (!quoted) {
                if (c === '{')
                    braces++;
                if (c === '}')
                    braces--;
            }
            if (!quoted && braces === 0) {
                if (c === '[')
                    brackets++;
                if (c === ']')
                    brackets--;
            }
        }
        if ((c === '\n' || c === '\r' || (!comment && c === ';')) && braces === 0 && brackets === 0 && !quoted) {
            if (c === '\r' && text[i + 1] === '\n')
                i++;
            result.push(text.slice(start, i + 1));
            start = i + 1;
            comment = false;
            beginning = true;
        }
    }
    if (start < text.length)
        result.push(text.slice(start));
    return result;
}
export function parseConstraintCommands(text: string, extension: string): ConstraintCommand[] {
    return commands(text).map(text => {
        const item: ConstraintCommand = { text, anchors: [] };
        if (/^\s*#/.test(text))
            return item;
        item.anchors = [...new Set([...text.matchAll(/\{\{(?:PORT|PIN):([^}]+)\}\}/g)].map(m => m[1]))];
        if (extension.toLowerCase() !== '.xdc' || item.anchors.length)
            return item;
        const get = /\[\s*get_ports\b/.exec(text);
        if (!get)
            return item;
        if ([...text.matchAll(/\[\s*get_ports\b/g)].length > 1) {
            item.error = 'Multiple get_ports queries in one command require explicit port anchors';
            return item;
        }
        const rest = text.slice(get.index);
        const match = /^\[\s*get_ports\s+(?:(?:-quiet|-verbose)\s+)*(?:\{([^{}]*)\}|"([^"$\\]*)"|([^\s\]$\\]+))\s*\]/.exec(rest);
        if (!match) {
            item.error = 'Use literal get_ports targets; dynamic Tcl requires manual port anchors';
            return item;
        }
        const target = match[1] ?? match[2] ?? match[3];
        const names = target.trim().split(/\s+/);
        if (names.some(n => !/^[A-Za-z_][A-Za-z0-9_$]*(?:\[-?\d+\])?$/.test(n))) {
            item.error = 'Use literal get_ports targets; wildcard or dynamic targets require explicit port anchors';
            return item;
        }
        const offset = match[0].indexOf(target, match[0].indexOf('get_ports') + 9);
        item.ports = { start: get.index + offset, end: get.index + offset + target.length, names,
            quoting: match[1] !== undefined ? 'braced' : match[2] !== undefined ? 'quoted' : 'bare' };
        const pin = /\b(?:PACKAGE_PIN|LOC)\s+(?:\{([A-Za-z0-9_.:-]+)\}|([A-Za-z0-9_.:-]+))/.exec(text.slice(0, get.index));
        if (pin) {
            const name = pin[1] ?? pin[2];
            const start = pin.index + pin[0].lastIndexOf(name);
            item.pin = { name, start, end: start + name.length };
        }
        return item;
    });
}
export function constraintPinNames(text: string, extension: string): string[] {
    return [...new Set(parseConstraintCommands(text, extension).flatMap(c => [...c.anchors, ...(c.pin ? [c.pin.name] : [])]))];
}
export function renderConstraintText(text: string, extension: string, targets: ReadonlyMap<string, {
    port: string;
    pin: string;
}>): {
    text?: string;
    errors: string[];
} {
    const parsed = parseConstraintCommands(text, extension), errors: string[] = [];
    const originalPins = new Map<string, string>();
    for (const c of parsed)
        if (c.pin && c.ports) {
            if (c.ports.names.length !== 1)
                errors.push('A package pin must target exactly one literal port');
            for (const name of c.ports.names) {
                if (originalPins.has(name) && originalPins.get(name) !== c.pin.name)
                    errors.push('Ambiguous pin assignment: ' + name);
                originalPins.set(name, c.pin.name);
            }
        }
    const output: string[] = [];
    const covered = new Set<string>();
    for (const c of parsed) {
        if (c.error) {
            errors.push(c.error);
            continue;
        }
        if (c.anchors.length) {
            if (c.anchors.some(pin => !targets.has(pin)))
                continue;
            output.push(c.text.replace(/\{\{(PORT|PIN):([^}]+)\}\}/g, (_, kind: string, pin: string) => {
                covered.add(pin);
                return targets.get(pin)![kind === 'PORT' ? 'port' : 'pin'];
            }));
            continue;
        }
        if (!c.ports) {
            output.push(c.text);
            continue;
        }
        const replacements = c.ports.names.map(name => {
            const pin = originalPins.get(name);
            if (!pin) {
                errors.push('Cannot associate get_ports target with a pin: ' + name + '; use explicit anchors');
                return undefined;
            }
            return targets.get(pin);
        });
        if (!replacements.some(Boolean))
            continue;
        for (const name of c.ports.names) {
            const pin = originalPins.get(name);
            if (pin && targets.has(pin))
                covered.add(pin);
        }
        const names = replacements.filter((v): v is {
            port: string;
            pin: string;
        } => !!v).map(v => v.port);
        let portText = names.length === c.ports.names.length && names.every((n, i) => n === c.ports!.names[i])
            ? c.text.slice(c.ports.start, c.ports.end) : names.join(' ');
        let start = c.ports.start, end = c.ports.end;
        if (c.ports.quoting !== 'braced' && /[\s\[$]/.test(portText)) {
            if (c.ports.quoting === 'quoted') {
                start--;
                end++;
            }
            portText = '{' + portText + '}';
        }
        let result = c.text.slice(0, start) + portText + c.text.slice(end);
        if (c.pin) {
            const replacement = targets.get(c.pin.name);
            if (!replacement)
                continue;
            result = result.slice(0, c.pin.start) + replacement.pin + result.slice(c.pin.end);
        }
        output.push(result);
    }
    for (const pin of targets.keys())
        if (!covered.has(pin))
            errors.push('No usable constraint for pin: ' + pin);
    return errors.length ? { errors } : { text: output.join(''), errors };
}
