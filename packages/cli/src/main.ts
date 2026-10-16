#!/usr/bin/env node

import os from 'node:os';

import type { CommandExecutor } from '@veriflow/flow-core/simulation';

import { adExport, adNew, adValidate, archBuild } from './commands/ad';
import { archApply, taskNew, taskApply, taskTb } from './commands/authoring';
import { boardCommand } from './commands/board';
import { pinsCommand } from './commands/pins';
import { hdlCommand } from './commands/hdl';
import { result } from './commands/artifacts';
import { analyze } from './commands/analyze';
import { libAdd, libList, libRemove } from './commands/lib';
import {
    CommandEnvironment,
    CommandOptions,
    projectNew,
    projectOpen,
    projectShow,
} from './commands/project';
import { topGet, topSet } from './commands/top';
import { simulate } from './commands/sim';
import type { CliDependencySessionFactory } from './commands/sim';
import { runTask, validateTask } from './commands/task';
import { openWaveform, type WaveViewerLauncher } from './commands/wave';
import { NodeWaveViewerLauncher } from './runtime/nodeWaveViewerLauncher';
import type { CliSimulationBackendOptions } from './runtime/simulationBackends';

export interface CliEnvironment extends CommandEnvironment {
    commandExecutor?: CommandExecutor;
    waveViewerLauncher?: WaveViewerLauncher;
    simulationBackendOptions?: CliSimulationBackendOptions;
    dependencySessionFactory?: CliDependencySessionFactory;
}

type CommandHandler = (
    options: CommandOptions,
    environment: CliEnvironment
) => number | Promise<number>;

interface PositionalDefinition {
    key: string;
    requiredName: string;
}

interface OptionDefinition {
    key: string;
    aliases: string[];
    requiredName?: string;
    choices?: readonly string[];
    takesValue?: boolean;
    validate?: (value: string) => string | undefined;
}

interface LeafCommand {
    help: string;
    positionals?: readonly PositionalDefinition[];
    options: OptionDefinition[];
    handler: CommandHandler;
}

const VERSION = (require('@veriflow/cli/package.json') as { version: string }).version;

const ROOT_HELP = `usage: veriflow [-h] [-v] COMMAND ...

VeriFlow - Lightweight Verilog Simulation Manager

positional arguments:
  COMMAND
    project      project management
    lib          global library management
    top          top module management
    analyze      analyze dependencies
    sim          compile and simulate
    wave         open waveform viewer
    arch         create, edit, validate, and build Arch Designs (alias: ad)
    board        manage physical board models
    pins         validate and export pin constraints
    hdl          single-file HDL quick actions
    task         create, edit, validate, and run Simulation Tasks

options:
  -h, --help     show this help message and exit
  -v, --version  show program's version number and exit
`;

const PROJECT_HELP = `usage: veriflow project [-h] ACTION ...

positional arguments:
  ACTION
    new       create new project (auto-saved)
    open      open and show project
    show      show project details

options:
  -h, --help  show this help message and exit
`;

const LIB_HELP = `usage: veriflow lib [-h] ACTION ...

positional arguments:
  ACTION
    add       add global library
    remove    remove global library
    list      list global libraries

options:
  -h, --help  show this help message and exit
`;

const TOP_HELP = `usage: veriflow top [-h] ACTION ...

positional arguments:
  ACTION
    set       set top module (auto-saved)
    get       get current top module

options:
  -h, --help  show this help message and exit
`;

const AD_HELP = `usage: veriflow arch [-h] ACTION ...

positional arguments:
  ACTION
    new       create an Arch Design
    validate  validate an Arch Design
    export    export an Arch Design to RTL
    apply     apply a versioned edit batch
    build     generate RTL and optional XDC together

options:
  -h, --help  show this help message and exit
`;

const TASK_HELP = `usage: veriflow task [-h] ACTION ...

positional arguments:
  ACTION
    new       create a Simulation Task
    apply     apply a versioned edit batch
    tb        generate a testbench
    validate  validate a Simulation Task and its HDL dependencies
    run       run one generated testbench

options:
  -h, --help  show this help message and exit
`;

const PROJECT_NEW_HELP = `usage: veriflow project new [-h] -n NAME [-r ROOT] [-t TOP] [-L LIB] [-s SIM]
                            [-w WAVE] [--output OUTPUT]

options:
  -h, --help           show this help message and exit
  -n, --name NAME      project name
  -r, --root ROOT      project root directory
  -t, --top TOP        top module name
  -L, --lib LIB        lib dirs (comma separated)
  -s, --sim SIM        simulator (builtin/custom; default: builtin)
  -w, --wave WAVE      wave viewer (builtin/custom; default: builtin)
  --output, -o OUTPUT  output JSON file path

Custom command examples:
  Icarus: iverilog -g2005 -o "{output}" {files}; vvp "{output}"
  VCS: vcs -full64 -o "{output}" {files}; ./"{output}"
  XSim: xvlog {files} && xelab {top_module} -snapshot "{output}"; xsim "{output}" --runall
  Surfer: surfer "{wave_file}"
  GTKWave: gtkwave "{wave_file}"
`;

const PROJECT_OPEN_HELP = `usage: veriflow project open [-h] --project PROJECT

options:
  -h, --help            show this help message and exit
  --project, -p PROJECT
                        project JSON file
`;

const PROJECT_SHOW_HELP = PROJECT_OPEN_HELP.replace('project open', 'project show');

const LIB_ADD_HELP = `usage: veriflow lib add [-h] -L LIB

options:
  -h, --help     show this help message and exit
  -L, --lib LIB  library directory
`;

const LIB_REMOVE_HELP = LIB_ADD_HELP.replace('lib add', 'lib remove');

const LIB_LIST_HELP = `usage: veriflow lib list [-h]

options:
  -h, --help  show this help message and exit
`;

const TOP_SET_HELP = `usage: veriflow top set [-h] -p PROJECT -t TOP

options:
  -h, --help            show this help message and exit
  -p, --project PROJECT
                        project JSON file
  -t, --top TOP         top module name
`;

const TOP_GET_HELP = `usage: veriflow top get [-h] -p PROJECT

options:
  -h, --help            show this help message and exit
  -p, --project PROJECT
                        project JSON file
`;

const ANALYZE_HELP = `usage: veriflow analyze [-h] [-p PROJECT] [-t TOP] [-r ROOT] [-L LIB] [-s SIM]
                        [-w WAVE]

options:
  -h, --help            show this help message and exit
  -p, --project PROJECT
                        project JSON file
  -t, --top TOP         top module name (auto-saved)
  -r, --root ROOT       project root (use with --top)
  -L, --lib LIB         lib dirs (comma separated, auto-saved)
  -s, --sim SIM         simulator (builtin/custom; auto-saved)
  -w, --wave WAVE       wave viewer (builtin/custom; auto-saved)
`;

const SIM_HELP = `usage: veriflow sim [-h] --project PROJECT [--top TOP] [--lib LIB] [--sim SIM]
                    [--wave WAVE]

options:
  -h, --help            show this help message and exit
  --project, -p PROJECT
                        project JSON file
  --top, -t TOP         top module name (auto-saved)
  --lib, -L LIB         lib dirs (comma separated, auto-saved)
  --sim, -s SIM         simulator (builtin/custom; auto-saved)
  --wave, -w WAVE       wave viewer (builtin/custom; auto-saved)

Custom command examples:
  Icarus: iverilog -g2005 -o "{output}" {files}; vvp "{output}"
  VCS: vcs -full64 -o "{output}" {files}; ./"{output}"
  XSim: xvlog {files} && xelab {top_module} -snapshot "{output}"; xsim "{output}" --runall
  Surfer: surfer "{wave_file}"
  GTKWave: gtkwave "{wave_file}"
`;

const WAVE_HELP = `usage: veriflow wave [-h] -p PROJECT

options:
  -h, --help            show this help message and exit
  -p, --project PROJECT
                        project JSON file
`;

const AD_NEW_HELP = `usage: veriflow arch new [-h] [-o OUTPUT] MODULE

positional arguments:
  MODULE                generated top module name

options:
  -h, --help            show this help message and exit
  -o, --output OUTPUT   output Arch Design file
`;

const AD_VALIDATE_HELP = `usage: veriflow arch validate [-h] [-p PROJECT] [-L LIB] DESIGN

positional arguments:
  DESIGN                Arch Design file

options:
  -h, --help            show this help message and exit
  -p, --project PROJECT
                        project JSON file
  -L, --lib LIB         additional library directory
`;

const AD_EXPORT_HELP = `usage: veriflow arch export [-h] [-p PROJECT] [-L LIB] [-o OUTPUT]
                          [--language {verilog,systemverilog}] DESIGN

positional arguments:
  DESIGN                Arch Design file

options:
  -h, --help            show this help message and exit
  -p, --project PROJECT
                        project JSON file
  -L, --lib LIB         additional library directory
  -o, --output OUTPUT   output RTL file
  --language {verilog,systemverilog}
                        output language
`;

const TASK_VALIDATE_HELP = `usage: veriflow task validate [-h] [--project PROJECT] TASK

positional arguments:
  TASK                  .st Simulation Task file

options:
  -h, --help            show this help message and exit
  -p, --project PROJECT use execution tools from this project (default: builtin)
`;

const TASK_RUN_HELP = `usage: veriflow task run [-h] [--project PROJECT] TASK

positional arguments:
  TASK                  .st Simulation Task file

options:
  -h, --help            show this help message and exit
  -p, --project PROJECT use execution tools from this project (default: builtin)
`;

const taskRunOptions: OptionDefinition[] = [
    { key: 'project', aliases: ['--project', '-p'] },
];

const LEAF_COMMANDS: Record<string, LeafCommand> = {
    'project new': {
        help: PROJECT_NEW_HELP,
        options: [
            { key: 'name', aliases: ['-n', '--name'], requiredName: '-n/--name' },
            { key: 'root', aliases: ['-r', '--root'] },
            { key: 'top', aliases: ['-t', '--top'] },
            { key: 'lib', aliases: ['-L', '--lib'] },
            { key: 'sim', aliases: ['-s', '--sim'] },
            { key: 'wave', aliases: ['-w', '--wave'] },
            { key: 'output', aliases: ['--output', '-o'] },
        ],
        handler: projectNew,
    },
    'project open': {
        help: PROJECT_OPEN_HELP,
        options: [
            { key: 'project', aliases: ['--project', '-p'], requiredName: '--project/-p' },
        ],
        handler: projectOpen,
    },
    'project show': {
        help: PROJECT_SHOW_HELP,
        options: [
            { key: 'project', aliases: ['--project', '-p'], requiredName: '--project/-p' },
        ],
        handler: projectShow,
    },
    'lib add': {
        help: LIB_ADD_HELP,
        options: [
            { key: 'lib', aliases: ['-L', '--lib'], requiredName: '-L/--lib' },
        ],
        handler: libAdd,
    },
    'lib remove': {
        help: LIB_REMOVE_HELP,
        options: [
            { key: 'lib', aliases: ['-L', '--lib'], requiredName: '-L/--lib' },
        ],
        handler: libRemove,
    },
    'lib list': {
        help: LIB_LIST_HELP,
        options: [],
        handler: libList,
    },
    'top set': {
        help: TOP_SET_HELP,
        options: [
            { key: 'project', aliases: ['-p', '--project'], requiredName: '-p/--project' },
            { key: 'top', aliases: ['-t', '--top'], requiredName: '-t/--top' },
        ],
        handler: topSet,
    },
    'top get': {
        help: TOP_GET_HELP,
        options: [
            { key: 'project', aliases: ['-p', '--project'], requiredName: '-p/--project' },
        ],
        handler: topGet,
    },
    'arch new': {
        help: AD_NEW_HELP,
        positionals: [{ key: 'module', requiredName: 'MODULE' }],
        options: [
            { key: 'output', aliases: ['-o', '--output'] },
        ],
        handler: adNew,
    },
    'arch validate': {
        help: AD_VALIDATE_HELP,
        positionals: [{ key: 'design', requiredName: 'DESIGN' }],
        options: [
            { key: 'project', aliases: ['-p', '--project'] },
            { key: 'lib', aliases: ['-L', '--lib'] },
        ],
        handler: adValidate,
    },
    'arch export': {
        help: AD_EXPORT_HELP,
        positionals: [{ key: 'design', requiredName: 'DESIGN' }],
        options: [
            { key: 'project', aliases: ['-p', '--project'] },
            { key: 'lib', aliases: ['-L', '--lib'] },
            { key: 'output', aliases: ['-o', '--output'] },
            {
                key: 'language',
                aliases: ['--language'],
                choices: ['verilog', 'systemverilog'],
            },
        ],
        handler: adExport,
    },
    'task validate': {
        help: TASK_VALIDATE_HELP,
        positionals: [{ key: 'task', requiredName: 'TASK' }],
        options: [{ key: 'project', aliases: ['--project', '-p'] }],
        handler: validateTask,
    },
    'task run': {
        help: TASK_RUN_HELP,
        positionals: [{ key: 'task', requiredName: 'TASK' }],
        options: taskRunOptions,
        handler: runTask,
    },
};

const outputOptions: OptionDefinition[] = [
    { key: 'output', aliases: ['--output', '-o'] },
    { key: 'json', aliases: ['--json'], takesValue: false },
    { key: 'dryRun', aliases: ['--dry-run'], takesValue: false },
];
const documentOptions: OptionDefinition[] = [
    ...outputOptions, { key: 'ops', aliases: ['--ops'], requiredName: '--ops' },
    { key: 'inPlace', aliases: ['--in-place'], takesValue: false },
    { key: 'project', aliases: ['--project', '-p'] },
];
function newCommand(name: string, handler: CommandHandler, options: OptionDefinition[], positional?: string): LeafCommand {
    return { handler, options, positionals: positional ? [{ key: positional, requiredName: positional.toUpperCase() }] : [],
        help: `usage: veriflow ${name} [-h] ${positional?.toUpperCase() ?? ''} [options]\n\noptions:\n  -h, --help\n${options.map(o => `  ${o.aliases.join(', ')}${o.takesValue === false ? '' : ' VALUE'}`).join('\n')}\n` };
}
Object.assign(LEAF_COMMANDS, {
    'arch apply': newCommand('arch apply', archApply, documentOptions, 'design'),
    'arch build': newCommand('arch build', archBuild, [...outputOptions,
        { key: 'project', aliases: ['--project', '-p'] }, { key: 'lib', aliases: ['--lib', '-L'] },
        { key: 'language', aliases: ['--language'], choices: ['verilog', 'systemverilog'] },
        { key: 'xdcOutput', aliases: ['--xdc-output'] }, { key: 'rtlOnly', aliases: ['--rtl-only'], takesValue: false }], 'design'),
    'task new': newCommand('task new', taskNew, outputOptions),
    'task apply': newCommand('task apply', taskApply, documentOptions, 'task'),
    'task tb': newCommand('task tb', taskTb, [...outputOptions, { key: 'project', aliases: ['--project', '-p'] }], 'task'),
});
for (const action of ['list', 'validate', 'import', 'export']) {
    LEAF_COMMANDS[`board ${action}`] = newCommand(`board ${action}`, (o, e) => boardCommand(action, o, e),
        [...outputOptions, ...(action === 'import' ? [{ key: 'id', aliases: ['--id'] }, { key: 'name', aliases: ['--name'] }] : [])], action === 'list' ? undefined : 'board');
}
for (const action of ['validate', 'export']) {
    LEAF_COMMANDS[`pins ${action}`] = newCommand(`pins ${action}`, (o, e) => pinsCommand(action, o, e),
        [...outputOptions, { key: 'config', aliases: ['--config'] }, { key: 'module', aliases: ['--module'] }, { key: 'project', aliases: ['--project', '-p'] }, { key: 'lib', aliases: ['--lib', '-L'] }], 'file');
}
for (const action of ['format', 'template', 'instantiate', 'tb', 'run']) {
    const extras: Record<string, OptionDefinition[]> = {
        format: [{ key: 'alignment', aliases: ['--alignment'], choices: ['columns', 'adaptive'] }, { key: 'check', aliases: ['--check'], takesValue: false }, { key: 'inPlace', aliases: ['--in-place'], takesValue: false }],
        template: [{ key: 'template', aliases: ['--template'] }, { key: 'list', aliases: ['--list'], takesValue: false }],
        instantiate: [{ key: 'module', aliases: ['--module'] }, { key: 'instance', aliases: ['--instance'] }],
        tb: [{ key: 'module', aliases: ['--module'] }, { key: 'name', aliases: ['--name'] }, { key: 'config', aliases: ['--config'] }],
        run: [{ key: 'waveOutput', aliases: ['--wave-output'] }, { key: 'module', aliases: ['--module'] }, { key: 'project', aliases: ['--project', '-p'] }, { key: 'lib', aliases: ['--lib', '-L'] }, { key: 'sim', aliases: ['--sim'] }],
    };
    LEAF_COMMANDS[`hdl ${action}`] = newCommand(`hdl ${action}`, (o, e) => hdlCommand(action, o, e), [...(action === 'run' ? outputOptions.filter(option => option.key !== 'output') : outputOptions), ...extras[action]], action === 'template' ? undefined : 'file');
}

const PARENT_HELP: Record<string, string> = {
    project: PROJECT_HELP,
    lib: LIB_HELP,
    top: TOP_HELP,
    arch: AD_HELP,
    task: TASK_HELP,
};

const PARENT_ACTIONS: Record<string, string[]> = {
    project: ['new', 'open', 'show'],
    lib: ['add', 'remove', 'list'],
    top: ['set', 'get'],
    arch: ['new', 'apply', 'validate', 'export', 'build'],
    task: ['new', 'apply', 'tb', 'validate', 'run'],
};

for (const parent of ['board', 'pins', 'hdl']) {
    const actions = Object.keys(LEAF_COMMANDS).filter(name => name.startsWith(parent + ' ')).map(name => name.split(' ')[1]);
    PARENT_ACTIONS[parent] = actions;
    PARENT_HELP[parent] = `usage: veriflow ${parent} [-h] ACTION ...\n\nactions: ${actions.join(', ')}\n`;
}

const TOP_LEVEL_COMMANDS: Record<string, LeafCommand> = {
    analyze: {
        help: ANALYZE_HELP,
        options: [
            { key: 'project', aliases: ['-p', '--project'] },
            { key: 'top', aliases: ['-t', '--top'] },
            { key: 'root', aliases: ['-r', '--root'] },
            { key: 'lib', aliases: ['-L', '--lib'] },
            { key: 'sim', aliases: ['-s', '--sim'] },
            { key: 'wave', aliases: ['-w', '--wave'] },
        ],
        handler: analyze,
    },
    sim: {
        help: SIM_HELP,
        options: [
            {
                key: 'project',
                aliases: ['--project', '-p'],
                requiredName: '--project/-p',
            },
            { key: 'top', aliases: ['--top', '-t'] },
            { key: 'lib', aliases: ['--lib', '-L'] },
            { key: 'sim', aliases: ['--sim', '-s'] },
            { key: 'wave', aliases: ['--wave', '-w'] },
        ],
        handler: simulate,
    },
    wave: {
        help: WAVE_HELP,
        options: [
            {
                key: 'project',
                aliases: ['-p', '--project'],
                requiredName: '-p/--project',
            },
        ],
        handler: openWaveform,
    },
};

function usage(help: string): string {
    return `${help.split('\n\n', 1)[0]}\n`;
}

function parseError(
    environment: CliEnvironment,
    command: string,
    help: string,
    message: string
): number {
    environment.stderr(`${usage(help)}veriflow ${command}: error: ${message}\n`);
    return 2;
}

function parseOptions(
    command: string,
    argv: string[],
    definition: LeafCommand,
    environment: CliEnvironment
): CommandOptions | number {
    if (argv.includes('-h') || argv.includes('--help')) {
        environment.stdout(definition.help);
        return 0;
    }

    const byAlias = new Map<string, OptionDefinition>();
    for (const option of definition.options) {
        for (const alias of option.aliases) byAlias.set(alias, option);
    }

    const values: CommandOptions = {};
    let positionalIndex = 0;
    for (let index = 0; index < argv.length; index += 1) {
        const argument = argv[index];
        let option = byAlias.get(argument);
        let inlineValue: string | undefined;

        if (!option && argument.startsWith('--')) {
            const equals = argument.indexOf('=');
            const optionName = equals < 0 ? argument : argument.slice(0, equals);
            const matchingAliases = definition.options.flatMap(candidate => (
                candidate.aliases.filter(alias => alias.startsWith('--') && alias.startsWith(optionName))
            ));
            if (matchingAliases.length > 1) {
                return parseError(
                    environment,
                    command,
                    definition.help,
                    `ambiguous option: ${optionName} could match ${matchingAliases.join(', ')}`
                );
            }
            if (matchingAliases.length === 1) {
                option = byAlias.get(matchingAliases[0]);
                if (equals >= 0) inlineValue = argument.slice(equals + 1);
            }
        }

        if (!option && /^-[^-].+/.test(argument)) {
            option = byAlias.get(argument.slice(0, 2));
            if (option) inlineValue = argument.slice(2);
        }

        if (!option && !argument.startsWith('-')) {
            const positional = definition.positionals?.[positionalIndex];
            if (positional) {
                values[positional.key] = argument;
                positionalIndex += 1;
                continue;
            }
        }

        if (!option) {
            return parseError(
                environment,
                command,
                definition.help,
                `unrecognized arguments: ${argument}`
            );
        }

        if (option.takesValue === false) {
            if (inlineValue !== undefined) {
                return parseError(
                    environment,
                    command,
                    definition.help,
                    `argument ${option.aliases.join('/')}: does not take a value`,
                );
            }
            values[option.key] = 'true';
            continue;
        }

        const value = inlineValue ?? argv[index + 1];
        if (
            value === undefined
            || (inlineValue === undefined && value !== '-' && value.startsWith('-'))
        ) {
            return parseError(
                environment,
                command,
                definition.help,
                `argument ${option.aliases.join('/')}: expected one argument`
            );
        }
        values[option.key] = value;
        if (option.choices && !option.choices.includes(value)) {
            return parseError(
                environment,
                command,
                definition.help,
                `argument ${option.aliases.join('/')}: invalid choice: '${value}' `
                + `(choose from ${option.choices.join(', ')})`
            );
        }
        const validationError = option.validate?.(value);
        if (validationError) {
            return parseError(environment, command, definition.help, validationError);
        }
        if (inlineValue === undefined) index += 1;
    }

    const missingPositionals = (definition.positionals ?? [])
        .filter(positional => values[positional.key] === undefined)
        .map(positional => positional.requiredName);
    const missingOptions = definition.options
        .filter(option => option.requiredName && values[option.key] === undefined)
        .map(option => option.requiredName!);
    const missing = [...missingPositionals, ...missingOptions];
    if (missing.length > 0) {
        return parseError(
            environment,
            command,
            definition.help,
            `the following arguments are required: ${missing.join(', ')}`
        );
    }
    return values;
}

export async function runCli(argv: string[], environment: CliEnvironment): Promise<number> {
    if (argv.length === 0) {
        environment.stdout(ROOT_HELP);
        return 0;
    }
    if (argv[0] === '-h' || argv[0] === '--help') {
        environment.stdout(ROOT_HELP);
        return 0;
    }
    if (argv[0] === '-v' || argv[0] === '--version') {
        environment.stdout(`VeriFlow ${VERSION}\n`);
        return 0;
    }

    if (argv[0] === 'ad') argv = ['arch', ...argv.slice(1)];
    const topLevelCommand = TOP_LEVEL_COMMANDS[argv[0]];
    if (topLevelCommand) {
        const parsed = parseOptions(argv[0], argv.slice(1), topLevelCommand, environment);
        if (typeof parsed === 'number') return parsed;
        try {
            return await topLevelCommand.handler(parsed, environment);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            environment.stderr(`Error: ${message}\n`);
            return 1;
        }
    }

    const parent = argv[0];
    if (!(parent in PARENT_HELP)) {
        environment.stderr(
            `${usage(ROOT_HELP)}veriflow: error: argument COMMAND: invalid choice: '${parent}' `
            + `(choose from project, lib, top, analyze, sim, wave, arch, task, board, pins, hdl)\n`
        );
        return 2;
    }
    if (argv.length === 1) {
        environment.stdout(ROOT_HELP);
        return 0;
    }
    if (argv[1] === '-h' || argv[1] === '--help') {
        environment.stdout(PARENT_HELP[parent]);
        return 0;
    }

    const action = argv[1];
    const commandName = `${parent} ${action}`;
    const definition = LEAF_COMMANDS[commandName];
    if (!definition) {
        const choices = PARENT_ACTIONS[parent].join(', ');
        environment.stderr(
            `${usage(PARENT_HELP[parent])}veriflow ${parent}: error: argument ACTION: `
            + `invalid choice: '${action}' (choose from ${choices})\n`
        );
        return 2;
    }

    const parsed = parseOptions(commandName, argv.slice(2), definition, environment);
    if (typeof parsed === 'number') return parsed;

    try {
        return await definition.handler(parsed, environment);
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (parsed.json) result(parsed, environment, { diagnostics: [{ code: 'COMMAND_FAILED', message }], artifacts: [] });
        else environment.stderr(`Error: ${message}\n`);
        return 1;
    }
}

if (require.main === module) {
    void runCli(process.argv.slice(2), {
        cwd: process.cwd(),
        homeDir: os.homedir(),
        stdout: text => { process.stdout.write(text); },
        stderr: text => { process.stderr.write(text); },
        waveViewerLauncher: new NodeWaveViewerLauncher(),
    }).then(exitCode => {
        process.exitCode = exitCode;
    });
}
