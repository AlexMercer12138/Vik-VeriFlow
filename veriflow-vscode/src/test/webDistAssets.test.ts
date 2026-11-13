import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';

const root = path.resolve(__dirname, '../../..');

const outputFiles = {
    constraints: ['index.css', 'index.html', 'index.js'],
    waveform: ['index.css', 'index.html', 'index.js'],
    schematic: ['index.css', 'index.html', 'index.js'],
};

for (const [application, expectedFiles] of Object.entries(outputFiles)) {
    const outputRoot = path.join(root, 'web-dist', application);
    assert.deepStrictEqual(fs.readdirSync(outputRoot).sort(), expectedFiles);
    for (const fileName of expectedFiles) {
        assert.ok(
            fs.statSync(path.join(outputRoot, fileName)).size > 0,
            `web-dist/${application}/${fileName} is missing`
        );
    }
    assert.match(
        fs.readFileSync(path.join(outputRoot, 'index.css'), 'utf8'),
        /--vf-bg:/,
        `${application} must include the shared design tokens`
    );
    assert.ok(fs.readFileSync(path.join(outputRoot, 'index.js'), 'utf8').length > 100);
}

for (const [application, fileNames] of Object.entries(outputFiles)) {
    for (const fileName of fileNames) {
        assert.deepStrictEqual(
            fs.readFileSync(path.join(root, 'web-dist', application, fileName)),
            fs.readFileSync(path.join(root, 'veriflow-vscode', 'media', application, fileName)),
            `${application}/${fileName} must use the canonical VS Code asset`
        );
    }
}

assert.doesNotMatch(
    fs.readFileSync(path.join(root, 'web-dist', 'waveform', 'index.js'), 'utf8'),
    /\$\{stateJson\}/,
    'renderer source must not contain a host-specific bootstrap marker'
);
const waveformHtml = fs.readFileSync(path.join(root, 'web-dist', 'waveform', 'index.html'), 'utf8');
for (const fileName of ['index.css', 'index.js']) {
    assert.ok(waveformHtml.includes(`./${fileName}`), `waveform HTML must reference ${fileName}`);
}

assert.ok(
    !fs.existsSync(path.join(root, 'veriflow-vscode', 'webview', 'schematic', 'index.ts')),
    'the old schematic webview source must not exist'
);

console.log('canonical web asset tests passed');
