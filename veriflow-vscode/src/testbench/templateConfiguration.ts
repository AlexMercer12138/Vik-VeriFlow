import { hdlTemplates } from '@veriflow/flow-core';

type HdlTemplateLanguage = 'verilog' | 'systemverilog';

export interface ResolvedHdlTemplate {
    id: string;
    label: string;
    description: string;
    body: string;
    languages: readonly HdlTemplateLanguage[];
}

export interface TemplateConfigurationResult {
    templates: readonly ResolvedHdlTemplate[];
    issues: readonly { path: string; message: string }[];
}

function isObject(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Resolve VS Code's already merged document configuration without changing built-ins. */
export function resolveHdlTemplates(value: unknown): TemplateConfigurationResult {
    const languages: readonly HdlTemplateLanguage[] = ['verilog', 'systemverilog'];
    const templates = new Map<string, ResolvedHdlTemplate>(hdlTemplates.map(template => [template.id, {
        id: template.id,
        label: template.label,
        description: template.description,
        body: template.snippet ?? template.text,
        languages: [...languages],
    }]));
    const issues: { path: string; message: string }[] = [];
    const rootPath = 'veriflow.hdlTemplates';
    if (value === undefined) return { templates: [...templates.values()], issues };
    if (!isObject(value)) {
        return { templates: [...templates.values()], issues: [{ path: rootPath, message: 'Expected an object keyed by template ID.' }] };
    }

    // The map preserves built-in positions; sorted new IDs append after them.
    for (const id of Object.keys(value).sort()) {
        const path = `${rootPath}.${id}`;
        if (!/^[A-Za-z_][A-Za-z0-9_-]*$/.test(id)) {
            issues.push({ path, message: 'Use a nonempty ID matching [A-Za-z_][A-Za-z0-9_-]*.' });
            continue;
        }
        const entry = value[id];
        if (!isObject(entry)) {
            issues.push({ path, message: 'Expected a template object.' });
            continue;
        }
        // Explicit disabling must not accidentally fall back to an enabled built-in.
        if (entry.enabled === false) {
            templates.delete(id);
            continue;
        }

        const builtin = templates.get(id);
        const issueCount = issues.length;
        const issue = (field: string, message: string) => issues.push({ path: `${path}.${field}`, message });
        for (const field of Object.keys(entry)) {
            if (!['label', 'description', 'body', 'languages', 'enabled'].includes(field)) issue(field, 'Unknown template field.');
        }
        for (const field of ['label', 'description'] as const) {
            if (field in entry && typeof entry[field] !== 'string') issue(field, 'Expected a string.');
        }
        if ('enabled' in entry && typeof entry.enabled !== 'boolean') issue('enabled', 'Expected a boolean.');
        let body = builtin?.body ?? '';
        if ('body' in entry) {
            if (typeof entry.body === 'string') body = entry.body;
            else if (Array.isArray(entry.body) && entry.body.every(line => typeof line === 'string')) body = entry.body.join('\n');
            else issue('body', 'Expected a string or an array of strings.');
        } else if (!builtin) issue('body', 'A new template requires a body.');

        let selectedLanguages = builtin?.languages ?? languages;
        if ('languages' in entry) {
            if (Array.isArray(entry.languages) && entry.languages.length > 0
                && entry.languages.every(language => language === 'verilog' || language === 'systemverilog')
                && new Set(entry.languages).size === entry.languages.length) {
                selectedLanguages = [...entry.languages];
            } else issue('languages', 'Expected a nonempty array of unique verilog/systemverilog language IDs.');
        }
        // Keep the original built-in, or omit a new item, when any field is invalid.
        if (issues.length !== issueCount) continue;
        templates.set(id, {
            id,
            label: typeof entry.label === 'string' ? entry.label : builtin?.label ?? id,
            description: typeof entry.description === 'string' ? entry.description : builtin?.description ?? '',
            body,
            languages: [...selectedLanguages],
        });
    }
    return { templates: [...templates.values()], issues };
}
