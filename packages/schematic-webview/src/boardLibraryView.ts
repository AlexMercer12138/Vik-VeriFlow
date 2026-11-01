/** URI rewriting is done by the VS Code host; desktop uses the same static page. */
export function constraintWorkbenchHtml(template: string, css: string, script: string, cspSource: string): string {
    return template.replace("style-src 'self' 'unsafe-inline'; script-src 'self'", `style-src ${cspSource} 'unsafe-inline'; script-src ${cspSource}`).replace('href="index.css"', 'href="' + css + '"').replace('src="index.js"', 'src="' + script + '"');
}
