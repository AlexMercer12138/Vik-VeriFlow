import type { SimulationTaskDocument } from '@veriflow/hdl-runtime/simulationTask';
import { validateProtocolPreset } from '@veriflow/hdl-runtime/simulationTask/protocolPresets';
import {
    MAX_SCHEMATIC_PLACEMENT_OFFSET,
    type SchematicGraph,
} from '@veriflow/schematic-core';
import type {
    ArchDesign,
    ArchDesignEdit,
    ArchDesignEndpoint,
    ArchDesignInstance,
    ArchDesignInterfaceConnection,
    ArchDesignInterfaceEndpoint,
    ArchDesignInterfaceSnapshot,
    ArchDesignLogic,
    ArchDesignModuleDefinition,
    ArchDesignPort,
    ArchDesignPresentation,
    ArchDesignValidationResult,
} from '@veriflow/schematic-core/arch-design';
import { isSafeDefaultExpression } from '@veriflow/schematic-core/arch-design';
import type { ArchDesignInspectorData } from '../archDesign/editorSupport';

import type { SourceSpan } from '../core/hdl/model';
import {
    normalizeSchematicLayout,
    type SchematicLayout,
} from './layoutStore';

/** Bounds source-map work while accommodating deeply composed include expansions. */
const MAX_COMPOSITE_PARTS = 5_000;

/** Capabilities are enforced by each host adapter as well as the shared UI. */
export type SchematicCapabilities = Readonly<{
    addPort?: boolean;
    exportRtl?: boolean;
    run?: boolean;
}>;
export type SimulationTaskAction = 'addPreset' | 'updatePreset' | 'updateTaskSettings'
    | 'generateTestbench' | 'run' | 'cancel' | 'openWave';
export type SchematicEditorProjection = Omit<Extract<HostEvent,
    { type: 'archDesignState'; status: 'editable' }>, 'type' | 'status' | 'revision'>;
export type SimulationTaskViewState = Readonly<{
    document: SimulationTaskDocument;
    version: number;
    execution: Readonly<{
        status: 'idle' | 'running' | 'completed' | 'failed' | 'stopped';
        canOpenWave: boolean;
        error?: string;
    }>;
}>;

export type WebviewCommand =
    | { type: 'ready' }
    | { type: 'selectModule'; moduleKey: string }
    | {
        type: 'saveLayout';
        moduleKey: string;
        revision: string;
        layout: SchematicLayout;
    }
    | { type: 'revealSource'; span: SourceSpan }
    | { type: 'openDefinition'; definitionKey: string }
    | { type: 'search'; query: string }
    | { type: 'relayoutAll'; moduleKey: string; revision: string }
    | { type: 'editSchematic'; revision: string; edit: ArchDesignEdit }
    | { type: 'simulationTaskCommand'; revision: string; command: SimulationTaskAction; payload?: unknown }
    | { type: 'editArchDesign'; revision: string; edit: ArchDesignEdit }
    | { type: 'exportArchDesign'; revision: string };

export type HostEvent =
    | { type: 'simulationTaskState'; revision: string; projection: SchematicEditorProjection; task: SimulationTaskViewState }

    | {
        type: 'initialize';
        fileUri: string;
        modules: Array<{ key: string; name: string }>;
        selectedModuleKey: string;
        documentKind?: 'hdl' | 'arch-design' | 'simulation-task';
        capabilities?: SchematicCapabilities;
        editable?: boolean;
    }
    | {
        type: 'graph';
        revision: string;
        graph: SchematicGraph;
        layout: SchematicLayout;
        fitOnFirstRender?: boolean;
    }
    | { type: 'diagnostics'; errors: number; warnings: number; details?: SchematicGraph['diagnostics'] }
    | { type: 'hostError'; message: string }
    | { type: 'archDesignLayoutSaved'; revision: string }
    | { type: 'archDesignRevisionChanged'; revision: string }
    | {
        type: 'archDesignState';
        status: 'editable';
        revision: string;
        design: ArchDesign;
        catalog: readonly ArchDesignModuleDefinition[];
        moduleChoices?: readonly Readonly<{
            label: string;
            description: string;
            moduleName: string;
            definitionKey: string;
        }>[];
        validation: ArchDesignValidationResult;
        inspector: ArchDesignInspectorData;
    }
    | {
        type: 'archDesignState';
        status: 'readonly';
        revision: string;
        reason: string;
        schemaVersion?: number;
    }
    | {
        type: 'archDesignState';
        status: 'invalid';
        revision: string;
        diagnostics: readonly Readonly<{
            path: string;
            code: string;
            message: string;
        }>[];
    };

const PLAIN_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_$]*$/;
const MAX_AD_STRING_LENGTH = 4_096;
const MAX_AD_DICTIONARY_ENTRIES = 4_096;
const MAX_AD_PRESENTATION_NODES = 50_000;
const MAX_AD_PRESENTATION_COLUMN = 100_000;

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown): value is string {
    return typeof value === 'string'
        && value.length <= MAX_AD_STRING_LENGTH
        && value.trim().length > 0;
}

function identifier(value: unknown): value is string {
    return typeof value === 'string'
        && value.length <= MAX_AD_STRING_LENGTH
        && PLAIN_IDENTIFIER.test(value);
}

function ownValue(value: Record<string, unknown>, key: string): unknown {
    return Object.prototype.propertyIsEnumerable.call(value, key)
        ? value[key]
        : undefined;
}

function onlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
    return Object.keys(value).every(key => keys.includes(key));
}

function finiteNumber(value: unknown, positive = false): value is number {
    return typeof value === 'number' && Number.isFinite(value) && (positive ? value > 0 : value >= 0);
}

function validSimulationPreset(value: unknown): boolean {
    if (!isRecord(value)) return false;
    if (value.kind === 'protocol') return validateProtocolPreset(value).length === 0;
    if (value.kind === 'clock') return onlyKeys(value, ['kind', 'frequencyMHz', 'initial'])
        && finiteNumber(value.frequencyMHz, true) && (value.initial === 0 || value.initial === 1);
    if (value.kind === 'reset') return onlyKeys(value, ['kind', 'active', 'duration'])
        && finiteNumber(value.duration) && (value.active === 0 || value.active === 1);
    if (value.kind !== 'stimulus' || !onlyKeys(value, ['kind', 'width', 'initial', 'transitions'])
        || !Number.isSafeInteger(value.width) || !finiteNumber(value.width, true)
        || !nonEmptyString(value.initial) || !Array.isArray(value.transitions)
        || value.transitions.length > MAX_AD_DICTIONARY_ENTRIES) return false;
    let previous = -1;
    return value.transitions.every(row => {
        if (!isRecord(row) || !onlyKeys(row, ['at', 'value']) || !finiteNumber(row.at)
            || row.at <= previous || !nonEmptyString(row.value)) return false;
        previous = row.at;
        return true;
    });
}

function validSimulationSettings(value: unknown): boolean {
    if (!isRecord(value) || !onlyKeys(value, ['timeUnit', 'timePrecision', 'duration', 'waveform', 'exportPath'])) return false;
    const timeScale = /^(1|10|100)(s|ms|us|ns|ps|fs)$/;
    return typeof value.timeUnit === 'string' && timeScale.test(value.timeUnit)
        && typeof value.timePrecision === 'string' && timeScale.test(value.timePrecision)
        && finiteNumber(value.duration, true)
        && isRecord(value.waveform) && onlyKeys(value.waveform, ['enabled', 'filename'])
        && typeof value.waveform.enabled === 'boolean' && nonEmptyString(value.waveform.filename)
        && (value.exportPath === undefined || nonEmptyString(value.exportPath));
}

function sourceOffset(value: unknown): value is number {
    return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

function finiteCoordinate(value: unknown): value is number {
    return typeof value === 'number'
        && Number.isFinite(value)
        && Math.abs(value) <= MAX_SCHEMATIC_PLACEMENT_OFFSET;
}

function boundedInteger(value: unknown, maximum: number): value is number {
    return typeof value === 'number'
        && Number.isSafeInteger(value)
        && value >= 0
        && value < maximum;
}

function defineOwn<T>(target: Record<string, T>, key: string, value: T): void {
    Object.defineProperty(target, key, {
        value,
        enumerable: true,
        configurable: true,
        writable: true,
    });
}

function normalizeParameters(
    value: unknown
): ArchDesignInstance['parameters'] | undefined | false {
    if (value === undefined) return undefined;
    if (!isRecord(value)) return false;
    const parameters: Record<string, string | number | boolean> = {};
    let count = 0;
    for (const key of Object.keys(value)) {
        if (!Object.prototype.propertyIsEnumerable.call(value, key)
            || !identifier(key)) return false;
        count += 1;
        if (count > MAX_AD_DICTIONARY_ENTRIES) return false;
        const candidate = value[key];
        if (typeof candidate !== 'string'
            && typeof candidate !== 'boolean'
            && (typeof candidate !== 'number' || !Number.isFinite(candidate))) {
            return false;
        }
        if (typeof candidate === 'string' && candidate.length > MAX_AD_STRING_LENGTH) {
            return false;
        }
        defineOwn(parameters, key, candidate);
    }
    return parameters;
}

function normalizeInstance(value: unknown): ArchDesignInstance | undefined {
    if (!isRecord(value)) return undefined;
    const name = ownValue(value, 'name');
    const module = ownValue(value, 'module');
    const definitionKey = ownValue(value, 'definitionKey');
    const parameters = normalizeParameters(ownValue(value, 'parameters'));
    if (!identifier(name)
        || !identifier(module)
        || (definitionKey !== undefined && !nonEmptyString(definitionKey))
        || parameters === false) return undefined;
    return {
        name,
        module,
        ...(definitionKey === undefined ? {} : { definitionKey }),
        ...(parameters === undefined ? {} : { parameters }),
    };
}

function normalizeWidth(value: unknown): ArchDesignPort['width'] | undefined | false {
    if (value === undefined) return undefined;
    if (typeof value === 'number') {
        return Number.isSafeInteger(value) && value > 0 ? value : false;
    }
    if (!isRecord(value)) return false;
    const expression = ownValue(value, 'expression');
    return nonEmptyString(expression) ? { expression } : false;
}

function normalizePort(value: unknown): ArchDesignPort | undefined {
    if (!isRecord(value)) return undefined;
    const name = ownValue(value, 'name');
    const direction = ownValue(value, 'direction');
    const inoutMode = ownValue(value, 'inoutMode');
    const width = normalizeWidth(ownValue(value, 'width'));
    if (!identifier(name)
        || (direction !== 'input' && direction !== 'output' && direction !== 'inout')
        || (inoutMode !== undefined && (direction !== 'inout'
            || (inoutMode !== 'direct' && inoutMode !== 'tristate')))
        || width === false) return undefined;
    return {
        name,
        direction,
        ...(inoutMode === undefined ? {} : { inoutMode }),
        ...(width === undefined ? {} : { width }),
    };
}

function normalizeEndpoint(value: unknown): ArchDesignEndpoint | undefined {
    if (!isRecord(value)) return undefined;
    const kind = ownValue(value, 'kind');
    const port = ownValue(value, 'port');
    if (!identifier(port)) return undefined;
    if (kind === 'instance') {
        const instance = ownValue(value, 'instance');
        return identifier(instance) ? { kind, instance, port } : undefined;
    }
    if (kind === 'logic') {
        const logic = ownValue(value, 'logic');
        return identifier(logic) ? { kind, logic, port } : undefined;
    }
    if (kind !== 'port') return undefined;
    const signal = ownValue(value, 'signal');
    return signal === undefined
        ? { kind, port }
        : signal === 'value' || signal === 'i' || signal === 'o' || signal === 't'
            ? { kind, port, signal }
            : undefined;
}

function normalizeRequiredWidth(value: unknown): ArchDesignPort['width'] | undefined {
    const width = normalizeWidth(value);
    return width === false || width === undefined ? undefined : width;
}

function normalizePositiveInteger(
    value: unknown,
    minimum: number,
    maximum = Number.MAX_SAFE_INTEGER
): number | undefined {
    return typeof value === 'number'
        && Number.isSafeInteger(value)
        && value >= minimum
        && value <= maximum
        ? value
        : undefined;
}

function normalizeLogic(value: unknown): ArchDesignLogic | undefined {
    if (!isRecord(value)) return undefined;
    const name = ownValue(value, 'name');
    const operation = ownValue(value, 'operation');
    if (!identifier(name) || typeof operation !== 'string') return undefined;
    if (operation === 'constant') {
        const width = normalizeRequiredWidth(ownValue(value, 'width'));
        const expression = ownValue(value, 'expression');
        return width && typeof expression === 'string'
            && expression.length <= MAX_AD_STRING_LENGTH
            && isSafeDefaultExpression(expression)
            ? { name, operation, width, expression }
            : undefined;
    }
    if (operation === 'not' || operation === 'mux') {
        const width = normalizeRequiredWidth(ownValue(value, 'width'));
        return width ? { name, operation, width } : undefined;
    }
    if (operation === 'and' || operation === 'or' || operation === 'xor'
        || operation === 'nand' || operation === 'nor' || operation === 'xnor') {
        const width = normalizeRequiredWidth(ownValue(value, 'width'));
        const inputCount = normalizePositiveInteger(ownValue(value, 'inputCount'), 2, 8);
        return width && inputCount ? { name, operation, width, inputCount } : undefined;
    }
    if (operation === 'concat') {
        const candidates = ownValue(value, 'inputWidths');
        if (!Array.isArray(candidates) || candidates.length < 2 || candidates.length > 8) {
            return undefined;
        }
        const inputWidths = candidates.map(normalizeRequiredWidth);
        return inputWidths.every((width): width is NonNullable<typeof width> =>
            width !== undefined)
            ? { name, operation, inputWidths }
            : undefined;
    }
    if (operation === 'slice') {
        const inputWidth = normalizeRequiredWidth(ownValue(value, 'inputWidth'));
        const msb = normalizePositiveInteger(ownValue(value, 'msb'), 0);
        const lsb = normalizePositiveInteger(ownValue(value, 'lsb'), 0);
        return inputWidth && msb !== undefined && lsb !== undefined
            && msb >= lsb && (typeof inputWidth !== 'number' || msb < inputWidth)
            ? { name, operation, inputWidth, msb, lsb }
            : undefined;
    }
    if (operation === 'replicate') {
        const inputWidth = normalizeRequiredWidth(ownValue(value, 'inputWidth'));
        const count = normalizePositiveInteger(ownValue(value, 'count'), 1, 65_536);
        return inputWidth && count ? { name, operation, inputWidth, count } : undefined;
    }
    if (operation === 'zero-extend' || operation === 'sign-extend') {
        const inputWidth = normalizeRequiredWidth(ownValue(value, 'inputWidth'));
        const outputWidth = normalizeRequiredWidth(ownValue(value, 'outputWidth'));
        return inputWidth && outputWidth
            && (typeof inputWidth !== 'number'
                || typeof outputWidth !== 'number'
                || outputWidth >= inputWidth)
            ? { name, operation, inputWidth, outputWidth }
            : undefined;
    }
    if (operation === 'reduce-and' || operation === 'reduce-or'
        || operation === 'reduce-xor') {
        const inputWidth = normalizeRequiredWidth(ownValue(value, 'inputWidth'));
        return inputWidth ? { name, operation, inputWidth } : undefined;
    }
    return undefined;
}

function normalizeInterfaceEndpoint(value: unknown): ArchDesignInterfaceEndpoint | undefined {
    if (!isRecord(value)) return undefined;
    const kind = ownValue(value, 'kind');
    if (kind === 'port') {
        const port = ownValue(value, 'port');
        return identifier(port) ? { kind, port } : undefined;
    }
    if (kind === 'instance') {
        const instance = ownValue(value, 'instance');
        const interfaceName = ownValue(value, 'interface');
        return identifier(instance) && identifier(interfaceName)
            ? { kind, instance, interface: interfaceName }
            : undefined;
    }
    return undefined;
}

function normalizeInterfaceConnection(
    value: unknown
): ArchDesignInterfaceConnection | undefined {
    if (!isRecord(value)) return undefined;
    const name = ownValue(value, 'name');
    const master = normalizeInterfaceEndpoint(ownValue(value, 'master'));
    const slave = normalizeInterfaceEndpoint(ownValue(value, 'slave'));
    if (!identifier(name) || !master || !slave) return undefined;
    return { name, master, slave };
}

function normalizeInterfaceSnapshot(value: unknown): ArchDesignInterfaceSnapshot | undefined {
    if (!isRecord(value)) return undefined;
    const endpoint = normalizeInterfaceEndpoint(ownValue(value, 'endpoint'));
    const protocol = ownValue(value, 'protocol');
    const role = ownValue(value, 'role');
    const membersValue = ownValue(value, 'members');
    if (endpoint?.kind !== 'instance'
        || !nonEmptyString(protocol)
        || (role !== 'master' && role !== 'slave')
        || !Array.isArray(membersValue)
        || membersValue.length > MAX_AD_DICTIONARY_ENTRIES) return undefined;
    const members: ArchDesignInterfaceSnapshot['members'][number][] = [];
    for (let index = 0; index < membersValue.length; index += 1) {
        if (!Object.prototype.propertyIsEnumerable.call(membersValue, index)) return undefined;
        const item = membersValue[index];
        if (!isRecord(item)) return undefined;
        const member = ownValue(item, 'member');
        const port = ownValue(item, 'port');
        const width = normalizeWidth(ownValue(item, 'width'));
        if (!identifier(member) || !identifier(port) || width === false || width === undefined) {
            return undefined;
        }
        members.push({ member, port, width });
    }
    return { endpoint, protocol, role, members };
}

function normalizePresentationNodes(
    value: unknown
): ArchDesignPresentation['nodes'] | undefined | false {
    if (value === undefined) return undefined;
    if (!isRecord(value)) return false;
    const nodes: Record<string, NonNullable<ArchDesignPresentation['nodes']>[string]> = {};
    let count = 0;
    for (const key of Object.keys(value)) {
        if (!Object.prototype.propertyIsEnumerable.call(value, key)
            || !nonEmptyString(key)) return false;
        count += 1;
        if (count > MAX_AD_PRESENTATION_NODES) return false;
        const candidate = value[key];
        if (!isRecord(candidate)) return false;
        const column = ownValue(candidate, 'column');
        const order = ownValue(candidate, 'order');
        const offset = ownValue(candidate, 'offset');
        const userPositioned = ownValue(candidate, 'userPositioned');
        if (!boundedInteger(column, MAX_AD_PRESENTATION_COLUMN)
            || !boundedInteger(order, MAX_AD_PRESENTATION_NODES)
            || (offset !== undefined && !finiteCoordinate(offset))
            || (userPositioned !== undefined && typeof userPositioned !== 'boolean')) {
            return false;
        }
        defineOwn(nodes, key, {
            column,
            order,
            ...(offset === undefined ? {} : { offset }),
            ...(userPositioned === undefined ? {} : { userPositioned }),
        });
    }
    return nodes;
}

function normalizeBooleanDictionary(
    value: unknown
): Readonly<Record<string, boolean>> | undefined | false {
    if (value === undefined) return undefined;
    if (!isRecord(value)) return false;
    const result: Record<string, boolean> = {};
    let count = 0;
    for (const key of Object.keys(value)) {
        if (!Object.prototype.propertyIsEnumerable.call(value, key)
            || !nonEmptyString(key)) return false;
        count += 1;
        if (count > MAX_AD_DICTIONARY_ENTRIES || typeof value[key] !== 'boolean') {
            return false;
        }
        defineOwn(result, key, value[key] as boolean);
    }
    return result;
}

function normalizeArchDesignPresentation(value: unknown): ArchDesignPresentation | undefined {
    if (!isRecord(value)) return undefined;
    const nodes = normalizePresentationNodes(ownValue(value, 'nodes'));
    const collapsedInterfaces = normalizeBooleanDictionary(
        ownValue(value, 'collapsedInterfaces')
    );
    if (nodes === false || collapsedInterfaces === false) return undefined;
    return {
        ...(nodes === undefined ? {} : { nodes }),
        ...(collapsedInterfaces === undefined ? {} : { collapsedInterfaces }),
    };
}

function normalizeArchDesignEdit(value: unknown): ArchDesignEdit | undefined {
    if (!isRecord(value)) return undefined;
    const type = ownValue(value, 'type');
    switch (type) {
        case 'addInstance': {
            const instance = normalizeInstance(ownValue(value, 'instance'));
            return instance ? { type, instance } : undefined;
        }
        case 'renameInstance':
        case 'renameConnection': {
            const name = ownValue(value, 'name');
            const nextName = ownValue(value, 'nextName');
            return identifier(name) && identifier(nextName)
                ? { type, name, nextName }
                : undefined;
        }
        case 'removeInstance':
        case 'removePort':
        case 'removeConnection': {
            const name = ownValue(value, 'name');
            return identifier(name) ? { type, name } : undefined;
        }
        case 'setInstanceParameter': {
            const instance = ownValue(value, 'instance');
            const parameter = ownValue(value, 'parameter');
            const parameterValue = ownValue(value, 'value');
            if (!identifier(instance) || !identifier(parameter)) return undefined;
            if (parameterValue !== undefined
                && typeof parameterValue !== 'string'
                && typeof parameterValue !== 'boolean'
                && (typeof parameterValue !== 'number' || !Number.isFinite(parameterValue))) {
                return undefined;
            }
            if (typeof parameterValue === 'string'
                && parameterValue.length > MAX_AD_STRING_LENGTH) return undefined;
            return {
                type,
                instance,
                parameter,
                ...(parameterValue === undefined ? {} : { value: parameterValue }),
            };
        }
        case 'addLogic': {
            const logic = normalizeLogic(ownValue(value, 'logic'));
            return logic ? { type, logic } : undefined;
        }
        case 'updateLogic': {
            const name = ownValue(value, 'name');
            const logic = normalizeLogic(ownValue(value, 'logic'));
            return identifier(name) && logic ? { type, name, logic } : undefined;
        }
        case 'removeLogic': {
            const name = ownValue(value, 'name');
            return identifier(name) ? { type, name } : undefined;
        }
        case 'addPort': {
            const port = normalizePort(ownValue(value, 'port'));
            return port ? { type, port } : undefined;
        }
        case 'promotePort': {
            const source = normalizeEndpoint(ownValue(value, 'source'));
            const port = normalizePort(ownValue(value, 'port'));
            const connection = ownValue(value, 'connection');
            return source?.kind === 'instance' && port && identifier(connection)
                ? { type, source, port, connection }
                : undefined;
        }
        case 'updatePort': {
            const name = ownValue(value, 'name');
            const port = normalizePort(ownValue(value, 'port'));
            return identifier(name) && port ? { type, name, port } : undefined;
        }
        case 'connect': {
            const source = normalizeEndpoint(ownValue(value, 'source'));
            const target = normalizeEndpoint(ownValue(value, 'target'));
            return source && target ? { type, source, target } : undefined;
        }
        case 'disconnect': {
            const connection = ownValue(value, 'connection');
            const endpoint = normalizeEndpoint(ownValue(value, 'endpoint'));
            return identifier(connection) && endpoint
                ? { type, connection, endpoint }
                : undefined;
        }
        case 'setInterfaceOverride': {
            const instance = ownValue(value, 'instance');
            const interfaceName = ownValue(value, 'interface');
            const protocol = ownValue(value, 'protocol');
            const role = ownValue(value, 'role');
            if (!identifier(instance)
                || !identifier(interfaceName)
                || (protocol !== undefined && !nonEmptyString(protocol))
                || (role !== undefined && role !== 'master' && role !== 'slave')
                || (protocol === undefined && role === undefined)) return undefined;
            return {
                type,
                instance,
                interface: interfaceName,
                ...(protocol === undefined ? {} : { protocol }),
                ...(role === undefined ? {} : { role }),
            };
        }
        case 'clearInterfaceOverride': {
            const instance = ownValue(value, 'instance');
            const interfaceName = ownValue(value, 'interface');
            return identifier(instance) && identifier(interfaceName)
                ? { type, instance, interface: interfaceName }
                : undefined;
        }
        case 'connectInterface': {
            const connection = normalizeInterfaceConnection(ownValue(value, 'connection'));
            return connection ? { type, connection } : undefined;
        }
        case 'removeInterfaceConnection':
        case 'removeInterfacePort': {
            const name = ownValue(value, 'name');
            return identifier(name) ? { type, name } : undefined;
        }
        case 'setInterfaceDefault': {
            const connection = ownValue(value, 'connection');
            const member = ownValue(value, 'member');
            const expression = ownValue(value, 'expression');
            if (!identifier(connection)
                || !identifier(member)
                || (expression !== undefined && !nonEmptyString(expression))) return undefined;
            return {
                type,
                connection,
                member,
                ...(expression === undefined ? {} : { expression }),
            };
        }
        case 'promoteInterface': {
            const source = normalizeInterfaceSnapshot(ownValue(value, 'source'));
            const port = ownValue(value, 'port');
            const memberPrefix = ownValue(value, 'memberPrefix');
            const connection = ownValue(value, 'connection');
            return source && identifier(port) && identifier(memberPrefix) && identifier(connection)
                ? { type, source, port, memberPrefix, connection }
                : undefined;
        }
        case 'resyncInterfacePort': {
            const port = ownValue(value, 'port');
            const source = normalizeInterfaceSnapshot(ownValue(value, 'source'));
            return identifier(port) && source ? { type, port, source } : undefined;
        }
        case 'renameInterfacePort': {
            const name = ownValue(value, 'name');
            const nextName = ownValue(value, 'nextName');
            const nextMemberPrefix = ownValue(value, 'nextMemberPrefix');
            if (!identifier(name)
                || !identifier(nextName)
                || (nextMemberPrefix !== undefined && !identifier(nextMemberPrefix))) {
                return undefined;
            }
            return {
                type,
                name,
                nextName,
                ...(nextMemberPrefix === undefined ? {} : { nextMemberPrefix }),
            };
        }
        case 'setDefault': {
            const endpoint = ownValue(value, 'endpoint');
            const expression = ownValue(value, 'expression');
            const connection = ownValue(value, 'connection');
            if (!nonEmptyString(endpoint)
                || (expression !== undefined && !nonEmptyString(expression))
                || (connection !== undefined && !identifier(connection))) return undefined;
            return {
                type,
                endpoint,
                ...(expression === undefined ? {} : { expression }),
                ...(connection === undefined ? {} : { connection }),
            };
        }
        case 'setExport': {
            const language = ownValue(value, 'language');
            const output = ownValue(value, 'output');
            if (language !== undefined
                && language !== 'verilog'
                && language !== 'systemverilog') return undefined;
            if (output !== undefined && !nonEmptyString(output)) return undefined;
            return {
                type,
                ...(language === undefined ? {} : { language }),
                ...(output === undefined ? {} : { output }),
            };
        }
        case 'setPresentation': {
            const presentation = normalizeArchDesignPresentation(
                ownValue(value, 'presentation')
            );
            return presentation ? { type, presentation } : undefined;
        }
        default:
            return undefined;
    }
}

function normalizeSourceSpan(value: unknown): SourceSpan | undefined {
    if (!isRecord(value)) {
        return undefined;
    }

    const start = ownValue(value, 'start');
    const end = ownValue(value, 'end');
    const uri = ownValue(value, 'uri');
    const compositeParts = ownValue(value, 'compositeParts');
    if (!sourceOffset(start)
        || !sourceOffset(end)
        || start > end
        || (uri !== undefined && !nonEmptyString(uri))) {
        return undefined;
    }

    let parts: unknown[] | undefined;
    let partCount = 0;
    if (compositeParts !== undefined) {
        if (!Array.isArray(compositeParts)) {
            return undefined;
        }
        parts = compositeParts;
        partCount = parts.length;
        if (partCount > MAX_COMPOSITE_PARTS) {
            return undefined;
        }
    }

    const span: SourceSpan = { start, end };
    if (uri !== undefined) {
        span.uri = uri;
    }
    if (parts !== undefined) {
        const normalizedParts: NonNullable<SourceSpan['compositeParts']> = [];
        for (let index = 0; index < partCount; index += 1) {
            if (!Object.prototype.propertyIsEnumerable.call(parts, index)) {
                return undefined;
            }
            const candidate = parts[index];
            if (!isRecord(candidate)) {
                return undefined;
            }
            const partUri = ownValue(candidate, 'uri');
            const partStart = ownValue(candidate, 'start');
            const partEnd = ownValue(candidate, 'end');
            if (!nonEmptyString(partUri)
                || !sourceOffset(partStart)
                || !sourceOffset(partEnd)
                || partStart > partEnd) {
                return undefined;
            }
            const part = { uri: partUri, start: partStart, end: partEnd };
            normalizedParts.push(part);
        }
        span.compositeParts = normalizedParts;
    }
    return span;
}

export function parseWebviewCommand(value: unknown): WebviewCommand | undefined {
    try {
        if (!isRecord(value)) {
            return undefined;
        }

        const type = ownValue(value, 'type');
        if (typeof type !== 'string') {
            return undefined;
        }

        switch (type) {
            case 'ready':
                return { type: 'ready' };
            case 'selectModule': {
                const moduleKey = ownValue(value, 'moduleKey');
                return nonEmptyString(moduleKey)
                    ? { type: 'selectModule', moduleKey }
                    : undefined;
            }
            case 'saveLayout': {
                const moduleKey = ownValue(value, 'moduleKey');
                const revision = ownValue(value, 'revision');
                if (!nonEmptyString(moduleKey) || !nonEmptyString(revision)) {
                    return undefined;
                }
                const layout = normalizeSchematicLayout(ownValue(value, 'layout'));
                return layout
                    ? { type: 'saveLayout', moduleKey, revision, layout }
                    : undefined;
            }
            case 'revealSource': {
                const span = normalizeSourceSpan(ownValue(value, 'span'));
                return span ? { type: 'revealSource', span } : undefined;
            }
            case 'openDefinition': {
                const definitionKey = ownValue(value, 'definitionKey');
                return nonEmptyString(definitionKey)
                    ? { type: 'openDefinition', definitionKey }
                    : undefined;
            }
            case 'search': {
                const query = ownValue(value, 'query');
                return typeof query === 'string' ? { type: 'search', query } : undefined;
            }
            case 'relayoutAll': {
                const moduleKey = ownValue(value, 'moduleKey');
                const revision = ownValue(value, 'revision');
                return nonEmptyString(moduleKey) && nonEmptyString(revision)
                    ? { type: 'relayoutAll', moduleKey, revision }
                    : undefined;
            }
            case 'editSchematic':
            case 'editArchDesign': {
                const revision = ownValue(value, 'revision');
                const edit = normalizeArchDesignEdit(ownValue(value, 'edit'));
                return nonEmptyString(revision) && edit
                    ? { type, revision, edit }
                    : undefined;
            }
            case 'simulationTaskCommand': {
                const revision = ownValue(value, 'revision');
                const command = ownValue(value, 'command');
                const actions: readonly string[] = ['addPreset', 'updatePreset', 'updateTaskSettings',
                    'generateTestbench', 'run', 'cancel', 'openWave'];
                const payload = ownValue(value, 'payload');
                if (!nonEmptyString(revision) || typeof command !== 'string' || !actions.includes(command)) return undefined;
                if (command === 'addPreset' || command === 'updatePreset') {
                    if (!isRecord(payload) || !identifier(ownValue(payload, 'id'))
                        || !validSimulationPreset(ownValue(payload, 'preset'))
                        || !onlyKeys(payload, ['id', 'preset'])) return undefined;
                } else if (command === 'updateTaskSettings') {
                    if (!isRecord(payload) || !onlyKeys(payload, ['settings'])
                        || !validSimulationSettings(ownValue(payload, 'settings'))) return undefined;
                } else if (payload !== undefined) return undefined;
                return { type, revision, command: command as SimulationTaskAction,
                    ...(payload === undefined ? {} : { payload }) };
            }
            case 'exportArchDesign': {
                const revision = ownValue(value, 'revision');
                return nonEmptyString(revision)
                    ? { type: 'exportArchDesign', revision }
                    : undefined;
            }
            default:
                return undefined;
        }
    } catch {
        return undefined;
    }
}
