import * as path from 'node:path';
import { readFile } from 'node:fs/promises';
import { adPhysicalPorts, generateXdc, parsePhysicalConfiguration } from '@veriflow/schematic-core/arch-design';
import { resolvePhysicalBoard, rtlPhysicalPorts } from '@veriflow/hdl-runtime/physical';
import { generatedXdc, normalizeArchDesignDefinitionKeys } from '@veriflow/hdl-runtime/archDesign';
import { loadArchDesign, openProject, scanArchDesignModuleDefinitions } from './ad';
import { loadInterfaceProtocolCatalog } from '../runtime/interfaceProtocolLoader';
import { selectFileModule } from './hdl';
import { emitText, result } from './artifacts';
import type { CommandOptions } from './project';
import type { CliEnvironment } from '../main';

export async function pinsCommand(action: string, options: CommandOptions, env: CliEnvironment): Promise<number> {
    const source = path.resolve(env.cwd, options.file!);
    let owner = source, configuration, ports;
    const inputs = [{ path: source, text: await readFile(source, 'utf8') }];
    if (/\.ad$/i.test(source)) {
        const opts = { ...options, design: source }, loaded = await loadArchDesign(opts, env);
        if (!loaded) return 1;
        if (options.config) throw new Error('AD pin bindings are stored in the .ad document');
        const project = openProject(opts, env), catalog = await scanArchDesignModuleDefinitions(loaded, opts, env, project);
        const protocols = await loadInterfaceProtocolCatalog(project?.interfaceProtocolFiles ?? []);
        if (protocols.diagnostics.length) throw new Error(protocols.diagnostics.map(d => d.message).join('\n'));
        inputs.push({ path: source, text: loaded.source }, ...catalog.inputs, ...protocols.inputs);
        configuration = loaded.design.physical;
        ports = adPhysicalPorts(normalizeArchDesignDefinitionKeys(loaded.design, catalog), catalog.definitions, protocols.catalog);
    } else {
        if (!options.config) throw new Error('RTL pins require --config <top.pins.json>');
        owner = path.resolve(env.cwd, options.config);
        const text = await readFile(owner, 'utf8'); inputs.push({ path: owner, text });
        configuration = parsePhysicalConfiguration(JSON.parse(text));
        const selected = await selectFileModule(source, options.module);
        inputs.push(...selected.inputs);
        ports = rtlPhysicalPorts(selected.module.ports, selected.module.parameters);
    }
    if (!configuration) throw new Error('No physical pin configuration');
    const board = await resolvePhysicalBoard(owner, configuration.board, { configPath: path.join(env.homeDir, '.veriflow_config.json'), onInput: (file, text) => inputs.push({ path: file, text }) });
    const generated = generateXdc(board, configuration, ports);
    if (!generated.text) {
        if (options.json) result(options, env, { diagnostics: generated.diagnostics, artifacts: [] });
        else for (const diagnostic of generated.diagnostics) env.stderr(`${diagnostic.severity}: ${diagnostic.message}\n`);
        return 1;
    }
    if (action === 'validate') {
        if (options.json) result(options, env, { diagnostics: generated.diagnostics });
        else env.stdout('Pins: OK\n');
        return 0;
    }
    const output = options.output ? path.resolve(env.cwd, options.output) : source.slice(0, -path.extname(source).length) + '.xdc';
    if (path.extname(output).toLowerCase() !== '.xdc') throw new Error('Constraint output must use .xdc');
    const text = generatedXdc(source, output, generated.text), header = text.split('\n')[0];
    return emitText(text, 'xdc', { ...options, output }, env, inputs, previous => previous.split('\n')[0] === header);
}
