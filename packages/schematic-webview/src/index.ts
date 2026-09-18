import { defaultSimulationPreset, projectSimulationTaskInspector, TransitionValidationError, type AuthoringInspectorModel } from './authoring/taskInspector';
import type { SimulationTaskViewState } from '../../../veriflow-vscode/src/schematic/protocol';
import {
    Graph,
    MiniMap,
    Selection,
    type Cell,
    type Edge,
    type Node,
} from '@antv/x6';
import {
    SquarePlus as AddBox,
    Cable,
    ChevronDown,
    ChevronUp,
    Component,
    createElement,
    FileOutput,
    Activity,
    Play,
    Square,
    Waves,
    Map as MapIcon,
    Maximize2,
    PanelTopOpen,
    PanelRightClose,
    PanelRightOpen,
    RefreshCw,
    Scan,
    Search as SearchIcon,
    Trash2,
    Workflow,
    type IconNode,
} from 'lucide';

import {
    assignColumns,
    createPlacement,
    layoutSchematic,
    snapNodesToPlacement,
    SCHEMATIC_NETWORK_LABEL_LAYOUT,
    SCHEMATIC_NODE_LAYOUT,
    SCHEMATIC_TEXT_STYLES,
    schematicPinTextStyle,
    type GraphNode,
    type GraphNodeKind,
    type GraphPin,
    type NetworkRoute,
    type RenderedNodeGeometry,
    type RouteSegment,
    type SchematicGraph,
    type SchematicNodeBodyShape,
    type SchematicRenderModel,
    type SchematicNetwork,
    type TextMeasurementStyle,
} from '@veriflow/schematic-core';
import type {
    ArchDesignEdit,
    ArchDesignInterfaceEndpoint,
    ArchDesignLogic,
    ArchDesignPresentation,
    ArchDesignPortDirection,
    ArchDesignWidth,
} from '@veriflow/schematic-core/arch-design';
import { isSafeDefaultExpression } from '../../schematic-core/src/archDesign/defaults';
import type { SchematicLayout } from '../../../veriflow-vscode/src/schematic/layoutStore';
import type { HostEvent, WebviewCommand } from '../../../veriflow-vscode/src/schematic/protocol';
import {
    archDesignEndpointForPin,
    canConnectScalarPins,
    ARCH_DESIGN_LOGIC_OPERATION_OPTIONS,
    cloneSchematicLayout,
    DebouncedLayoutSaveScheduler,
    formatSchematicDiagnosticDetails,
    mergeSchematicWebviewLayouts,
    navigationCommandForCell,
    projectArchDesignInspector,
    projectSchematicInspector,
    summarizeSchematicSelection,
    type ArchDesignInspectorModel,
    type SchematicInspectorModel,
} from '../../../veriflow-vscode/src/schematic/webviewSupport';

type PersistedWebviewState = { layouts?: Record<string, SchematicLayout> };
type VsCodeApi = {
    postMessage(message: WebviewCommand): void;
    getState(): PersistedWebviewState | undefined;
    setState(state: PersistedWebviewState): void;
};

declare global {
    interface Window {
        acquireVsCodeApi?: () => VsCodeApi;
    }
}

type CellData = {
    objectId: string;
    objectType: 'node' | 'network';
    node?: GraphNode;
    network?: SchematicNetwork;
    networkRoute?: NetworkRoute;
    junction?: boolean;
};

type ScalarConnectionTerminal = Readonly<{
    kind: 'scalar';
    endpoint: NonNullable<ReturnType<typeof archDesignEndpointForPin>>;
    pin: GraphNode['pins'][number];
}>;

type InterfaceConnectionTerminal = Readonly<{
    kind: 'interface';
    endpoint: ArchDesignInterfaceEndpoint;
    effectiveRole: 'master' | 'slave';
    protocol: string;
    pin: GraphNode['pins'][number];
}>;

type ConnectionTerminal = ScalarConnectionTerminal | InterfaceConnectionTerminal;

type SearchMatch = { cell: Cell; objectId: string; description: string };

const MIN_ZOOM = 0.1;
const MAX_ZOOM = 4;
const SAVE_DELAY_MS = 250;

const shapeNames: Record<GraphNodeKind, string> = {
    port: 'veriflow-port',
    instance: 'veriflow-instance',
    constant: 'veriflow-constant',
    expression: 'veriflow-expression',
    opaque: 'veriflow-opaque',
    generateArray: 'veriflow-generate-array',
};

const shapeAccents: Record<GraphNodeKind, string> = {
    port: 'var(--vscode-charts-green, #16825d)',
    instance: 'var(--vscode-charts-blue, #2472c8)',
    constant: 'var(--vscode-charts-yellow, #b89500)',
    expression: 'var(--vscode-charts-purple, #8b5cf6)',
    opaque: 'var(--vscode-charts-red, #c74e39)',
    generateArray: 'var(--vscode-charts-orange, #c76b29)',
};

const boundaryBodyPaths: Record<SchematicNodeBodyShape, string> = {
    rectangle: 'M 0 0 H 96 V 40 H 0 Z',
    'directional-port': 'M 0 0 H 80 L 96 20 L 80 40 H 0 Z',
    'bidirectional-port': 'M 16 0 H 80 L 96 20 L 80 40 H 16 L 0 20 Z',
};

const boundaryBodyClasses: Record<SchematicNodeBodyShape, string> = {
    rectangle: 'veriflow-boundary-rectangle',
    'directional-port': 'veriflow-boundary-directional',
    'bidirectional-port': 'veriflow-boundary-bidirectional',
};

const dom = {
    shell: requiredElement<HTMLElement>('schematic-shell'),
    canvas: requiredElement<HTMLDivElement>('canvas'),
    canvasRegion: requiredElement<HTMLElement>('canvas-region'),
    canvasState: requiredElement<HTMLDivElement>('canvas-state'),
    canvasStateMessage: requiredElement<HTMLSpanElement>('canvas-state-message'),
    moduleSelector: requiredElement<HTMLSelectElement>('module-selector'),
    fitButton: requiredElement<HTMLButtonElement>('fit-button'),
    zoomResetButton: requiredElement<HTMLButtonElement>('zoom-reset-button'),
    relayoutButton: requiredElement<HTMLButtonElement>('relayout-button'),
    searchButton: requiredElement<HTMLButtonElement>('search-button'),
    searchControls: requiredElement<HTMLDivElement>('search-controls'),
    searchInput: requiredElement<HTMLInputElement>('search-input'),
    searchPreviousButton: requiredElement<HTMLButtonElement>('search-previous-button'),
    searchNextButton: requiredElement<HTMLButtonElement>('search-next-button'),
    minimapButton: requiredElement<HTMLButtonElement>('minimap-button'),
    minimap: requiredElement<HTMLDivElement>('minimap'),
    inspectorToggleButton: requiredElement<HTMLButtonElement>('inspector-toggle-button'),
    authoringActions: requiredElement<HTMLDivElement>('authoring-actions'),
    addInstanceButton: requiredElement<HTMLButtonElement>('add-instance-button'),
    addLogicButton: requiredElement<HTMLButtonElement>('add-logic-button'),
    addSimulationButton: requiredElement<HTMLButtonElement>('add-simulation-button'),
    runTaskButton: requiredElement<HTMLButtonElement>('run-task-button'),
    waveTaskButton: requiredElement<HTMLButtonElement>('wave-task-button'),
    taskStatus: requiredElement<HTMLSpanElement>('task-status'),
    addSimulationDialog: requiredElement<HTMLDialogElement>('add-simulation-dialog'),
    addSimulationForm: requiredElement<HTMLFormElement>('add-simulation-form'),
    simulationKindSelect: requiredElement<HTMLSelectElement>('simulation-kind-select'),
    simulationNameInput: requiredElement<HTMLInputElement>('simulation-name-input'),
    addPortButton: requiredElement<HTMLButtonElement>('add-port-button'),
    connectButton: requiredElement<HTMLButtonElement>('connect-button'),
    exportButton: requiredElement<HTMLButtonElement>('export-button'),
    deleteButton: requiredElement<HTMLButtonElement>('delete-button'),
    inspector: requiredElement<HTMLElement>('inspector'),
    inspectorTitle: requiredElement<HTMLHeadingElement>('inspector-title'),
    inspectorMode: requiredElement<HTMLSpanElement>('inspector-mode'),
    inspectorProperties: requiredElement<HTMLDListElement>('inspector-properties'),
    inspectorForm: requiredElement<HTMLFormElement>('inspector-form'),
    addInstanceDialog: requiredElement<HTMLDialogElement>('add-instance-dialog'),
    addInstanceForm: requiredElement<HTMLFormElement>('add-instance-form'),
    instanceModuleFilter: requiredElement<HTMLInputElement>('instance-module-filter'),
    instanceNameInput: requiredElement<HTMLInputElement>('instance-name-input'),
    instanceModuleSelect: requiredElement<HTMLSelectElement>('instance-module-select'),
    addInstanceSubmit: requiredElement<HTMLButtonElement>('add-instance-submit'),
    addLogicDialog: requiredElement<HTMLDialogElement>('add-logic-dialog'),
    addLogicForm: requiredElement<HTMLFormElement>('add-logic-form'),
    logicOperationSelect: requiredElement<HTMLSelectElement>('new-logic-operation-select'),
    logicNameInput: requiredElement<HTMLInputElement>('new-logic-name-input'),
    logicWidthField: requiredElement<HTMLDivElement>('new-logic-width-field'),
    logicWidthInput: requiredElement<HTMLInputElement>('new-logic-width-input'),
    logicExpressionField: requiredElement<HTMLDivElement>('new-logic-expression-field'),
    logicExpressionInput: requiredElement<HTMLInputElement>('new-logic-expression-input'),
    logicInputCountField: requiredElement<HTMLDivElement>('new-logic-input-count-field'),
    logicInputCountInput: requiredElement<HTMLInputElement>('new-logic-input-count-input'),
    logicInputWidthsField: requiredElement<HTMLFieldSetElement>('new-logic-input-widths-field'),
    logicInputWidths: requiredElement<HTMLDivElement>('new-logic-input-widths'),
    logicInputWidthField: requiredElement<HTMLDivElement>('new-logic-input-width-field'),
    logicInputWidthInput: requiredElement<HTMLInputElement>('new-logic-input-width-input'),
    logicOutputWidthField: requiredElement<HTMLDivElement>('new-logic-output-width-field'),
    logicOutputWidthInput: requiredElement<HTMLInputElement>('new-logic-output-width-input'),
    logicSliceFields: requiredElement<HTMLDivElement>('new-logic-slice-fields'),
    logicMsbInput: requiredElement<HTMLInputElement>('new-logic-msb-input'),
    logicLsbInput: requiredElement<HTMLInputElement>('new-logic-lsb-input'),
    logicCountField: requiredElement<HTMLDivElement>('new-logic-count-field'),
    logicCountInput: requiredElement<HTMLInputElement>('new-logic-count-input'),
    addPortDialog: requiredElement<HTMLDialogElement>('add-port-dialog'),
    addPortForm: requiredElement<HTMLFormElement>('add-port-form'),
    portNameInput: requiredElement<HTMLInputElement>('port-name-input'),
    portDirectionSelect: requiredElement<HTMLSelectElement>('port-direction-select'),
    portInoutModeLabel: requiredElement<HTMLLabelElement>('port-inout-mode-label'),
    portInoutModeSelect: requiredElement<HTMLSelectElement>('port-inout-mode-select'),
    portWidthInput: requiredElement<HTMLInputElement>('port-width-input'),
    errorCount: requiredElement<HTMLSpanElement>('error-count'),
    warningCount: requiredElement<HTMLButtonElement>('warning-count'),
    diagnosticsDialog: requiredElement<HTMLDialogElement>('diagnostics-dialog'),
    diagnosticsTitle: requiredElement<HTMLHeadingElement>('diagnostics-title'),
    diagnosticsDetails: requiredElement<HTMLElement>('diagnostics-details'),
    selectionStatus: requiredElement<HTMLSpanElement>('selection-status'),
    diagnosticStatus: requiredElement<HTMLSpanElement>('diagnostic-status'),
};
const inspectorCommitters = new WeakMap<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement, () => void>();

function requiredElement<T extends HTMLElement>(id: string): T {
    const element = document.getElementById(id);
    if (!element) throw new Error(`Missing schematic element #${id}`);
    return element as T;
}

function previewApi(): VsCodeApi {
    let state: PersistedWebviewState | undefined;
    return {
        postMessage(message): void {
            window.dispatchEvent(new CustomEvent('veriflow:webview-message', {
                detail: message,
            }));
        },
        getState(): PersistedWebviewState | undefined {
            return state;
        },
        setState(nextState): void {
            state = nextState;
        },
    };
}

const vscode = typeof window.acquireVsCodeApi === 'function'
    ? window.acquireVsCodeApi()
    : previewApi();

let textMeasureContext: CanvasRenderingContext2D | null | undefined;

function measureNodeText(text: string, style: TextMeasurementStyle): number {
    if (textMeasureContext === undefined) {
        textMeasureContext = document.createElement('canvas').getContext('2d');
    }
    if (textMeasureContext) {
        const fontFamily = getComputedStyle(document.documentElement)
            .getPropertyValue('--vscode-font-family').trim() || 'sans-serif';
        textMeasureContext.font = `${style.fontWeight} ${style.fontSize}px ${fontFamily}`;
        const width = textMeasureContext.measureText(text).width;
        if (Number.isFinite(width) && width >= 0) return width;
    }
    const weightFactor = style.fontWeight === 600 ? 0.62 : 0.56;
    return text.length * style.fontSize * weightFactor;
}

function registerShapes(): void {
    for (const [kind, shapeName] of Object.entries(shapeNames) as Array<[
        GraphNodeKind,
        string,
    ]>) {
        Graph.registerNode(shapeName, {
            inherit: 'rect',
            width: kind === 'port'
                ? SCHEMATIC_NODE_LAYOUT.portWidth
                : SCHEMATIC_NODE_LAYOUT.minimumWidth,
            height: kind === 'port'
                ? SCHEMATIC_NODE_LAYOUT.portHeight
                : SCHEMATIC_NODE_LAYOUT.minimumHeight,
            markup: [
                ...(kind === 'port' ? [
                    { tagName: 'rect', selector: 'bg' },
                    { tagName: 'path', selector: 'body' },
                ] : [
                    { tagName: 'rect', selector: 'body' },
                ]),
                { tagName: 'rect', selector: 'accent' },
                {
                    tagName: 'svg',
                    selector: 'labelClip',
                    className: ['veriflow-text-clip', 'veriflow-title-clip'],
                    attrs: { overflow: 'hidden' },
                    children: [{ tagName: 'text', selector: 'label' }],
                },
                {
                    tagName: 'svg',
                    selector: 'subtitleClip',
                    className: ['veriflow-text-clip', 'veriflow-subtitle-clip'],
                    attrs: { overflow: 'hidden' },
                    children: [{ tagName: 'text', selector: 'subtitle' }],
                },
            ],
            portMarkup: [{ tagName: 'circle', selector: 'portBody' }],
            portLabelMarkup: [
                {
                    tagName: 'g',
                    selector: 'portLabelContainer',
                    children: [
                        { tagName: 'rect', selector: 'portLabelHitArea' },
                        {
                            tagName: 'svg',
                            selector: 'portLabelClip',
                            className: ['veriflow-text-clip', 'veriflow-pin-clip'],
                            attrs: { overflow: 'hidden' },
                            children: [{ tagName: 'text', selector: 'text' }],
                        },
                    ],
                },
            ],
            attrs: {
                ...(kind === 'port' ? {
                    bg: {
                        refWidth: '100%',
                        refHeight: '100%',
                        fill: 'transparent',
                        stroke: 'none',
                        pointerEvents: 'all',
                    },
                } : {}),
                body: {
                    ...(kind === 'port' ? {
                        refD: boundaryBodyPaths.rectangle,
                        class: boundaryBodyClasses.rectangle,
                        pointerEvents: 'none',
                    } : {}),
                    fill: 'var(--schematic-node-fill)',
                    stroke: 'var(--schematic-node-border)',
                    strokeWidth: 1.5,
                    rx: 3,
                    ry: 3,
                    strokeLinejoin: 'round',
                },
                accent: {
                    x: 0,
                    y: 0,
                    width: 4,
                    height: '100%',
                    fill: shapeAccents[kind],
                    stroke: 'none',
                    class: 'veriflow-node-accent',
                },
                label: {
                    refX: 0,
                    refY: 0,
                    x: 0,
                    y: SCHEMATIC_NODE_LAYOUT.labelHeight / 2,
                    fill: 'var(--schematic-text)',
                    fontFamily: 'var(--vscode-font-family, sans-serif)',
                    fontSize: SCHEMATIC_TEXT_STYLES.title.fontSize,
                    fontWeight: SCHEMATIC_TEXT_STYLES.title.fontWeight,
                    textAnchor: 'start',
                    textVerticalAnchor: 'middle',
                    pointerEvents: 'none',
                },
                subtitle: {
                    refX: 0,
                    refY: 0,
                    x: 0,
                    y: SCHEMATIC_NODE_LAYOUT.labelHeight / 2,
                    fill: 'var(--schematic-muted-text)',
                    fontFamily: 'var(--vscode-font-family, sans-serif)',
                    fontSize: SCHEMATIC_TEXT_STYLES.subtitle.fontSize,
                    fontWeight: SCHEMATIC_TEXT_STYLES.subtitle.fontWeight,
                    textAnchor: 'start',
                    textVerticalAnchor: 'middle',
                },
            },
        }, true);
    }

    Graph.registerEdge('veriflow-network', {
        inherit: 'edge',
        connector: { name: 'normal' },
        attrs: {
            line: {
                fill: 'none',
                stroke: 'var(--schematic-wire)',
                strokeWidth: 1,
                strokeLinejoin: 'round',
                strokeLinecap: 'square',
            },
        },
    }, true);
}

registerShapes();

function portGroups() {
    const body = {
        magnet: false,
        r: 3,
        fill: 'var(--schematic-node-fill)',
        stroke: 'var(--schematic-pin)',
        strokeWidth: 1.5,
    };
    return {
        left: {
            position: { name: 'absolute' },
            attrs: { portBody: body },
            label: {
                position: {
                    name: 'right',
                    args: { x: SCHEMATIC_NODE_LAYOUT.pinLabelInset },
                },
            },
        },
        right: {
            position: { name: 'absolute' },
            attrs: { portBody: body },
            label: {
                position: {
                    name: 'left',
                    args: { x: -SCHEMATIC_NODE_LAYOUT.pinLabelInset },
                },
            },
        },
    };
}

const interfaceColor = 'var(--schematic-interface-wire)';

type InoutPinSemantic = 'o' | 't' | 'i';

const inoutPinDescriptions: Readonly<Record<InoutPinSemantic, string>> = {
    o: 'Output drive (O)',
    t: 'Tri-state enable (T)',
    i: 'Input sense (I)',
};

function inoutPinSemantic(
    node: GraphNode,
    pin: GraphPin
): InoutPinSemantic | undefined {
    if (node.kind !== 'port' || node.pins.length !== 3) return undefined;
    const expectedDirections: Readonly<Record<InoutPinSemantic, GraphPin['direction']>> = {
        o: 'load',
        t: 'load',
        i: 'driver',
    };
    const semantics: readonly InoutPinSemantic[] = ['o', 't', 'i'];
    const matches = semantics.map(semantic => node.pins.filter(candidate =>
        candidate.direction === expectedDirections[semantic]
            && (candidate.name === semantic
                || candidate.name === `${node.label}_${semantic}`)
    ));
    if (matches.some(candidates => candidates.length !== 1)) return undefined;
    return semantics.find((semantic, index) => matches[index][0].id === pin.id);
}

function pinItems(
    model: GraphNode,
    rendered: RenderedNodeGeometry
): object[] {
    const pinsById = new Map(model.pins.map(pin => [pin.id, pin]));
    return rendered.pins.map(pin => {
        const source = pinsById.get(pin.id);
        const inoutSemantic = source === undefined
            ? undefined
            : inoutPinSemantic(model, source);
        const inoutDescription = inoutSemantic === undefined
            ? undefined
            : inoutPinDescriptions[inoutSemantic];
        return {
            id: pin.id,
            group: pin.side,
            ...(inoutSemantic === 't' ? {
                markup: [
                    {
                        tagName: 'circle',
                        selector: 'portHalo',
                        attrs: {
                            fill: 'none',
                            pointerEvents: 'none',
                        },
                    },
                    { tagName: 'circle', selector: 'portBody' },
                ],
            } : {}),
            args: {
                x: pin.anchor.x - rendered.bounds.x,
                y: pin.anchor.y - rendered.bounds.y,
            },
            attrs: {
                ...(inoutSemantic === 't'
                    ? {
                        portHalo: {
                            r: 6,
                            class: 'veriflow-inout-t-ring',
                        },
                    }
                    : {}),
                portBody: {
                    magnet: source !== undefined && pinConnectable(source),
                    strokeDasharray: source?.readOnly ? '2 1' : undefined,
                    ...(inoutSemantic === undefined ? {} : {
                        class: [
                            'x6-port-body',
                            'veriflow-inout-pin',
                            `veriflow-inout-pin-${inoutSemantic}`,
                        ].join(' '),
                        title: inoutDescription,
                        'aria-label': inoutDescription,
                    }),
                    ...(source?.interface === undefined ? {} : { class: [
                            'x6-port-body',
                            'veriflow-interface-pin',
                            `veriflow-interface-${source.interface.role}`,
                            `veriflow-interface-${source.interface.kind}`,
                        ].join(' ') }),
                    r: source?.interface?.kind === 'aggregate' ? 4 : 3,
                    fill: source?.interface === undefined
                        ? 'var(--schematic-node-fill)'
                        : 'var(--schematic-interface-pin-fill)',
                    stroke: source?.interface === undefined
                        ? 'var(--schematic-pin)'
                        : interfaceColor,
                    strokeWidth: source?.interface?.kind === 'aggregate' ? 2 : 1.5,
                },
                portLabelClip: {
                    x: pin.side === 'left' ? 0 : -pin.clipBounds.width,
                    y: -pin.clipBounds.height / 2,
                    width: pin.clipBounds.width,
                    height: pin.clipBounds.height,
                },
                portLabelHitArea: {
                    port: pin.id,
                    x: pin.side === 'left' ? 0 : -pin.clipBounds.width,
                    y: -pin.clipBounds.height / 2,
                    width: pin.clipBounds.width,
                    height: pin.clipBounds.height,
                    fill: 'transparent',
                    stroke: 'none',
                    class: 'veriflow-pin-label-hit-area',
                    pointerEvents: 'all',
                    cursor: 'pointer',
                },
                text: {
                    text: pin.visibleLabel,
                    title: pin.name,
                    x: pin.side === 'left' ? 0 : pin.clipBounds.width,
                    y: pin.clipBounds.height / 2,
                    fill: source?.interface === undefined
                        ? 'var(--schematic-text)'
                        : interfaceColor,
                    class: source?.interface === undefined
                        ? 'veriflow-pin-label'
                        : 'veriflow-pin-label veriflow-interface-label',
                    fontFamily: 'var(--vscode-font-family, sans-serif)',
                    fontSize: schematicPinTextStyle(source).fontSize,
                    fontWeight: schematicPinTextStyle(source).fontWeight,
                    textAnchor: pin.side === 'left' ? 'start' : 'end',
                    textVerticalAnchor: 'middle',
                    pointerEvents: 'none',
                },
            },
        };
    });
}

function relativeBounds(
    bounds: Readonly<{ x: number; y: number; width: number; height: number }>,
    nodeBounds: RenderedNodeGeometry['bounds']
): { x: number; y: number; width: number; height: number } {
    return {
        x: bounds.x - nodeBounds.x,
        y: bounds.y - nodeBounds.y,
        width: bounds.width,
        height: bounds.height,
    };
}

function createRenderedNode(
    model: GraphNode,
    rendered: RenderedNodeGeometry
): Node {
    const { width, height } = rendered.bounds;
    const topInterface = model.pins.find(pin => pin.interface?.topLevel)?.interface;
    const titleBounds = relativeBounds(rendered.title.bounds, rendered.bounds);
    const cell = graph.addNode({
        id: model.id,
        shape: shapeNames[model.kind],
        x: rendered.bounds.x,
        y: rendered.bounds.y,
        width,
        height,
        data: {
            objectId: model.id,
            objectType: 'node',
            node: model,
        } satisfies CellData,
        attrs: {
            root: {
                tabindex: 0,
                role: 'link',
                'aria-label': `${model.kind}: ${model.label}`,
                'aria-keyshortcuts': archDesignDocument && model.definitionKey
                    ? 'Enter'
                    : model.definitionKey ? 'Enter Shift+Enter' : 'Enter',
            },
            body: {
                strokeDasharray: model.readOnly ? '4 2' : undefined,
                ...(model.kind === 'port' ? {
                    refD: boundaryBodyPaths[rendered.bodyShape],
                    class: boundaryBodyClasses[rendered.bodyShape],
                } : {}),
            },
            accent: {
                x: model.kind === 'port'
                    && rendered.bodyShape === 'bidirectional-port' ? 16 : 0,
                height,
                ...(topInterface === undefined ? {} : {
                    fill: interfaceColor,
                    class: 'veriflow-node-accent veriflow-interface-accent',
                }),
            },
            labelClip: titleBounds,
            label: {
                text: rendered.title.visibleText,
                title: rendered.title.fullText,
            },
            subtitleClip: rendered.renderedSubtitle
                ? relativeBounds(rendered.renderedSubtitle.bounds, rendered.bounds)
                : {
                x: 0,
                y: 0,
                width: 0,
                height: 0,
            },
            subtitle: {
                text: rendered.renderedSubtitle?.visibleText ?? '',
                title: rendered.renderedSubtitle?.fullText ?? '',
                pointerEvents: 'none',
            },
        },
        ports: {
            groups: portGroups(),
            items: pinItems(model, rendered),
        },
        zIndex: 2,
    });
    return cell;
}

function segmentEndpoints(segment: Readonly<RouteSegment>): readonly [
    { x: number; y: number },
    { x: number; y: number },
] {
    return segment.orientation === 'horizontal'
        ? [{ x: segment.x1, y: segment.y }, { x: segment.x2, y: segment.y }]
        : [{ x: segment.x, y: segment.y1 }, { x: segment.x, y: segment.y2 }];
}

function samePoint(
    left: Readonly<{ x: number; y: number }>,
    right: Readonly<{ x: number; y: number }>
): boolean {
    return left.x === right.x && left.y === right.y;
}

function terminatesAtLoad(
    route: NetworkRoute,
    point: Readonly<{ x: number; y: number }>
): boolean {
    return route.terminals.some(terminal =>
        terminal.role === 'load' && samePoint(terminal.point, point)
    );
}

function networkStrokeWidth(network: SchematicNetwork): number {
    if (network.renderWidth !== undefined) return network.renderWidth;
    return network.width.kind === 'known' && network.width.bits > 1 ? 2 : 1;
}

function renderNetworks(
    model: SchematicGraph,
    renderModel: SchematicRenderModel
): void {
    const networksById = new Map(model.networks.map(network => [network.id, network]));
    const routesById = new Map(renderModel.networks.map(route => [route.id, route]));
    for (const networkRoute of renderModel.networks) {
        const network = networksById.get(networkRoute.id);
        if (!network) continue;
        networkRoute.segments.forEach((segment, index) => {
            const [source, target] = segmentEndpoints(segment);
            graph.addEdge({
                id: `${networkRoute.id}:segment:${index}`,
                shape: 'veriflow-network',
                source,
                target,
                data: {
                    objectId: network.id,
                    objectType: 'network',
                    network,
                    networkRoute,
                } satisfies CellData,
                attrs: {
                    root: {
                        tabindex: 0,
                        role: 'link',
                        'aria-label': `network: ${network.name}`,
                        'aria-keyshortcuts': 'Enter',
                    },
                    line: {
                        strokeWidth: networkStrokeWidth(network),
                        stroke: network.interface === undefined
                            ? 'var(--schematic-wire)'
                            : 'var(--schematic-interface-wire)',
                        class: network.interface === undefined
                            ? undefined
                            : 'veriflow-interface-route',
                        sourceMarker: terminatesAtLoad(networkRoute, source)
                            ? { name: 'block', width: 6, height: 6 }
                            : null,
                        targetMarker: terminatesAtLoad(networkRoute, target)
                            ? { name: 'block', width: 6, height: 6 }
                            : null,
                    },
                },
                zIndex: 0,
            });
        });
    }

    renderModel.junctions.forEach((junction, index) => {
        const network = networksById.get(junction.networkId);
        const networkRoute = routesById.get(junction.networkId);
        if (!network || !networkRoute) return;
        const radius = SCHEMATIC_NETWORK_LABEL_LAYOUT.junctionRadius;
        graph.addNode({
            shape: 'circle',
            id: `${junction.networkId}:junction:${index}`,
            x: junction.point.x - radius,
            y: junction.point.y - radius,
            width: radius * 2,
            height: radius * 2,
            data: {
                objectId: network.id,
                objectType: 'network',
                network,
                networkRoute,
                junction: true,
            } satisfies CellData,
            attrs: {
                root: {
                    tabindex: 0,
                    role: 'link',
                    'aria-label': `network junction: ${network.name}`,
                    pointerEvents: 'auto',
                },
                body: {
                    class: 'veriflow-junction-dot',
                    fill: 'var(--schematic-junction)',
                    stroke: 'var(--schematic-junction)',
                    strokeWidth: 1,
                    pointerEvents: 'auto',
                },
                label: { text: '' },
            },
            zIndex: 1,
        });
    });
}

const selection = new Selection({
    enabled: true,
    multiple: true,
    rubberband: true,
    movable: true,
    strict: false,
    showNodeSelectionBox: true,
    showEdgeSelectionBox: false,
    pointerEvents: 'auto',
    eventTypes: ['leftMouseDown'],
    filter: cell => cellData(cell)?.objectType === 'node'
        && cellData(cell)?.junction !== true,
});

const graph = new Graph({
    container: dom.canvas,
    autoResize: true,
    background: { color: 'var(--schematic-canvas)' },
    grid: {
        visible: true,
        size: 16,
        type: 'dot',
        args: {
            color: 'var(--schematic-grid)',
            thickness: 1,
        },
    },
    scaling: { min: MIN_ZOOM, max: MAX_ZOOM },
    mousewheel: {
        enabled: true,
        factor: 1.1,
        minScale: MIN_ZOOM,
        maxScale: MAX_ZOOM,
        modifiers: null,
        zoomAtMousePosition: true,
    },
    panning: {
        enabled: true,
        eventTypes: ['rightMouseDown', 'mouseWheelDown'],
        modifiers: null,
    },
    interacting: {
        nodeMovable: view => cellData(view.cell)?.junction !== true,
        edgeMovable: false,
        edgeLabelMovable: false,
        arrowheadMovable: false,
        vertexMovable: false,
        vertexAddable: false,
        vertexDeletable: false,
        magnetConnectable: false,
        toolsAddable: false,
    },
    preventDefaultContextMenu: true,
});
graph.use(selection);

let currentGraph: SchematicGraph | undefined;
let currentLayout: SchematicLayout | undefined;
let currentRenderModel: SchematicRenderModel | undefined;
let currentRevision = '';
let selectedModuleKey = '';
let applyingLayout = false;
let syncingSelection = false;
let selectedNetworkId: string | undefined;
let selectedPinId: string | undefined;
let inspectorExpanded = true;
let minimapPlugin: MiniMap | undefined;
let minimapAvailable = false;
let searchMatches: SearchMatch[] = [];
let searchIndex = -1;
let errors = 0;
let warnings = 0;
let nodeMoveGeneration = 0;
let scheduledNodeMoveGeneration: number | undefined;
const pendingNodeMoves = new Map<string, { x: number; y: number }>();
let selectionBoxOrigins = new Map<string, { x: number; y: number }>();
type EditableArchDesignState = Extract<
    HostEvent,
    { type: 'archDesignState'; status: 'editable' }
>;
let simulationTaskDocument = false;
let currentTaskState: SimulationTaskViewState | undefined;
let pendingAddedNodeId: string | undefined;
let simulationNameAutomatic = true;
let capabilities: import('../../../veriflow-vscode/src/schematic/protocol').SchematicCapabilities = {};
let archDesignDocument = false;
let archDesignEditable = false;
let authoringPending = false;
let currentArchDesignState: EditableArchDesignState | undefined;
let currentArchDesignInspector: AuthoringInspectorModel | undefined;
let instanceNameAutomatic = true;
let logicNameAutomatic = true;
const autoFittedModules = new Set<string>();
let archDesignLayoutSaveInFlight = false;
let queuedArchDesignLayoutSave: Readonly<{
    moduleKey: string;
    layout: SchematicLayout;
}> | undefined;
type QueuedArchDesignCommand =
    | Readonly<{ type: 'edit'; edit: ArchDesignEdit }>
    | Readonly<{ type: 'export' }>
    | Readonly<{ type: 'task'; command: import('../../../veriflow-vscode/src/schematic/protocol').SimulationTaskAction; payload?: unknown }>;
let queuedArchDesignCommand: QueuedArchDesignCommand | undefined;
let archDesignSemanticEditInFlight = false;
let unloadLayoutForwarded = false;
let archDesignGraphRefreshInProgress = false;
type PendingConnection = Readonly<{ nodeId: string; portId: string }>;
let pendingConnection: PendingConnection | undefined;
let pendingConnectionPreview: Edge | undefined;
let connectionLayoutSnapshot: Readonly<{
    moduleKey: string;
    layout: SchematicLayout;
}> | undefined;

function connectionAuthoringEnabled(): boolean {
    return archDesignEditable
        && !authoringPending
        && currentArchDesignState !== undefined
        && dom.connectButton.getAttribute('aria-pressed') === 'true';
}

function interfaceInspectorForPin(pin: GraphNode['pins'][number]) {
    const identity = pin.interface?.id;
    return identity === undefined
        ? undefined
        : currentArchDesignState?.inspector?.interfaces.find(
            item => item.identity === identity
        );
}

function interfaceEffectiveRole(
    pin: GraphNode['pins'][number]
): 'master' | 'slave' | undefined {
    if (pin.interface?.kind !== 'aggregate' || pin.interface.role === 'unknown') {
        return undefined;
    }
    return pin.direction === 'driver'
        ? 'master'
        : pin.direction === 'load' ? 'slave' : undefined;
}

function pinConnectable(pin: GraphNode['pins'][number]): boolean {
    if (!connectionAuthoringEnabled() || pin.readOnly) return false;
    if (pin.interface === undefined) return true;
    if (pin.interface.kind === 'member') {
        const item = interfaceInspectorForPin(pin);
        const member = item?.members.find(candidate => candidate.port === pin.name);
        return item?.connection === undefined
            && member !== undefined
            && member.occupancy === undefined;
    }
    const item = interfaceInspectorForPin(pin);
    return interfaceEffectiveRole(pin) !== undefined
        && item !== undefined
        && item.connection === undefined
        && item.members.every(member => member.occupancy === undefined);
}

function connectionTerminal(
    cell: Cell | null | undefined,
    portId: string | null | undefined
): ConnectionTerminal | undefined {
    if (!connectionAuthoringEnabled()
        || !currentArchDesignState
        || !currentGraph
        || !cell
        || !portId) return undefined;
    const data = cellData(cell);
    const node = data?.objectType === 'node' ? data.node : undefined;
    const pin = node?.pins.find(candidate => candidate.id === portId);
    if (!node || !pin || !pinConnectable(pin)) return undefined;
    if (pin.interface?.kind === 'aggregate') {
        const item = interfaceInspectorForPin(pin);
        const effectiveRole = interfaceEffectiveRole(pin);
        return item && effectiveRole
            ? {
                kind: 'interface',
                endpoint: item.endpoint,
                effectiveRole,
                protocol: item.protocol,
                pin,
            }
            : undefined;
    }
    const endpoint = archDesignEndpointForPin(
        currentArchDesignState.design,
        node,
        pin
    );
    return endpoint ? { kind: 'scalar', endpoint, pin } : undefined;
}

function normalizeConnectionTerminals(
    first: ConnectionTerminal | undefined,
    second: ConnectionTerminal | undefined
): Readonly<{ source: ConnectionTerminal; target: ConnectionTerminal }> | undefined {
    if (!first || !second || first.pin.id === second.pin.id || first.kind !== second.kind) {
        return undefined;
    }
    if (first.kind === 'interface') {
        if (second.kind !== 'interface' || first.protocol !== second.protocol) return undefined;
        if (first.effectiveRole === 'master' && second.effectiveRole === 'slave') {
            return { source: first, target: second };
        }
        if (second.effectiveRole === 'master' && first.effectiveRole === 'slave') {
            return { source: second, target: first };
        }
        return undefined;
    }
    if (second.kind !== 'scalar') return undefined;
    if (currentGraph && canConnectScalarPins(currentGraph, first.pin, second.pin)) {
        // Preserve driver-to-load orientation regardless of click order, while
        // retaining load-to-load network joins and direct bidirectional links.
        if (second.pin.direction === 'driver'
            || (first.pin.direction === 'load' && second.pin.direction === 'bidirectional')) {
            return { source: second, target: first };
        }
        return { source: first, target: second };
    }
    return undefined;
}

function refreshPendingConnectionStyles(): void {
    dom.canvas.querySelectorAll<SVGElement>('.veriflow-connection-pending').forEach(
        element => element.classList.remove('veriflow-connection-pending')
    );
    if (!pendingConnection) return;
    const node = graph.getCellById(pendingConnection.nodeId);
    const view = node ? graph.findViewByCell(node) : undefined;
    view?.container.querySelectorAll<SVGGElement>('.x6-port-body[port]').forEach(port => {
        if (port.getAttribute('port') === pendingConnection?.portId) {
            port.classList.add('veriflow-connection-pending');
        }
    });
}

function cancelPendingConnection(): void {
    if (pendingConnectionPreview && graph.hasCell(pendingConnectionPreview)) {
        graph.removeCell(pendingConnectionPreview);
    }
    pendingConnectionPreview = undefined;
    pendingConnection = undefined;
    refreshPendingConnectionStyles();
}

function startPendingConnection(node: Node, portId: string, x: number, y: number): void {
    cancelPendingConnection();
    pendingConnection = { nodeId: node.id, portId };
    pendingConnectionPreview = graph.addEdge({
        id: 'veriflow:connection-preview',
        shape: 'veriflow-network',
        source: { cell: node.id, port: portId },
        target: { x, y },
        attrs: {
            wrap: {
                pointerEvents: 'none',
            },
            line: {
                class: 'veriflow-connection-preview-line',
                stroke: 'var(--schematic-wire-selected)',
                strokeWidth: 2,
                strokeDasharray: '5 3',
                pointerEvents: 'none',
                targetMarker: null,
            },
        },
        zIndex: 3,
    });
    refreshPendingConnectionStyles();
}

function pendingConnectionTerminal(): ConnectionTerminal | undefined {
    if (!pendingConnection) return undefined;
    return connectionTerminal(
        graph.getCellById(pendingConnection.nodeId),
        pendingConnection.portId
    );
}

function postConnection(first: ConnectionTerminal, second: ConnectionTerminal): boolean {
    const normalized = normalizeConnectionTerminals(first, second);
    if (!normalized) return false;
    const { source, target } = normalized;
    cancelPendingConnection();
    if (source.kind === 'interface') {
        if (target.kind !== 'interface') return false;
        const endpointName = (endpoint: ArchDesignInterfaceEndpoint): string =>
            endpoint.kind === 'port' ? endpoint.port : endpoint.interface;
        const baseName = `${endpointName(source.endpoint)}_to_${endpointName(target.endpoint)}`;
        const names = new Set([
            ...(currentArchDesignState?.design.connections.map(item => item.name) ?? []),
            ...(currentArchDesignState?.design.interfaceConnections.map(item => item.name) ?? []),
        ]);
        let name = baseName;
        for (let suffix = 2; names.has(name); suffix += 1) name = `${baseName}_${suffix}`;
        postArchDesignEdit({
            type: 'connectInterface',
            connection: { name, master: source.endpoint, slave: target.endpoint },
        });
        return true;
    }
    if (target.kind !== 'scalar') return false;
    postArchDesignEdit({ type: 'connect', source: source.endpoint, target: target.endpoint });
    return true;
}

function handleConnectionPinClick(node: Node, portId: string, x: number, y: number): void {
    if (!connectionAuthoringEnabled()) return;
    const terminal = connectionTerminal(node, portId);
    if (!terminal) return;
    if (!pendingConnection) {
        startPendingConnection(node, portId, x, y);
        return;
    }
    if (pendingConnection.nodeId === node.id && pendingConnection.portId === portId) {
        cancelPendingConnection();
        return;
    }
    const first = pendingConnectionTerminal();
    if (!first) {
        startPendingConnection(node, portId, x, y);
        return;
    }
    postConnection(first, terminal);
}

function refreshConnectionMagnets(): void {
    const enabled = connectionAuthoringEnabled();
    for (const cell of graph.getNodes()) {
        const data = cellData(cell);
        if (data?.objectType !== 'node' || !data.node || data.junction) continue;
        const pinsById = new Map(data.node.pins.map(pin => [pin.id, pin]));
        const view = graph.findViewByCell(cell);
        view?.container.querySelectorAll<SVGGElement>('.x6-port-body[port]').forEach(
            port => {
                const pin = pinsById.get(port.getAttribute('port') ?? '');
                const magnet = String(enabled && pin !== undefined && pinConnectable(pin));
                port.setAttribute('magnet', magnet);
                port.querySelector('[data-selector="portBody"]')
                    ?.setAttribute('magnet', magnet);
            }
        );
    }
}

function post(message: WebviewCommand): void {
    vscode.postMessage(simulationTaskDocument && message.type === 'editArchDesign'
        ? { ...message, type: 'editSchematic' } : message);
}

function sendTaskCommand(command: import('../../../veriflow-vscode/src/schematic/protocol').SimulationTaskAction, payload?: unknown): void {
    if (!simulationTaskDocument || !currentRevision) return;
    if (command === 'cancel') { post({ type: 'simulationTaskCommand', revision: currentRevision, command, payload }); return; }
    if (authoringPending || queuedArchDesignCommand) return;
    authoringPending = true;
    queuedArchDesignCommand = { type: 'task', command, payload };
    setAuthoringControls();
    flushLayoutSaves();
    drainArchDesignWrites();
}

const layoutSaveScheduler = new DebouncedLayoutSaveScheduler(
    SAVE_DELAY_MS,
    (moduleKey, revision, layout) => {
        if (archDesignDocument
            && (archDesignLayoutSaveInFlight
                || authoringPending
                || archDesignGraphRefreshInProgress)) {
            queuedArchDesignLayoutSave = { moduleKey, layout };
            unloadLayoutForwarded = false;
            return;
        }
        if (archDesignDocument) archDesignLayoutSaveInFlight = true;
        post({
            type: 'saveLayout',
            moduleKey,
            revision,
            layout,
        });
    }
);

function persistCurrentLayoutState(): SchematicLayout | undefined {
    if (!currentLayout || !currentGraph || !currentRevision || applyingLayout) return undefined;
    const moduleKey = currentGraph.moduleKey;
    const layouts = mergeSchematicWebviewLayouts(
        vscode.getState()?.layouts,
        moduleKey,
        currentLayout
    );
    vscode.setState({ layouts });
    return layouts[moduleKey];
}

function scheduleLayoutSave(): void {
    if (!currentLayout || !currentGraph || !currentRevision || applyingLayout) return;
    const layout = persistCurrentLayoutState();
    if (!layout) return;
    const moduleKey = currentGraph.moduleKey;
    layoutSaveScheduler.schedule(moduleKey, currentRevision, layout);
}

function flushLayoutSaves(): void {
    layoutSaveScheduler.flush();
}

function flushLayoutSavesForUnload(): void {
    flushLayoutSaves();
    if (!archDesignDocument || !queuedArchDesignLayoutSave
        || unloadLayoutForwarded || !currentRevision) return;
    unloadLayoutForwarded = true;
    post({
        type: 'saveLayout',
        moduleKey: queuedArchDesignLayoutSave.moduleKey,
        revision: currentRevision,
        layout: queuedArchDesignLayoutSave.layout,
    });
}

function setCanvasState(message?: string): void {
    if (message === undefined) {
        dom.canvasState.hidden = true;
        dom.canvasStateMessage.textContent = '';
        return;
    }
    dom.canvasStateMessage.textContent = message;
    dom.canvasState.hidden = false;
}

function setGraphControls(enabled: boolean): void {
    dom.fitButton.disabled = !enabled;
    dom.zoomResetButton.disabled = !enabled;
    dom.relayoutButton.disabled = !enabled;
    dom.searchButton.disabled = !enabled;
}

let diagnosticDetails: SchematicGraph['diagnostics'] = [];
let diagnosticFilter: 'error' | 'warning' = 'warning';

function renderDiagnosticDetails(): void {
    const items = diagnosticDetails.filter(item => item.severity === diagnosticFilter);
    dom.diagnosticsTitle.textContent = diagnosticFilter === 'error' ? 'Errors' : 'Warnings';
    dom.diagnosticsDetails.textContent = formatSchematicDiagnosticDetails(items)
        || (diagnosticFilter === 'error' ? 'No errors.' : 'No warnings.');
}

function updateDiagnostics(
    nextErrors: number,
    nextWarnings: number,
    diagnostics?: SchematicGraph['diagnostics']
): void {
    errors = Math.max(0, Math.trunc(nextErrors));
    warnings = Math.max(0, Math.trunc(nextWarnings));
    dom.errorCount.textContent = `E ${errors}`;
    dom.warningCount.textContent = `W ${warnings}`;
    const countText = `${errors} error${errors === 1 ? '' : 's'}, `
        + `${warnings} warning${warnings === 1 ? '' : 's'}`;
    dom.diagnosticStatus.textContent = countText;
    if (diagnostics !== undefined) {
        diagnosticDetails = diagnostics;
        dom.diagnosticStatus.title = formatSchematicDiagnosticDetails(diagnostics);
        renderDiagnosticDetails();
    }
    const detailText = dom.diagnosticStatus.title;
    dom.diagnosticStatus.setAttribute(
        'aria-label',
        detailText ? `${countText}. ${detailText.replace(/\n/g, '. ')}` : countText
    );
}

function cellData(cell: Cell): CellData | undefined {
    const data = cell.getData<unknown>();
    if (!data || typeof data !== 'object') return undefined;
    const candidate = data as Partial<CellData>;
    return typeof candidate.objectId === 'string'
        && (candidate.objectType === 'node' || candidate.objectType === 'network')
        ? candidate as CellData
        : undefined;
}

function refreshNetworkSelectionStyles(): void {
    const searchedIds = new Set(searchMatches.map(match => match.objectId));
    for (const cell of graph.getCells()) {
        const data = cellData(cell);
        if (data?.objectType !== 'network') continue;
        const selected = data.objectId === selectedNetworkId;
        const searched = searchedIds.has(data.objectId);
        const view = graph.findViewByCell(cell);
        view?.removeClass([
            'veriflow-network-selected',
            'veriflow-network-search-match',
        ]);
        if (selected) view?.addClass('veriflow-network-selected');
        if (searched) view?.addClass('veriflow-network-search-match');
    }
}

function refreshPinSelectionStyles(): void {
    dom.canvas.querySelectorAll<SVGElement>('.veriflow-pin-selected').forEach(element => {
        element.classList.remove('veriflow-pin-selected');
    });
    if (selectedPinId === undefined) return;
    for (const node of graph.getNodes()) {
        const data = cellData(node);
        if (!data?.node?.pins.some(pin => pin.id === selectedPinId)) continue;
        const view = graph.findViewByCell(node);
        view?.container.querySelectorAll<SVGGElement>('.x6-port-body[port]').forEach(port => {
            if (port.getAttribute('port') === selectedPinId) {
                port.classList.add('veriflow-pin-selected');
                port.parentElement?.querySelectorAll<SVGElement>(
                    '.x6-port-label, .veriflow-pin-label, [data-selector="text"]'
                ).forEach(element => element.classList.add('veriflow-pin-selected'));
            }
        });
    }
}

function descriptionFor(data: CellData): string {
    if (data.node) return `${data.node.kind}: ${data.node.label}`;
    if (data.networkRoute) {
        return `network: ${data.networkRoute.selectionDescription}`;
    }
    if (data.network) return `network: ${data.network.name}`;
    return data.objectId;
}

function updateSelectionStatus(cells: Cell[], persist = true): void {
    if (!currentLayout) return;
    const itemsByObjectId = new Map<string, {
        objectId: string;
        description: string;
    }>();
    if (selectedPinId !== undefined) {
        const selectedPin = currentGraph?.nodes.flatMap(node => node.pins.map(pin => ({
            node,
            pin,
        }))).find(item => item.pin.id === selectedPinId);
        const selectedInterface = currentArchDesignState?.inspector?.interfaces.find(
            item => item.identity === selectedPinId
        );
        if (selectedPin) {
            itemsByObjectId.set(selectedPinId, {
                objectId: selectedPinId,
                description: selectedPin.pin.interface?.kind === 'aggregate'
                    ? `interface: ${selectedPin.node.label}.${selectedPin.pin.name}`
                    : `pin: ${selectedPin.node.label}.${selectedPin.pin.name}`,
            });
        } else if (selectedInterface) {
            itemsByObjectId.set(selectedPinId, {
                objectId: selectedPinId,
                description: `interface: ${selectedInterface.endpoint.kind === 'port'
                    ? selectedInterface.endpoint.port
                    : `${selectedInterface.endpoint.instance}.${
                        selectedInterface.endpoint.interface}`}`,
            });
        }
    }
    if (selectedNetworkId !== undefined) {
        const selectedNetworkCell = graph.getCells().find(cell => {
            const data = cellData(cell);
            return data?.objectType === 'network'
                && data.objectId === selectedNetworkId;
        });
        const data = selectedNetworkCell && cellData(selectedNetworkCell);
        if (data) {
            itemsByObjectId.set(data.objectId, {
                objectId: data.objectId,
                description: descriptionFor(data),
            });
        }
    }
    for (const cell of cells) {
        const data = cellData(cell);
        if (data && !itemsByObjectId.has(data.objectId)) {
            itemsByObjectId.set(data.objectId, {
                objectId: data.objectId,
                description: descriptionFor(data),
            });
        }
    }
    const summary = summarizeSchematicSelection([...itemsByObjectId.values()]);
    if (summary.selectedObjectId === undefined) {
        delete currentLayout.selectedObjectId;
    } else {
        currentLayout.selectedObjectId = summary.selectedObjectId;
    }
    dom.selectionStatus.textContent = summary.statusText;
    refreshPinSelectionStyles();
    renderCurrentInspector(cells);
    if (persist) {
        if (archDesignDocument) {
            persistCurrentLayoutState();
        } else {
            scheduleLayoutSave();
        }
    }
}

function renderInspector(model: SchematicInspectorModel): void {
    dom.inspector.dataset.kind = model.kind;
    dom.inspector.dataset.readOnly = String(model.readOnly);
    dom.inspectorTitle.textContent = model.title;
    dom.inspectorMode.textContent = 'Read only';
    dom.inspectorProperties.hidden = false;
    dom.inspectorForm.hidden = true;
    const rows = document.createDocumentFragment();
    for (const row of model.rows) {
        const term = document.createElement('dt');
        term.textContent = row.label;
        const description = document.createElement('dd');
        description.textContent = row.value;
        rows.append(term, description);
    }
    dom.inspectorProperties.replaceChildren(rows);
}

function setAuthoringControls(): void {
    dom.authoringActions.hidden = !archDesignDocument;
    const disabled = !archDesignEditable || authoringPending;
    const hasModules = (currentArchDesignState?.moduleChoices
        ?? currentArchDesignState?.catalog)?.length ?? 0;
    dom.addInstanceButton.disabled = disabled || hasModules === 0;
    dom.addInstanceSubmit.disabled = disabled || dom.instanceModuleSelect.options.length === 0;
    dom.addLogicButton.disabled = disabled;
    dom.addPortButton.hidden = capabilities.addPort === false || simulationTaskDocument;
    dom.addPortButton.disabled = disabled || dom.addPortButton.hidden;
    dom.connectButton.disabled = disabled || !currentGraph;
    dom.exportButton.hidden = !simulationTaskDocument && capabilities.exportRtl === false;
    const exportLabel = simulationTaskDocument ? 'Generate Testbench' : 'Export RTL';
    dom.exportButton.title = exportLabel;
    dom.exportButton.setAttribute('aria-label', exportLabel);
    dom.addSimulationButton.hidden = !simulationTaskDocument;
    dom.addSimulationButton.disabled = disabled;
    dom.runTaskButton.hidden = !simulationTaskDocument;
    dom.waveTaskButton.hidden = !simulationTaskDocument;
    const running = currentTaskState?.execution.status === 'running';
    const runLabel = running ? 'Stop simulation' : 'Run simulation';
    dom.runTaskButton.title = runLabel;
    dom.runTaskButton.setAttribute('aria-label', runLabel);
    installIcon(dom.runTaskButton, running ? Square : Play);
    dom.runTaskButton.disabled = running ? false : disabled;
    dom.waveTaskButton.disabled = disabled || currentTaskState?.execution.canOpenWave !== true;
    dom.waveTaskButton.title = currentTaskState?.execution.canOpenWave ? 'Open waveform'
        : currentTaskState?.document.settings.waveform.enabled === false ? 'Waveform generation is disabled'
        : 'Run simulation to generate a current waveform';
    dom.taskStatus.hidden = !simulationTaskDocument;
    const status = currentTaskState?.execution.status ?? 'idle';
    dom.taskStatus.textContent = ({ idle: 'Not run', running: 'Running', completed: 'Completed', failed: 'Failed', stopped: 'Stopped' })[status];
    dom.taskStatus.title = currentTaskState?.execution.error ?? '';
    dom.inspectorForm.setAttribute('aria-label', simulationTaskDocument ? 'Simulation Task properties' : 'Arch Design properties');
    dom.exportButton.disabled = disabled || dom.exportButton.hidden;
    dom.deleteButton.disabled = disabled || currentArchDesignInspector?.deleteEdit === undefined;
    dom.inspectorForm.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(
        'input, select, textarea'
    ).forEach(control => {
        control.disabled = disabled || control.dataset.readonly === 'true';
    });
    dom.inspectorForm.querySelectorAll<HTMLButtonElement>('.transition-action').forEach(button => { button.disabled = disabled; });
    dom.inspectorForm.querySelectorAll<HTMLButtonElement>('.inspector-action').forEach(button => {
        button.disabled = disabled || button.dataset.actionAvailable !== 'true';
    });
    if (!connectionAuthoringEnabled()) cancelPendingConnection();
    refreshConnectionMagnets();
}

function postArchDesignEdit(requestedEdit: ArchDesignEdit): void {
    if (!currentArchDesignState || !archDesignEditable || authoringPending) return;
    connectionLayoutSnapshot = (requestedEdit.type === 'connect'
        || requestedEdit.type === 'connectInterface')
        && currentGraph
        && currentLayout
        ? {
            moduleKey: currentGraph.moduleKey,
            layout: cloneSchematicLayout(currentLayout),
        }
        : undefined;
    const edit = requestedEdit.type === 'setPresentation' && currentGraph && currentLayout
        ? {
            ...requestedEdit,
            presentation: {
                ...archDesignPresentationForCurrentLayout(currentGraph, currentLayout),
                ...(requestedEdit.presentation.collapsedInterfaces === undefined
                    ? {}
                    : { collapsedInterfaces: requestedEdit.presentation.collapsedInterfaces }),
            },
        } satisfies ArchDesignEdit
        : requestedEdit;
    authoringPending = true;
    queuedArchDesignCommand = { type: 'edit', edit };
    setAuthoringControls();
    if (currentGraph) layoutSaveScheduler.flushModule(currentGraph.moduleKey);
    drainArchDesignWrites();
}

function archDesignPresentationForCurrentLayout(
    model: SchematicGraph,
    layout: SchematicLayout
): ArchDesignPresentation {
    const nodes = Object.fromEntries(model.nodes.flatMap(node => {
        if (node.kind !== 'instance' && node.kind !== 'port') return [];
        const placement = layout.placement.nodes[node.id];
        return placement === undefined ? [] : [[node.id, {
            column: placement.column,
            order: placement.order,
            ...(placement.yOffset === 0 ? {} : { offset: placement.yOffset }),
            ...(placement.fixed ? { userPositioned: true } : {}),
        }]];
    }));
    return {
        ...(Object.keys(nodes).length === 0 ? {} : { nodes }),
        ...(currentArchDesignState?.design.presentation.collapsedInterfaces === undefined
            ? {}
            : {
                collapsedInterfaces: {
                    ...currentArchDesignState.design.presentation.collapsedInterfaces,
                },
            }),
    };
}

function drainArchDesignWrites(): void {
    if (!archDesignDocument || archDesignLayoutSaveInFlight
        || archDesignSemanticEditInFlight || !currentRevision) return;
    if (queuedArchDesignLayoutSave) {
        const queued = queuedArchDesignLayoutSave;
        queuedArchDesignLayoutSave = undefined;
        unloadLayoutForwarded = false;
        archDesignLayoutSaveInFlight = true;
        post({
            type: 'saveLayout',
            moduleKey: queued.moduleKey,
            revision: currentRevision,
            layout: queued.layout,
        });
        return;
    }
    const command = queuedArchDesignCommand;
    if (!command) return;
    queuedArchDesignCommand = undefined;
    if (command.type === 'task') {
        archDesignSemanticEditInFlight = true;
        post({ type: 'simulationTaskCommand', revision: currentRevision, command: command.command, payload: command.payload });
        return;
    }
    if (command.type === 'edit') {
        archDesignSemanticEditInFlight = true;
        post({
            type: 'editArchDesign',
            revision: currentRevision,
            edit: command.edit,
        });
        return;
    }
    post({ type: 'exportArchDesign', revision: currentRevision });
    authoringPending = false;
    setAuthoringControls();
}

function renderArchDesignInspector(baseModel: ArchDesignInspectorModel): void {
    let model: AuthoringInspectorModel = simulationTaskDocument && currentTaskState && currentArchDesignState
        ? projectSimulationTaskInspector(currentTaskState.document, currentArchDesignState.design.module, baseModel)
        : baseModel;
    if (simulationTaskDocument && model.actions) model = { ...model, actions: model.actions.filter(action => action.id !== 'expose-port') };
    currentArchDesignInspector = model;
    dom.inspector.dataset.kind = model.kind;
    dom.inspector.dataset.readOnly = 'false';
    dom.inspectorTitle.textContent = model.title;
    dom.inspectorMode.textContent = authoringPending ? 'Applying change' : simulationTaskDocument ? 'Simulation Task' : 'Arch Design';
    dom.inspectorProperties.hidden = true;
    dom.inspectorForm.hidden = false;
    const fields = document.createDocumentFragment();
    for (const field of model.fields) {
        const wrapper = document.createElement('div');
        wrapper.className = 'inspector-field';
        const label = document.createElement('label');
        label.htmlFor = field.id;
        label.textContent = field.label;
        if (field.control === 'readonly') {
            const output = document.createElement('output');
            output.id = field.id;
            output.textContent = field.value;
            wrapper.append(label, output);
        } else {
            const control = field.control === 'select'
                ? document.createElement('select')
                : document.createElement('input');
            control.id = field.id;
            control.value = field.value;
            if (control instanceof HTMLInputElement) {
                control.type = 'text';
                control.autocomplete = 'off';
                control.spellcheck = false;
                control.placeholder = field.placeholder ?? '';
            }
            if (control instanceof HTMLSelectElement) {
                for (const option of field.options ?? []) {
                    const element = document.createElement('option');
                    element.value = option.value;
                    element.textContent = option.label;
                    control.append(element);
                }
                control.value = field.value;
            }
            const commit = (): void => {
                try {
                    const edit = field.commit?.(control.value);
                    control.setCustomValidity('');
                    if (edit?.type === 'task') sendTaskCommand(edit.command, edit.payload);
                    else if (edit) postArchDesignEdit(edit);
                } catch (error) {
                    control.setCustomValidity(error instanceof Error ? error.message : String(error));
                    control.reportValidity();
                }
            };
            inspectorCommitters.set(control, commit);
            control.addEventListener('change', commit);
            control.addEventListener('input', () => control.setCustomValidity(''));
            wrapper.append(label, control);
        }
        fields.append(wrapper);
    }
    if (model.actions && model.actions.length > 0) {
        const actions = document.createElement('div');
        actions.className = 'inspector-actions';
        for (const action of model.actions) {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'inspector-action';
            button.dataset.inspectorAction = action.id;
            button.dataset.actionAvailable = String(action.edit !== undefined);
            button.disabled = action.edit === undefined;
            button.title = action.disabledReason ?? action.label;
            button.setAttribute('aria-label', action.label);
            button.append(createElement(
                action.id === 'resync-interface' ? RefreshCw : PanelTopOpen,
                {
                    width: 15,
                    height: 15,
                    'stroke-width': 1.75,
                    'aria-hidden': 'true',
                }
            ), document.createTextNode(action.label));
            if (action.edit) {
                button.addEventListener('click', () => postArchDesignEdit(action.edit!));
            }
            actions.append(button);
        }
        fields.append(actions);
    }
    if (model.transitions) fields.append(renderTransitionTable(model.transitions));
    for (const table of model.valueTables ?? []) fields.append(renderPresetValueTable(table));
    if (model.transactions) fields.append(renderTransactionTable(model.transactions));
    dom.inspectorForm.replaceChildren(fields);
    if (simulationTaskDocument && currentTaskState?.execution.error) showInspectorError(currentTaskState.execution.error);
    setAuthoringControls();
}

function showInspectorError(message: string): void {
    let error = dom.inspectorForm.querySelector<HTMLParagraphElement>('.inspector-error');
    if (!error) {
        error = document.createElement('p');
        error.className = 'inspector-error';
        error.setAttribute('role', 'alert');
        dom.inspectorForm.append(error);
    }
    error.textContent = message;
}

function renderTransitionTable(model: NonNullable<AuthoringInspectorModel['transitions']>): HTMLElement {
    const wrapper = document.createElement('div');
    wrapper.className = 'inspector-field';
    const title = document.createElement('label');
    title.textContent = `Transitions (${currentTaskState?.document.settings.timeUnit ?? ''})`;
    const table = document.createElement('table');
    table.className = 'transition-table';
    table.setAttribute('aria-label', 'Stimulus transitions');
    const head = table.createTHead().insertRow();
    for (const label of ['Time', 'Value', '']) {
        const cell = document.createElement('th');
        cell.textContent = label;
        cell.scope = 'col';
        head.append(cell);
    }
    const body = table.createTBody();
    const commit = (control?: HTMLInputElement): void => {
        const inputs = Array.from(body.querySelectorAll<HTMLInputElement>('input'));
        // Validation covers the whole table; discard errors from earlier drafts.
        inputs.forEach(input => input.setCustomValidity(''));
        // An added row stays a draft until both cells have been entered.
        if (inputs.some(input => !input.value.trim())) return;
        try {
            const command = model.commit(Array.from(body.rows).map(row => ({
                at: Number(row.querySelector<HTMLInputElement>('[data-transition-time]')!.value),
                value: row.querySelector<HTMLInputElement>('[data-transition-value]')!.value,
            })));
            sendTaskCommand(command.command, command.payload);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            const invalid = error instanceof TransitionValidationError
                ? body.rows[error.rowIndex]?.querySelector<HTMLInputElement>(`[data-transition-${error.field}]`)
                : control;
            invalid?.setCustomValidity(message);
            invalid?.reportValidity();
            showInspectorError(message);
        }
    };
    const appendRow = (at: string, value: string): void => {
        const row = body.insertRow();
        const index = body.rows.length;
        for (const [key, initial] of [['time', at], ['value', value]] as const) {
            const input = document.createElement('input');
            input.type = key === 'time' ? 'number' : 'text';
            if (key === 'time') { input.min = '0'; input.step = 'any'; }
            input.value = initial;
            input.setAttribute(`data-transition-${key}`, '');
            input.setAttribute('aria-label', `Transition ${index} ${key}`);
            input.autocomplete = 'off';
            input.spellcheck = false;
            inspectorCommitters.set(input, () => commit(input));
            input.addEventListener('change', () => commit(input));
            input.addEventListener('input', () => input.setCustomValidity(''));
            row.insertCell().append(input);
        }
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'icon-button transition-action transition-delete';
        remove.title = `Delete transition ${index}`;
        remove.setAttribute('aria-label', remove.title);
        remove.append(createElement(Trash2, { width: 14, height: 14, 'aria-hidden': 'true' }));
        remove.addEventListener('click', () => { row.remove(); commit(); });
        row.insertCell().append(remove);
    };
    for (const row of model.rows) appendRow(String(row.at), row.value);
    const add = document.createElement('button');
    add.id = 'add-transition';
    add.type = 'button';
    add.className = 'inspector-action transition-action';
    add.dataset.actionAvailable = 'true';
    add.textContent = 'Add transition';
    add.addEventListener('click', () => {
        appendRow('', '');
        body.lastElementChild?.querySelector('input')?.focus();
    });
    wrapper.append(title, table, add);
    return wrapper;
}

function renderPresetValueTable(model: NonNullable<AuthoringInspectorModel['valueTables']>[number]): HTMLElement {
    const wrapper = document.createElement('div');
    wrapper.className = 'inspector-field';
    const title = document.createElement('label');
    title.textContent = model.label;
    const table = document.createElement('table');
    table.className = 'transition-table preset-value-table';
    table.setAttribute('aria-label', model.label);
    const head = table.createTHead().insertRow();
    for (const label of ['#', 'Value', '']) {
        const cell = document.createElement('th');
        cell.textContent = label;
        cell.scope = 'col';
        head.append(cell);
    }
    const body = table.createTBody();
    const commit = (control?: HTMLInputElement): void => {
        const inputs = Array.from(body.querySelectorAll<HTMLInputElement>('input'));
        if (inputs.some(input => !input.value.trim())) return;
        try {
            const command = model.commit(inputs.map(input => input.value));
            control?.setCustomValidity('');
            sendTaskCommand(command.command, command.payload);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            control?.setCustomValidity(message);
            control?.reportValidity();
            showInspectorError(message);
        }
    };
    const appendRow = (value: string): void => {
        const row = body.insertRow();
        const index = body.rows.length;
        row.insertCell().textContent = String(index);
        const input = document.createElement('input');
        input.value = value;
        input.placeholder = model.placeholder;
        input.setAttribute('aria-label', `${model.label} ${index} value`);
        input.autocomplete = 'off';
        input.spellcheck = false;
        inspectorCommitters.set(input, () => commit(input));
        input.addEventListener('change', () => commit(input));
        input.addEventListener('input', () => input.setCustomValidity(''));
        row.insertCell().append(input);
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'icon-button transition-action transition-delete';
        remove.title = `Delete ${model.label.toLowerCase()} ${index}`;
        remove.setAttribute('aria-label', remove.title);
        remove.append(createElement(Trash2, { width: 14, height: 14, 'aria-hidden': 'true' }));
        remove.addEventListener('click', () => { row.remove(); commit(); });
        row.insertCell().append(remove);
    };
    for (const value of model.rows) appendRow(value);
    const add = document.createElement('button');
    add.type = 'button';
    add.className = 'inspector-action transition-action';
    add.dataset.actionAvailable = 'true';
    add.textContent = `Add ${model.label.toLowerCase().replace(/s$/, '')}`;
    add.addEventListener('click', () => { appendRow(''); body.lastElementChild?.querySelector('input')?.focus(); });
    wrapper.append(title, table, add);
    return wrapper;
}

function renderTransactionTable(model: NonNullable<AuthoringInspectorModel['transactions']>): HTMLElement {
    const wrapper = document.createElement('div');
    wrapper.className = 'inspector-field';
    const title = document.createElement('label');
    title.textContent = 'Transactions';
    const list = document.createElement('div');
    list.className = 'transaction-list';
    list.setAttribute('role', 'list');
    list.setAttribute('aria-label', 'Bus transactions');
    const rows = model.rows.map(row => ({ ...row, data: [...row.data], ...(row.expected ? { expected: [...row.expected] } : {}) }));
    const submit = (control?: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement): void => {
        try {
            const command = model.commit(rows);
            control?.setCustomValidity('');
            sendTaskCommand(command.command, command.payload);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            control?.setCustomValidity(message);
            control?.reportValidity();
            showInspectorError(message);
        }
    };
    rows.forEach((row, index) => {
        const item = document.createElement('div');
        item.className = 'transaction-row';
        item.setAttribute('role', 'listitem');
        const heading = document.createElement('div');
        heading.className = 'transaction-heading';
        const count = document.createElement('span');
        count.textContent = `#${index + 1}`;
        const operation = document.createElement('select');
        operation.setAttribute('aria-label', `Transaction ${index + 1} operation`);
        for (const [value, label] of [['write', 'Write'], ['read', 'Read']]) {
            const option = document.createElement('option');
            option.value = value; option.textContent = label; operation.append(option);
        }
        operation.value = row.operation;
        const payloadKey = (): 'data' | 'expected' => (model.role === 'initiator') === (row.operation === 'write') ? 'data' : 'expected';
        operation.addEventListener('change', () => {
            const previous = row[payloadKey()] ?? [];
            row.operation = operation.value === 'read' ? 'read' : 'write';
            row.data = []; delete row.expected;
            row[payloadKey()] = previous;
            submit(operation);
        });
        const remove = document.createElement('button');
        remove.type = 'button'; remove.className = 'icon-button transition-action transition-delete';
        remove.title = `Delete transaction ${index + 1}`; remove.setAttribute('aria-label', remove.title);
        remove.append(createElement(Trash2, { width: 14, height: 14, 'aria-hidden': 'true' }));
        remove.addEventListener('click', () => { rows.splice(index, 1); submit(); });
        heading.append(count, operation, remove);
        const addressLabel = document.createElement('label');
        addressLabel.textContent = 'Address';
        const address = document.createElement('input');
        address.setAttribute('aria-label', `Transaction ${index + 1} address`);
        address.value = row.address; address.placeholder = "32'h00000000";
        address.autocomplete = 'off'; address.spellcheck = false;
        const commitAddress = (): void => { row.address = address.value.trim(); submit(address); };
        address.addEventListener('change', commitAddress);
        address.addEventListener('input', () => address.setCustomValidity(''));
        inspectorCommitters.set(address, commitAddress);
        addressLabel.append(address);
        const valueLabel = document.createElement('label');
        valueLabel.textContent = payloadKey() === 'data'
            ? row.operation === 'write' ? 'Write data' : 'Read response'
            : row.operation === 'write' ? 'Expected write data' : 'Expected read data';
        const value = model.burst ? document.createElement('textarea') : document.createElement('input');
        value.setAttribute('aria-label', `Transaction ${index + 1} values`);
        value.value = (row[payloadKey()] ?? []).join('\n');
        value.placeholder = model.burst ? "32'h12345678\n32'habcdef00" : "32'h12345678";
        value.spellcheck = false;
        if (value instanceof HTMLTextAreaElement) { value.rows = 3; value.title = 'One data beat per line'; }
        const commitValue = (): void => {
            row[payloadKey()] = value.value.trim() ? value.value.split(/\r?\n/).map(text => text.trim()) : [];
            submit(value);
        };
        value.addEventListener('change', commitValue);
        value.addEventListener('input', () => value.setCustomValidity(''));
        inspectorCommitters.set(value, commitValue);
        if (value instanceof HTMLTextAreaElement) value.addEventListener('keydown', event => {
            if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); commitValue(); }
        });
        valueLabel.append(value);
        item.append(heading, addressLabel, valueLabel);
        if (model.burst) {
            const hint = document.createElement('small');
            hint.textContent = 'One beat per line. Ctrl+Enter to apply.';
            item.append(hint);
        }
        list.append(item);
    });
    const add = document.createElement('button');
    add.type = 'button'; add.className = 'inspector-action transition-action';
    add.dataset.actionAvailable = 'true'; add.textContent = 'Add transaction';
    add.addEventListener('click', () => {
        rows.push({ operation: 'write', address: '0', data: model.role === 'initiator' ? ['0'] : [],
            ...(model.role === 'initiator' ? {} : { expected: ['0'] }) });
        submit();
    });
    wrapper.append(title, list, add);
    return wrapper;
}

function selectedNodeIds(cells: readonly Cell[]): string[] {
    return [...new Set(cells.flatMap(cell => {
        const data = cellData(cell);
        return data?.objectType === 'node' && !data.junction
            ? [data.objectId]
            : [];
    }))];
}

function renderCurrentInspector(cells = selection.getSelectedCells()): void {
    if (!currentGraph) {
        renderInspector({
            kind: 'empty',
            title: 'No selection',
            readOnly: true,
            rows: [],
        });
        return;
    }
    if (currentArchDesignState) {
        renderArchDesignInspector(projectArchDesignInspector(
            currentArchDesignState,
            currentGraph,
            selectedNodeIds(cells),
            selectedNetworkId,
            selectedPinId
        ));
        return;
    }
    renderInspector(projectSchematicInspector(
        currentGraph,
        selectedNodeIds(cells),
        selectedNetworkId
    ));
}

function selectNetwork(networkId: string | undefined, persist = true): void {
    const matchingCell = networkId === undefined
        ? undefined
        : graph.getCells().find(cell => {
            const data = cellData(cell);
            return data?.objectType === 'network' && data.objectId === networkId;
        });
    selectedNetworkId = matchingCell ? networkId : undefined;
    selectedPinId = undefined;
    syncingSelection = true;
    selection.clean();
    syncingSelection = false;
    refreshNetworkSelectionStyles();
    updateSelectionStatus([], persist);
}

function navigationTargetForCell(cell: Cell): {
    sourceSpan?: GraphNode['sourceSpan'];
    definitionKey?: string;
} {
    const data = cellData(cell);
    return data?.node ?? data?.network ?? {};
}

function updateViewportFromGraph(): void {
    if (!currentLayout || applyingLayout) return;
    const translation = graph.translate();
    currentLayout.viewport = {
        x: translation.tx,
        y: translation.ty,
        zoom: graph.zoom(),
    };
    if (archDesignDocument) {
        persistCurrentLayoutState();
    } else {
        scheduleLayoutSave();
    }
}

// X6's non-scroller MiniMap fits only the cells, which can put the entire
// viewport border outside a small graph's overview. Its navigation also retains
// the pre-fit ratio. Fit cells plus the visible canvas and use that actual scale.
class SchematicMiniMap extends MiniMap {
    private sourceScale = 1;

    protected override updatePaper(width: number, height: number): this;
    protected override updatePaper(size: { width: number; height: number }): this;
    protected override updatePaper(
        _width: number | { width: number; height: number },
        _height?: number
    ): this {
        this.targetGraph.resize(
            this.options.width - 2 * this.options.padding,
            this.options.height - 2 * this.options.padding
        );
        this.fitOverview();
        return this;
    }

    protected override onModelUpdated(): void {
        this.fitOverview();
    }

    protected override onTransform(): void {
        const scale = this.sourceGraph.zoom();
        if (scale < this.sourceScale) this.fitOverview();
        this.sourceScale = scale;
        this.updateViewport();
    }

    private fitOverview(): void {
        const area = this.sourceGraph.getContentArea().union(this.sourceGraph.getGraphArea());
        this.targetGraph.zoomToRect(area, { padding: 4, maxScale: 1 });
        this.ratio = this.targetGraph.zoom();
        this.sourceScale = this.sourceGraph.zoom();
        this.updateViewport();
    }
}

function setMinimapVisibility(): void {
    const wanted = currentLayout?.minimap === true && minimapAvailable;
    if (wanted && !minimapPlugin) {
        dom.minimap.hidden = false;
        minimapPlugin = new SchematicMiniMap({
            container: dom.minimap,
            width: 180,
            height: 120,
            padding: 8,
            scalable: false,
        });
        graph.use(minimapPlugin);
    } else if (!wanted && minimapPlugin) {
        graph.disposePlugins('minimap');
        minimapPlugin = undefined;
        dom.minimap.replaceChildren();
        dom.minimap.hidden = true;
    } else {
        dom.minimap.hidden = !wanted;
    }
    dom.minimapButton.disabled = !minimapAvailable;
    dom.minimapButton.setAttribute('aria-pressed', String(wanted));
}

function updateMinimapAvailability(): void {
    minimapAvailable = (currentGraph?.nodes.length ?? 0) > 0;
    setMinimapVisibility();
}

function applyViewport(layout: SchematicLayout): void {
    graph.zoomTo(Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, layout.viewport.zoom)));
    graph.translate(layout.viewport.x, layout.viewport.y);
}

function selectedObjectIds(cells: readonly Cell[]): string[] {
    if (selectedPinId !== undefined) return [selectedPinId];
    if (selectedNetworkId !== undefined) return [selectedNetworkId];
    return [...new Set(cells.flatMap(cell => {
        const data = cellData(cell);
        return data && !data.junction ? [data.objectId] : [];
    }))];
}

function restoreSelection(
    layout: SchematicLayout,
    preservedObjectIds?: readonly string[]
): void {
    selectedNetworkId = undefined;
    selectedPinId = undefined;
    syncingSelection = true;
    selection.clean();
    const wantedObjectIds = preservedObjectIds === undefined
        ? new Set(layout.selectedObjectId ? [layout.selectedObjectId] : [])
        : new Set(preservedObjectIds);
    const matchingPinId = [...wantedObjectIds].find(id =>
        currentGraph?.nodes.some(node => node.pins.some(pin =>
            pin.id === id || pin.interface?.id === id
        ))
    );
    if (matchingPinId !== undefined) selectedPinId = matchingPinId;
    const matchingNodeCells = graph.getCells().filter(cell => {
        const data = cellData(cell);
        return data?.objectType === 'node'
            && wantedObjectIds.has(data.objectId);
    });
    if (selectedPinId !== undefined) {
        // Pin selections do not select or move their owning nodes.
    } else if (matchingNodeCells.length > 0) {
        selection.select(matchingNodeCells);
    } else {
        const matchingNetwork = graph.getCells().find(cell => {
            const data = cellData(cell);
            return data?.objectType === 'network'
                && wantedObjectIds.has(data.objectId);
        });
        selectedNetworkId = matchingNetwork
            ? cellData(matchingNetwork)?.objectId
            : undefined;
    }
    syncingSelection = false;
    refreshNetworkSelectionStyles();
    refreshPinSelectionStyles();
    updateSelectionStatus(selection.getSelectedCells(), false);
}

function layoutDisplaySchematic(
    model: SchematicGraph,
    layout: SchematicLayout,
    preservePlacement = false
): SchematicRenderModel {
    const placement = preservePlacement
        ? {
            nodes: Object.fromEntries(Object.entries(layout.placement.nodes).map(
                ([id, node]) => [id, { ...node, fixed: true }]
            )),
        }
        : layout.placement;
    return layoutSchematic(model, placement, measureNodeText);
}

function renderSchematic(
    model: SchematicGraph,
    layout: SchematicLayout,
    preservedSelection?: readonly string[],
    fitOnFirstRender = false,
    preservePlacement = false
): void {
    const searchQuery = dom.searchInput.value;
    cancelPendingConnection();
    clearPendingNodeMoves();
    applyingLayout = true;
    currentGraph = model;
    currentLayout = cloneSchematicLayout(layout);
    selectedModuleKey = model.moduleKey;
    dom.moduleSelector.value = model.moduleKey;
    graph.resetCells([]);
    const renderModel = layoutDisplaySchematic(model, layout, preservePlacement);
    currentRenderModel = renderModel;
    graph.batchUpdate('render-schematic', () => {
        for (const node of model.nodes) {
            const rendered = renderModel.nodes.get(node.id);
            if (rendered) createRenderedNode(node, rendered);
        }
        renderNetworks(model, renderModel);
    });
    let autoFitted = false;
    if (fitOnFirstRender
        && model.nodes.length > 0
        && !autoFittedModules.has(model.moduleKey)) {
        autoFittedModules.add(model.moduleKey);
        autoFitted = true;
        graph.zoomToFit({ padding: 24, maxScale: 1 });
        const translation = graph.translate();
        currentLayout.viewport = {
            x: translation.tx,
            y: translation.ty,
            zoom: graph.zoom(),
        };
    } else {
        applyViewport(layout);
    }
    restoreSelection(layout, preservedSelection);
    refreshSearchMatches(searchQuery, true);
    applyingLayout = false;
    if (autoFitted) persistCurrentLayoutState();

    setGraphControls(model.nodes.length > 0);
    setCanvasState(model.nodes.length === 0 ? 'No schematic objects' : undefined);
    const graphErrors = model.diagnostics.filter(item => item.severity === 'error').length;
    const graphWarnings = model.diagnostics.filter(item => item.severity === 'warning').length;
    updateDiagnostics(graphErrors, graphWarnings, model.diagnostics);
    updateMinimapAvailability();
}

function nodePosition(node: Node): { x: number; y: number } {
    const position = node.getPosition();
    return { x: position.x, y: position.y };
}

function nodeCenter(node: Node): { x: number; y: number } {
    const position = nodePosition(node);
    const size = node.getSize();
    return {
        x: position.x + size.width / 2,
        y: position.y + size.height / 2,
    };
}

function clearPendingNodeMoves(): void {
    nodeMoveGeneration += 1;
    scheduledNodeMoveGeneration = undefined;
    pendingNodeMoves.clear();
    selectionBoxOrigins.clear();
}

function queueNodeMove(node: Node): void {
    if (applyingLayout || !currentGraph || !currentLayout || !currentRenderModel) {
        return;
    }
    const data = cellData(node);
    if (!data?.node) return;
    const dropCenter = nodeCenter(node);
    const rendered = currentRenderModel.nodes.get(data.node.id);
    if (!rendered) return;
    const renderedCenter = {
        x: rendered.bounds.x + rendered.bounds.width / 2,
        y: rendered.bounds.y + rendered.bounds.height / 2,
    };
    if (dropCenter.x === renderedCenter.x && dropCenter.y === renderedCenter.y) {
        return;
    }
    pendingNodeMoves.set(data.node.id, dropCenter);

    const generation = nodeMoveGeneration;
    if (scheduledNodeMoveGeneration === generation) return;
    scheduledNodeMoveGeneration = generation;
    const model = currentGraph;
    const revision = currentRevision;
    queueMicrotask(() => flushPendingNodeMoves(generation, model, revision));
}

function flushPendingNodeMoves(
    generation: number,
    model: SchematicGraph,
    revision: string
): void {
    if (scheduledNodeMoveGeneration === generation) {
        scheduledNodeMoveGeneration = undefined;
    }
    if (generation !== nodeMoveGeneration || currentGraph !== model
        || currentRevision !== revision || applyingLayout
        || !currentLayout || !currentRenderModel) {
        return;
    }
    const drops = [...pendingNodeMoves].map(([nodeId, dropCenter]) => ({
        nodeId,
        dropCenter,
    }));
    pendingNodeMoves.clear();
    if (drops.length === 0) return;

    currentLayout.placement = snapNodesToPlacement(
        model,
        currentLayout.placement,
        currentRenderModel,
        drops,
        measureNodeText
    );
    const preservedSelection = selectedObjectIds(selection.getSelectedCells());
    renderSchematic(model, currentLayout, preservedSelection);
    scheduleLayoutSave();
}

function resetSearchStyles(): void {
    for (const cell of graph.getCells()) {
        const data = cellData(cell);
        if (cell.isNode() && !data?.junction) {
            cell.attr('body/stroke', 'var(--schematic-node-border)');
            cell.attr('body/strokeWidth', 1.5);
        }
    }
}

function searchText(data: CellData): string {
    if (data.node) {
        return [
            data.node.label,
            data.node.subtitle ?? '',
            data.node.kind,
            ...data.node.pins.map(pin => pin.name),
        ].join('\n');
    }
    return [
        data.networkRoute?.displayName ?? data.network?.name ?? '',
        data.network?.adapterLabel ?? '',
        'network',
    ].join('\n');
}

function collectSearchMatches(query: string): SearchMatch[] {
    const lowered = query.trim().toLocaleLowerCase();
    if (!lowered) return [];
    const seen = new Set<string>();
    return graph.getCells().flatMap(cell => {
        const data = cellData(cell);
        if (!data || seen.has(data.objectId)
            || !searchText(data).toLocaleLowerCase().includes(lowered)) {
            return [];
        }
        seen.add(data.objectId);
        return [{ cell, objectId: data.objectId, description: descriptionFor(data) }];
    });
}

function updateSearchButtons(): void {
    const canNavigate = searchMatches.length >= 2;
    dom.searchPreviousButton.disabled = !canNavigate;
    dom.searchNextButton.disabled = !canNavigate;
}

function updateActiveSearchStatus(): void {
    const match = searchMatches[searchIndex];
    if (!match || currentLayout?.selectedObjectId !== match.objectId) return;
    dom.selectionStatus.textContent = `${match.description} (${searchIndex + 1}/${
        searchMatches.length
    })`;
}

function refreshSearchMatches(query: string, preserveActiveMatch: boolean): void {
    const previousIndex = searchIndex;
    const previousObjectId = searchMatches[previousIndex]?.objectId;
    resetSearchStyles();
    searchMatches = collectSearchMatches(query);
    if (searchMatches.length === 0) {
        searchIndex = -1;
    } else if (preserveActiveMatch) {
        const retainedIndex = previousObjectId === undefined
            ? -1
            : searchMatches.findIndex(match => match.objectId === previousObjectId);
        searchIndex = retainedIndex >= 0
            ? retainedIndex
            : Math.min(Math.max(previousIndex, 0), searchMatches.length - 1);
    } else {
        searchIndex = -1;
    }
    for (const match of searchMatches) {
        if (cellData(match.cell)?.objectType === 'network') continue;
        match.cell.attr('body/stroke', 'var(--vscode-editor-findMatchBorder, #f0a000)');
        match.cell.attr('body/strokeWidth', 2);
    }
    refreshNetworkSelectionStyles();
    updateSearchButtons();
    if (preserveActiveMatch) updateActiveSearchStatus();
}

function showSearchMatch(index: number): void {
    if (searchMatches.length === 0) {
        searchIndex = -1;
        updateSearchButtons();
        return;
    }
    searchIndex = (index + searchMatches.length) % searchMatches.length;
    const match = searchMatches[searchIndex];
    graph.centerCell(match.cell);
    if (cellData(match.cell)?.objectType === 'network') {
        selectNetwork(match.objectId);
    } else {
        selectedNetworkId = undefined;
        refreshNetworkSelectionStyles();
        selection.reset(match.cell);
    }
    dom.selectionStatus.textContent = `${match.description} (${searchIndex + 1}/${searchMatches.length})`;
    updateSearchButtons();
}

function runSearch(query: string, notifyHost: boolean): void {
    refreshSearchMatches(query, false);
    if (notifyHost) post({ type: 'search', query });
    showSearchMatch(0);
}

function clearSchematicState(): void {
    layoutSaveScheduler.flush();
    layoutSaveScheduler.dispose();
    clearPendingNodeMoves();
    applyingLayout = true;
    selectedNetworkId = undefined;
    selectedPinId = undefined;
    selection.clean();
    graph.resetCells([]);
    graph.zoomTo(1);
    graph.translate(0, 0);
    applyingLayout = false;
    currentGraph = undefined;
    currentLayout = undefined;
    connectionLayoutSnapshot = undefined;
    currentRenderModel = undefined;
    currentRevision = '';
    selectedModuleKey = '';
    searchMatches = [];
    searchIndex = -1;
    dom.searchInput.value = '';
    dom.searchControls.hidden = true;
    dom.searchButton.setAttribute('aria-expanded', 'false');
    dom.searchPreviousButton.disabled = true;
    dom.searchNextButton.disabled = true;
    dom.selectionStatus.textContent = 'No selection';
    renderCurrentInspector();
    minimapAvailable = false;
    if (minimapPlugin) {
        graph.disposePlugins('minimap');
        minimapPlugin = undefined;
    }
    dom.minimap.replaceChildren();
    dom.minimap.hidden = true;
    dom.minimapButton.disabled = true;
    dom.minimapButton.setAttribute('aria-pressed', 'false');
    setGraphControls(false);
    updateDiagnostics(0, 0, []);
    currentArchDesignInspector = undefined;
    setAuthoringControls();
}

function initialize(event: Extract<HostEvent, { type: 'initialize' }>): void {
    if (currentGraph && currentGraph.moduleKey !== event.selectedModuleKey) {
        layoutSaveScheduler.flushModule(currentGraph.moduleKey);
    }
    dom.moduleSelector.replaceChildren();
    for (const module of event.modules) {
        const option = document.createElement('option');
        option.value = module.key;
        option.textContent = module.name;
        dom.moduleSelector.append(option);
    }
    selectedModuleKey = event.selectedModuleKey;
    simulationTaskDocument = event.documentKind === 'simulation-task';
    capabilities = event.capabilities ?? {};
    if (!simulationTaskDocument) currentTaskState = undefined;
    const nextArchDesignDocument = event.documentKind === 'arch-design' || simulationTaskDocument;
    if (!nextArchDesignDocument) {
        archDesignLayoutSaveInFlight = false;
        queuedArchDesignLayoutSave = undefined;
        queuedArchDesignCommand = undefined;
        archDesignSemanticEditInFlight = false;
        authoringPending = false;
        connectionLayoutSnapshot = undefined;
    }
    archDesignDocument = nextArchDesignDocument;
    archDesignEditable = false;
    currentArchDesignState = undefined;
    currentArchDesignInspector = undefined;
    setAuthoringControls();
    dom.moduleSelector.value = event.selectedModuleKey;
    dom.moduleSelector.disabled = event.modules.length === 0;
    if (event.modules.length === 0) {
        clearSchematicState();
        setCanvasState('No modules');
        return;
    }
    if (!currentGraph || currentGraph.moduleKey !== event.selectedModuleKey) {
        setCanvasState('Loading schematic');
    }
}

function updateArchDesignState(
    event: Extract<HostEvent, { type: 'archDesignState' }>
): void {
    archDesignDocument = true;
    if (event.status === 'editable') {
        archDesignSemanticEditInFlight = false;
        authoringPending = queuedArchDesignCommand !== undefined;
        currentArchDesignState = event;
        archDesignEditable = true;
        updateDiagnostics(event.validation.diagnostics.length, event.validation.warnings.length, [
            ...event.validation.diagnostics.map(item => ({
                severity: 'error' as const, code: item.code, message: `${item.path}: ${item.message}`,
            })),
            ...event.validation.warnings.map(item => ({
                severity: 'warning' as const, code: item.code, message: `${item.path}: ${item.message}`,
            })),
        ]);
        renderInstanceModuleOptions(dom.instanceModuleFilter.value);
        updateSelectionStatus(selection.getSelectedCells(), false);
    } else {
        archDesignSemanticEditInFlight = false;
        queuedArchDesignCommand = undefined;
        queuedArchDesignLayoutSave = undefined;
        authoringPending = false;
        currentArchDesignState = undefined;
        currentArchDesignInspector = undefined;
        archDesignEditable = false;
        renderInspector({
            kind: 'empty',
            title: event.status === 'readonly' ? 'Read-only Arch Design' : 'Invalid Arch Design',
            readOnly: true,
            rows: [{
                label: 'Status',
                value: event.status === 'readonly'
                    ? event.reason
                    : `${event.diagnostics.length} error${
                        event.diagnostics.length === 1 ? '' : 's'
                    }`,
            }],
        });
    }
    setAuthoringControls();
    drainArchDesignWrites();
}

function handleHostEvent(event: HostEvent): void {
    switch (event.type) {
        case 'simulationTaskState':
            currentRevision = event.revision;
            currentTaskState = event.task;
            updateArchDesignState({ ...event.projection, type: 'archDesignState', status: 'editable', revision: event.revision });
            return;
        case 'initialize':
            initialize(event);
            return;
        case 'graph':
            archDesignGraphRefreshInProgress = archDesignDocument;
            if (currentGraph) {
                layoutSaveScheduler.flushModule(currentGraph.moduleKey);
            }
            layoutSaveScheduler.flushModule(event.graph.moduleKey);
            archDesignGraphRefreshInProgress = false;
            archDesignLayoutSaveInFlight = false;
            unloadLayoutForwarded = false;
            const preservedSelection = archDesignDocument
                && currentGraph?.moduleKey === event.graph.moduleKey
                ? selectedObjectIds(selection.getSelectedCells())
                : undefined;
            const localViewport = event.fitOnFirstRender === true
                && autoFittedModules.has(event.graph.moduleKey)
                ? vscode.getState()?.layouts?.[event.graph.moduleKey]?.viewport
                : undefined;
            const localLayout = queuedArchDesignLayoutSave?.moduleKey
                === event.graph.moduleKey
                ? queuedArchDesignLayoutSave.layout
                : undefined;
            const capturedConnectionLayout = connectionLayoutSnapshot?.moduleKey
                === event.graph.moduleKey
                ? connectionLayoutSnapshot.layout
                : undefined;
            connectionLayoutSnapshot = undefined;
            const connectionLayout = capturedConnectionLayout === undefined
                ? undefined
                : {
                    ...cloneSchematicLayout(capturedConnectionLayout),
                    placement: {
                        nodes: Object.fromEntries(event.graph.nodes.flatMap(node => {
                            const placement = capturedConnectionLayout.placement.nodes[node.id]
                                ?? event.layout.placement.nodes[node.id];
                            return placement === undefined
                                ? []
                                : [[node.id, { ...placement }] as const];
                        })),
                    },
                };
            const layout = connectionLayout ?? localLayout ?? (localViewport
                ? {
                    ...event.layout,
                    viewport: { ...localViewport },
                }
                : event.layout);
            currentRevision = event.revision;
            renderSchematic(
                event.graph,
                layout,
                pendingAddedNodeId && event.graph.nodes.some(node => node.id === pendingAddedNodeId)
                    ? [pendingAddedNodeId] : preservedSelection,
                event.fitOnFirstRender === true,
                connectionLayout !== undefined
            );
            if (pendingAddedNodeId && event.graph.nodes.some(node => node.id === pendingAddedNodeId)) pendingAddedNodeId = undefined;
            drainArchDesignWrites();
            return;
        case 'diagnostics':
            updateDiagnostics(event.errors, event.warnings, event.details);
            return;
        case 'archDesignState':
            updateArchDesignState(event);
            return;
        case 'archDesignLayoutSaved':
            currentRevision = event.revision;
            archDesignLayoutSaveInFlight = false;
            if (currentGraph) {
                layoutSaveScheduler.rebaseRevision(currentGraph.moduleKey, event.revision);
            }
            if (currentArchDesignState) {
                currentArchDesignState = {
                    ...currentArchDesignState,
                    revision: event.revision,
                };
            }
            setAuthoringControls();
            drainArchDesignWrites();
            return;
        case 'archDesignRevisionChanged':
            currentRevision = event.revision;
            if (currentGraph) {
                layoutSaveScheduler.rebaseRevision(currentGraph.moduleKey, event.revision);
            }
            if (currentArchDesignState) {
                currentArchDesignState = {
                    ...currentArchDesignState,
                    revision: event.revision,
                };
            }
            setAuthoringControls();
            drainArchDesignWrites();
            return;
        case 'hostError':
            connectionLayoutSnapshot = undefined;
            if (simulationTaskDocument) {
                authoringPending = false;
                archDesignSemanticEditInFlight = false;
                queuedArchDesignCommand = undefined;
                pendingAddedNodeId = undefined;
                showInspectorError(event.message);
                setAuthoringControls();
                return;
            }
            setGraphControls(false);
            setCanvasState(event.message || 'Unable to render schematic');
            return;
    }
}

function installIcon(button: HTMLButtonElement, icon: IconNode): void {
    const slot = button.querySelector('[data-icon-slot]');
    if (!slot) return;
    slot.replaceChildren(createElement(icon, {
        width: 16,
        height: 16,
        'stroke-width': 1.75,
        'aria-hidden': 'true',
    }));
}

function updateInspectorToggle(): void {
    dom.inspector.hidden = !inspectorExpanded;
    dom.inspectorToggleButton.setAttribute('aria-expanded', String(inspectorExpanded));
    const label = inspectorExpanded ? 'Hide properties' : 'Show properties';
    dom.inspectorToggleButton.title = label;
    dom.inspectorToggleButton.setAttribute('aria-label', label);
    installIcon(
        dom.inspectorToggleButton,
        inspectorExpanded ? PanelRightClose : PanelRightOpen
    );
}

function installIcons(): void {
    const icons = [
        [dom.fitButton, Maximize2],
        [dom.zoomResetButton, Scan],
        [dom.relayoutButton, Workflow],
        [dom.searchButton, SearchIcon],
        [dom.minimapButton, MapIcon],
        [dom.searchPreviousButton, ChevronUp],
        [dom.searchNextButton, ChevronDown],
        [dom.addInstanceButton, AddBox],
        [dom.addLogicButton, Component],
        [dom.addSimulationButton, Activity],
        [dom.runTaskButton, Play],
        [dom.waveTaskButton, Waves],
        [dom.addPortButton, PanelTopOpen],
        [dom.connectButton, Cable],
        [dom.exportButton, FileOutput],
        [dom.deleteButton, Trash2],
    ] as const;
    for (const [button, icon] of icons) {
        installIcon(button, icon);
    }
    updateInspectorToggle();
}

function installLogicOperationOptions(): void {
    const options = ARCH_DESIGN_LOGIC_OPERATION_OPTIONS.map(operation => {
        const option = document.createElement('option');
        option.value = operation.value;
        option.textContent = operation.label;
        return option;
    });
    dom.logicOperationSelect.replaceChildren(...options);
}

installLogicOperationOptions();
installIcons();
renderCurrentInspector();

dom.inspectorForm.addEventListener('submit', event => {
    event.preventDefault();
    const control = document.activeElement;
    if (control instanceof HTMLInputElement || control instanceof HTMLSelectElement) {
        inspectorCommitters.get(control)?.();
    }
});

dom.moduleSelector.addEventListener('change', () => {
    if (currentGraph) {
        layoutSaveScheduler.flushModule(currentGraph.moduleKey);
    }
    selectedModuleKey = dom.moduleSelector.value;
    setCanvasState('Loading schematic');
    post({ type: 'selectModule', moduleKey: selectedModuleKey });
});

function fitSchematic(): boolean {
    if (dom.fitButton.disabled) return false;
    graph.zoomToFit({ padding: 24, maxScale: 1 });
    updateViewportFromGraph();
    return true;
}

function resetSchematicZoom(): boolean {
    if (dom.zoomResetButton.disabled) return false;
    graph.zoomTo(1);
    updateViewportFromGraph();
    return true;
}

function relayoutSchematic(): boolean {
    if (dom.relayoutButton.disabled) return false;
    if (currentGraph && currentLayout && archDesignDocument) {
        currentLayout.placement = createPlacement(
            currentGraph,
            assignColumns(currentGraph)
        );
        const preservedSelection = selectedObjectIds(selection.getSelectedCells());
        renderSchematic(currentGraph, currentLayout, preservedSelection);
        scheduleLayoutSave();
    } else if (currentGraph) {
        post({
            type: 'relayoutAll',
            moduleKey: currentGraph.moduleKey,
            revision: currentRevision,
        });
    }
    return currentGraph !== undefined;
}

function setSearchOpen(opening: boolean): void {
    dom.searchControls.hidden = !opening;
    dom.searchButton.setAttribute('aria-expanded', String(opening));
    if (opening) {
        dom.searchInput.focus();
        dom.searchInput.select();
    } else {
        dom.searchInput.value = '';
        runSearch('', true);
    }
}

function toggleSearch(): boolean {
    if (dom.searchButton.disabled) return false;
    setSearchOpen(dom.searchControls.hidden);
    return true;
}

function focusSearch(): boolean {
    if (dom.searchButton.disabled) return false;
    setSearchOpen(true);
    return true;
}

function closeSearch(): boolean {
    if (dom.searchControls.hidden) return false;
    setSearchOpen(false);
    dom.searchButton.focus();
    return true;
}

dom.fitButton.addEventListener('click', fitSchematic);
dom.zoomResetButton.addEventListener('click', resetSchematicZoom);
dom.relayoutButton.addEventListener('click', relayoutSchematic);
dom.searchButton.addEventListener('click', toggleSearch);

dom.searchInput.addEventListener('input', () => {
    runSearch(dom.searchInput.value, true);
});

dom.searchInput.addEventListener('keydown', event => {
    if (event.key === 'Enter') {
        event.preventDefault();
        showSearchMatch(event.shiftKey ? searchIndex - 1 : searchIndex + 1);
    } else if (event.key === 'Escape') {
        event.preventDefault();
        closeSearch();
    }
});

dom.searchPreviousButton.addEventListener('click', () => {
    showSearchMatch(searchIndex - 1);
});

dom.searchNextButton.addEventListener('click', () => {
    showSearchMatch(searchIndex + 1);
});

function toggleMinimap(): boolean {
    if (dom.minimapButton.disabled || !currentLayout || !minimapAvailable) return false;
    currentLayout.minimap = !currentLayout.minimap;
    setMinimapVisibility();
    scheduleLayoutSave();
    return true;
}

function toggleInspector(): boolean {
    inspectorExpanded = !inspectorExpanded;
    updateInspectorToggle();
    return true;
}

dom.minimapButton.addEventListener('click', toggleMinimap);
dom.inspectorToggleButton.addEventListener('click', toggleInspector);

function showDialog(dialog: HTMLDialogElement, firstControl: HTMLElement): void {
    if (!archDesignEditable || authoringPending) return;
    dialog.showModal();
    firstControl.focus();
}

dom.addInstanceDialog.addEventListener('close', () => dom.addInstanceButton.focus());
dom.addLogicDialog.addEventListener('close', () => dom.addLogicButton.focus());
dom.addPortDialog.addEventListener('close', () => dom.addPortButton.focus());

function parsedPortWidth(value: string): number | { expression: string } | undefined {
    const trimmed = value.trim();
    if (trimmed.length === 0 || trimmed === '1') return undefined;
    if (/^[1-9][0-9]*$/.test(trimmed)) return Number(trimmed);
    return { expression: trimmed };
}

function selectedInstanceModule(): Readonly<{
    moduleName: string;
    definitionKey?: string;
}> | undefined {
    const selectedValue = dom.instanceModuleSelect.value;
    if (!selectedValue || !currentArchDesignState) return undefined;
    const choice = currentArchDesignState.moduleChoices?.find(
        candidate => candidate.definitionKey === selectedValue
    );
    if (choice) {
        return {
            moduleName: choice.moduleName,
            definitionKey: choice.definitionKey,
        };
    }
    return currentArchDesignState.catalog.some(module => module.name === selectedValue)
        ? { moduleName: selectedValue }
        : undefined;
}

function renderInstanceModuleOptions(filter: string): void {
    const selectedValue = dom.instanceModuleSelect.value;
    const query = filter.trim().toLowerCase();
    const choices = currentArchDesignState?.moduleChoices?.map(choice => ({
        value: choice.definitionKey,
        label: `${choice.moduleName} (${choice.description})`,
        searchText: `${choice.moduleName}\n${choice.description}`,
    })) ?? [...new Set(
        currentArchDesignState?.catalog.map(module => module.name) ?? []
    )].map(moduleName => ({
        value: moduleName,
        label: moduleName,
        searchText: moduleName,
    }));
    const visible = query.length === 0
        ? choices
        : choices.filter(choice => choice.searchText.toLowerCase().includes(query));

    dom.instanceModuleSelect.replaceChildren(...visible.map(choice => {
        const option = document.createElement('option');
        option.value = choice.value;
        option.textContent = choice.label;
        return option;
    }));
    if (visible.some(choice => choice.value === selectedValue)) {
        dom.instanceModuleSelect.value = selectedValue;
    }
    const empty = visible.length === 0;
    dom.instanceModuleSelect.disabled = empty;
    dom.addInstanceSubmit.disabled = empty || !archDesignEditable || authoringPending;
    if (instanceNameAutomatic) updateAutomaticInstanceName();
}

function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function generatedInstanceName(moduleName: string): string {
    const pattern = new RegExp(`^u_${escapeRegExp(moduleName)}_([0-9]+)$`);
    const usedSuffixes = new Set<number>();
    for (const instance of currentArchDesignState?.design.instances ?? []) {
        const match = pattern.exec(instance.name);
        if (match) usedSuffixes.add(Number(match[1]));
    }
    let suffix = 0;
    while (usedSuffixes.has(suffix)) suffix += 1;
    return `u_${moduleName}_${suffix}`;
}

function updateAutomaticInstanceName(): void {
    const selected = selectedInstanceModule();
    dom.instanceNameInput.value = selected
        ? generatedInstanceName(selected.moduleName)
        : '';
}

type LogicOperation = ArchDesignLogic['operation'];

const logicGateOperations = new Set<LogicOperation>([
    'and', 'or', 'xor', 'nand', 'nor', 'xnor',
]);
const logicReductionOperations = new Set<LogicOperation>([
    'reduce-and', 'reduce-or', 'reduce-xor',
]);

function selectedLogicOperation(): LogicOperation | undefined {
    const operation = dom.logicOperationSelect.value;
    return ARCH_DESIGN_LOGIC_OPERATION_OPTIONS.some(option => option.value === operation)
        ? operation as LogicOperation
        : undefined;
}

function generatedLogicName(operation: LogicOperation): string {
    const base = `u_${operation.replace(/-/g, '_')}`;
    const pattern = new RegExp(`^${escapeRegExp(base)}_([0-9]+)$`);
    const usedNames = [
        ...(currentArchDesignState?.design.ports.map(item => item.name) ?? []),
        ...(currentArchDesignState?.design.instances.map(item => item.name) ?? []),
        ...(currentArchDesignState?.design.logic.map(item => item.name) ?? []),
    ];
    const usedSuffixes = new Set<number>();
    for (const name of usedNames) {
        const match = pattern.exec(name);
        if (match) usedSuffixes.add(Number(match[1]));
    }
    let suffix = 0;
    while (usedSuffixes.has(suffix)) suffix += 1;
    return `${base}_${suffix}`;
}

function updateAutomaticLogicName(): void {
    const operation = selectedLogicOperation();
    dom.logicNameInput.value = operation ? generatedLogicName(operation) : '';
}

function setLogicFieldVisible(field: HTMLElement, visible: boolean): void {
    field.hidden = !visible;
    field.querySelectorAll<HTMLInputElement>('input').forEach(input => {
        input.disabled = !visible;
    });
}

function boundedInteger(value: string, minimum: number, maximum: number): number | undefined {
    const trimmed = value.trim();
    if (!/^(0|[1-9][0-9]*)$/.test(trimmed)) return undefined;
    const result = Number(trimmed);
    return Number.isSafeInteger(result) && result >= minimum && result <= maximum
        ? result
        : undefined;
}

function requiredLogicWidth(value: string): ArchDesignWidth | undefined {
    const trimmed = value.trim();
    if (trimmed.length === 0) return undefined;
    if (/^[1-9][0-9]*$/.test(trimmed)) {
        const width = Number(trimmed);
        return Number.isSafeInteger(width) ? width : undefined;
    }
    if (/^[+-]?[0-9]+$/.test(trimmed)) return undefined;
    return { expression: trimmed };
}

function renderLogicInputWidths(count: number): void {
    const previous = Array.from(dom.logicInputWidths.querySelectorAll<HTMLInputElement>('input'))
        .map(input => input.value);
    const fields = document.createDocumentFragment();
    for (let index = 0; index < count; index += 1) {
        const wrapper = document.createElement('div');
        wrapper.className = 'logic-field';
        const label = document.createElement('label');
        label.htmlFor = `new-logic-input-width-${index}`;
        label.textContent = `Input ${index} width`;
        const input = document.createElement('input');
        input.id = `new-logic-input-width-${index}`;
        input.required = true;
        input.autocomplete = 'off';
        input.spellcheck = false;
        input.value = previous[index] ?? '1';
        wrapper.append(label, input);
        fields.append(wrapper);
    }
    dom.logicInputWidths.replaceChildren(fields);
}

function resetLogicOperationFields(operation: LogicOperation): void {
    dom.logicWidthInput.value = '1';
    dom.logicExpressionInput.value = "1'b0";
    dom.logicInputCountInput.value = '2';
    dom.logicInputWidthInput.value = '1';
    dom.logicOutputWidthInput.value = '2';
    dom.logicMsbInput.value = '0';
    dom.logicLsbInput.value = '0';
    dom.logicCountInput.value = '2';
    renderLogicInputWidths(2);

    const gate = logicGateOperations.has(operation);
    const concat = operation === 'concat';
    const slice = operation === 'slice';
    const replicate = operation === 'replicate';
    const extend = operation === 'zero-extend' || operation === 'sign-extend';
    const reduction = logicReductionOperations.has(operation);
    setLogicFieldVisible(
        dom.logicWidthField,
        operation === 'constant' || operation === 'not' || operation === 'mux' || gate
    );
    setLogicFieldVisible(dom.logicExpressionField, operation === 'constant');
    setLogicFieldVisible(dom.logicInputCountField, gate || concat);
    setLogicFieldVisible(dom.logicInputWidthsField, concat);
    setLogicFieldVisible(dom.logicInputWidthField, slice || replicate || extend || reduction);
    setLogicFieldVisible(dom.logicOutputWidthField, extend);
    setLogicFieldVisible(dom.logicSliceFields, slice);
    setLogicFieldVisible(dom.logicCountField, replicate);
}

function showAddLogicDialog(): boolean {
    if (dom.addLogicButton.disabled) return false;
    logicNameAutomatic = true;
    dom.logicNameInput.setCustomValidity('');
    dom.logicExpressionInput.setCustomValidity('');
    dom.logicOperationSelect.value = 'constant';
    resetLogicOperationFields('constant');
    updateAutomaticLogicName();
    showDialog(dom.addLogicDialog, dom.logicOperationSelect);
    return dom.addLogicDialog.open;
}

function showAddInstanceDialog(): boolean {
    if (dom.addInstanceButton.disabled) return false;
    instanceNameAutomatic = true;
    dom.instanceModuleFilter.value = '';
    renderInstanceModuleOptions('');
    showDialog(dom.addInstanceDialog, dom.instanceModuleFilter);
    return dom.addInstanceDialog.open;
}

dom.addSimulationButton.addEventListener('click', () => {
    if (dom.addSimulationButton.disabled) return;
    simulationNameAutomatic = true;
    dom.simulationKindSelect.value = 'clock';
    dom.simulationNameInput.value = generatedInstanceName('clock');
    dom.simulationNameInput.setCustomValidity('');
    showDialog(dom.addSimulationDialog, dom.simulationKindSelect);
});
dom.simulationKindSelect.addEventListener('change', () => {
    if (simulationNameAutomatic) dom.simulationNameInput.value = generatedInstanceName(dom.simulationKindSelect.value);
});
dom.simulationNameInput.addEventListener('input', () => {
    simulationNameAutomatic = false;
    dom.simulationNameInput.setCustomValidity('');
});
dom.addSimulationForm.addEventListener('submit', event => {
    event.preventDefault();
    const kind = dom.simulationKindSelect.value;
    const id = dom.simulationNameInput.value.trim();
    if (!id || !['clock', 'reset', 'stimulus', 'uart', 'spi', 'apb', 'axis', 'i2c', 'axi4', 'axi4lite', 'rgb888'].includes(kind)) return;
    if (currentArchDesignState?.design.instances.some(instance => instance.name === id)
        || currentArchDesignState?.design.logic.some(logic => logic.name === id)) {
        dom.simulationNameInput.setCustomValidity('This instance name is already in use.');
        dom.simulationNameInput.reportValidity();
        return;
    }
    pendingAddedNodeId = `instance:${id}`;
    dom.addSimulationDialog.close();
    if (!inspectorExpanded) { inspectorExpanded = true; updateInspectorToggle(); }
    sendTaskCommand('addPreset', { id, preset: defaultSimulationPreset(kind as Parameters<typeof defaultSimulationPreset>[0]) });
});
dom.runTaskButton.addEventListener('click', () => sendTaskCommand(
    currentTaskState?.execution.status === 'running' ? 'cancel' : 'run'
));
dom.waveTaskButton.addEventListener('click', () => sendTaskCommand('openWave'));

dom.addInstanceButton.addEventListener('click', showAddInstanceDialog);
dom.addLogicButton.addEventListener('click', showAddLogicDialog);

dom.instanceModuleSelect.addEventListener('change', () => {
    if (instanceNameAutomatic) updateAutomaticInstanceName();
});

dom.instanceModuleFilter.addEventListener('input', () => {
    renderInstanceModuleOptions(dom.instanceModuleFilter.value);
});

dom.instanceNameInput.addEventListener('input', () => {
    instanceNameAutomatic = false;
});

dom.logicOperationSelect.addEventListener('change', () => {
    const operation = selectedLogicOperation();
    if (!operation) return;
    resetLogicOperationFields(operation);
    if (logicNameAutomatic) updateAutomaticLogicName();
});

dom.logicNameInput.addEventListener('input', () => {
    logicNameAutomatic = false;
    dom.logicNameInput.setCustomValidity('');
});

dom.logicInputCountInput.addEventListener('change', () => {
    if (selectedLogicOperation() !== 'concat') return;
    const count = boundedInteger(dom.logicInputCountInput.value, 2, 8);
    if (count !== undefined) renderLogicInputWidths(count);
});

function showAddPortDialog(): boolean {
    if (dom.addPortButton.disabled) return false;
    dom.portNameInput.value = '';
    dom.portDirectionSelect.value = 'input';
    dom.portInoutModeSelect.value = 'tristate';
    dom.portInoutModeLabel.hidden = true;
    dom.portInoutModeSelect.hidden = true;
    dom.portWidthInput.value = '1';
    showDialog(dom.addPortDialog, dom.portNameInput);
    return dom.addPortDialog.open;
}

function toggleConnectionMode(): boolean {
    if (dom.connectButton.disabled) return false;
    const active = dom.connectButton.getAttribute('aria-pressed') !== 'true';
    dom.connectButton.setAttribute('aria-pressed', String(active));
    if (!active) cancelPendingConnection();
    refreshConnectionMagnets();
    return true;
}

function exportRtl(): boolean {
    if (dom.exportButton.disabled
        || !currentArchDesignState || !archDesignEditable || authoringPending) return false;
    if (simulationTaskDocument) { sendTaskCommand('generateTestbench'); return true; }
    authoringPending = true;
    queuedArchDesignCommand = { type: 'export' };
    setAuthoringControls();
    if (currentGraph) layoutSaveScheduler.flushModule(currentGraph.moduleKey);
    drainArchDesignWrites();
    return true;
}

function deleteSelection(): boolean {
    if (dom.deleteButton.disabled || !currentArchDesignInspector?.deleteEdit) return false;
    postArchDesignEdit(currentArchDesignInspector.deleteEdit);
    return true;
}

dom.addPortButton.addEventListener('click', showAddPortDialog);
dom.connectButton.addEventListener('click', toggleConnectionMode);
for (const [button, severity] of [
    [dom.errorCount, 'error'], [dom.warningCount, 'warning'],
] as const) {
    button.addEventListener('click', () => {
        diagnosticFilter = severity;
        renderDiagnosticDetails();
        dom.diagnosticsDialog.showModal();
    });
}
dom.exportButton.addEventListener('click', exportRtl);
dom.deleteButton.addEventListener('click', deleteSelection);

dom.addInstanceForm.addEventListener('submit', event => {
    event.preventDefault();
    const name = dom.instanceNameInput.value.trim();
    const selected = selectedInstanceModule();
    if (!name || !selected) return;
    dom.addInstanceDialog.close();
    pendingAddedNodeId = `instance:${name}`;
    postArchDesignEdit({
        type: 'addInstance',
        instance: {
            name,
            module: selected.moduleName,
            ...(selected.definitionKey === undefined
                ? {}
                : { definitionKey: selected.definitionKey }),
        },
    });
});

dom.portDirectionSelect.addEventListener('change', () => {
    const hidden = dom.portDirectionSelect.value !== 'inout';
    dom.portInoutModeLabel.hidden = hidden;
    dom.portInoutModeSelect.hidden = hidden;
});
dom.addPortForm.addEventListener('submit', event => {
    event.preventDefault();
    const name = dom.portNameInput.value.trim();
    const direction = dom.portDirectionSelect.value as ArchDesignPortDirection;
    if (!name || (direction !== 'input' && direction !== 'output' && direction !== 'inout')) {
        return;
    }
    const width = parsedPortWidth(dom.portWidthInput.value);
    dom.addPortDialog.close();
    postArchDesignEdit({
        type: 'addPort',
        port: { name, direction, ...(width === undefined ? {} : { width }),
            ...(direction === 'inout' ? {
                inoutMode: dom.portInoutModeSelect.value === 'direct' ? 'direct' : 'tristate',
            } : {}),
        },
    });
});

function logicNameAvailable(name: string): boolean {
    if (!currentArchDesignState) return false;
    return !currentArchDesignState.design.ports.some(item => item.name === name)
        && !currentArchDesignState.design.instances.some(item => item.name === name)
        && !currentArchDesignState.design.logic.some(item => item.name === name);
}

function readLogicForm(): ArchDesignLogic | undefined {
    const operation = selectedLogicOperation();
    const name = dom.logicNameInput.value.trim();
    dom.logicNameInput.setCustomValidity('');
    dom.logicExpressionInput.setCustomValidity('');
    if (!operation || !/^[A-Za-z_][A-Za-z0-9_$]*$/.test(name)) return undefined;
    if (!logicNameAvailable(name)) {
        dom.logicNameInput.setCustomValidity('Name is already in use');
        dom.logicNameInput.reportValidity();
        return undefined;
    }
    const width = requiredLogicWidth(dom.logicWidthInput.value);
    const inputWidth = requiredLogicWidth(dom.logicInputWidthInput.value);
    if (operation === 'constant') {
        const expression = dom.logicExpressionInput.value.trim();
        if (!width || !isSafeDefaultExpression(expression)) {
            if (!isSafeDefaultExpression(expression)) {
                dom.logicExpressionInput.setCustomValidity('Enter a constant expression');
                dom.logicExpressionInput.reportValidity();
            }
            return undefined;
        }
        return { name, operation, width, expression };
    }
    if (operation === 'not' || operation === 'mux') {
        return width ? { name, operation, width } : undefined;
    }
    if (logicGateOperations.has(operation)) {
        const inputCount = boundedInteger(dom.logicInputCountInput.value, 2, 8);
        return width && inputCount !== undefined
            ? {
                name,
                operation: operation as 'and' | 'or' | 'xor' | 'nand' | 'nor' | 'xnor',
                width,
                inputCount,
            }
            : undefined;
    }
    if (operation === 'concat') {
        const inputCount = boundedInteger(dom.logicInputCountInput.value, 2, 8);
        if (inputCount === undefined) return undefined;
        const inputWidths = Array.from(
            dom.logicInputWidths.querySelectorAll<HTMLInputElement>('input')
        )
            .map(input => requiredLogicWidth(input.value));
        return inputWidths.length === inputCount && inputWidths.every(item => item !== undefined)
            ? { name, operation, inputWidths: inputWidths as ArchDesignWidth[] }
            : undefined;
    }
    if (operation === 'slice') {
        const msb = boundedInteger(dom.logicMsbInput.value, 0, Number.MAX_SAFE_INTEGER);
        const lsb = boundedInteger(dom.logicLsbInput.value, 0, Number.MAX_SAFE_INTEGER);
        return inputWidth && msb !== undefined && lsb !== undefined
            && msb >= lsb && (typeof inputWidth !== 'number' || msb < inputWidth)
            ? { name, operation, inputWidth, msb, lsb }
            : undefined;
    }
    if (operation === 'replicate') {
        const count = boundedInteger(dom.logicCountInput.value, 1, 65_536);
        return inputWidth && count !== undefined
            ? { name, operation, inputWidth, count }
            : undefined;
    }
    if (operation === 'zero-extend' || operation === 'sign-extend') {
        const outputWidth = requiredLogicWidth(dom.logicOutputWidthInput.value);
        return inputWidth && outputWidth
            && (typeof inputWidth !== 'number'
                || typeof outputWidth !== 'number'
                || outputWidth >= inputWidth)
            ? { name, operation, inputWidth, outputWidth }
            : undefined;
    }
    return inputWidth && logicReductionOperations.has(operation)
        ? {
            name,
            operation: operation as 'reduce-and' | 'reduce-or' | 'reduce-xor',
            inputWidth,
        }
        : undefined;
}

dom.addLogicForm.addEventListener('submit', event => {
    event.preventDefault();
    const logic = readLogicForm();
    if (!logic) return;
    dom.addLogicDialog.close();
    postArchDesignEdit({ type: 'addLogic', logic });
});

document.querySelectorAll<HTMLButtonElement>('[data-dialog-cancel]').forEach(button => {
    button.addEventListener('click', () => button.closest('dialog')?.close());
});

dom.canvas.addEventListener('keydown', event => {
    if (event.key !== 'Enter' || !(event.target instanceof Element)) return;
    const cellElement = event.target.closest('.x6-cell[data-cell-id]');
    const cellId = cellElement?.getAttribute('data-cell-id');
    const cell = cellId ? graph.getCellById(cellId) : undefined;
    if (!cell) return;
    const command = navigationCommandForCell(
        navigationTargetForCell(cell),
        archDesignDocument || event.shiftKey
    );
    if (!command) return;
    event.preventDefault();
    post(command);
});

graph.on('node:moved', ({ node }) => {
    queueNodeMove(node);
});

graph.on('scale', updateViewportFromGraph);
graph.on('translate', updateViewportFromGraph);

graph.on('cell:dblclick', ({ cell }) => {
    const command = navigationCommandForCell(navigationTargetForCell(cell), archDesignDocument);
    if (command) post(command);
});

graph.on('edge:click', ({ edge }) => {
    const data = cellData(edge);
    if (data?.objectType === 'network') selectNetwork(data.objectId);
});

graph.on('node:click', ({ node }) => {
    const data = cellData(node);
    if (data?.junction) selectNetwork(data.objectId);
});

function selectPin(node: Cell, port: string | null | undefined): void {
    const data = cellData(node);
    if (!data?.node || !port || !data.node.pins.some(pin => pin.id === port)) return;
    selectedNetworkId = undefined;
    selectedPinId = port;
    syncingSelection = true;
    selection.clean();
    syncingSelection = false;
    refreshNetworkSelectionStyles();
    updateSelectionStatus([]);
}

function eventClientPoint(event: Event): { x: number; y: number } | undefined {
    if (event instanceof MouseEvent) return { x: event.clientX, y: event.clientY };
    if (event instanceof TouchEvent) {
        const touch = event.touches[0] ?? event.changedTouches[0];
        if (touch) return { x: touch.clientX, y: touch.clientY };
    }
    return undefined;
}

function portAtSelectionBoxPoint(box: Element, event: Event): {
    node: Node;
    port: string;
    bodyHit: boolean;
    point: { x: number; y: number };
} | undefined {
    const point = eventClientPoint(event);
    const nodeId = box.getAttribute('data-cell-id');
    const node = nodeId ? graph.getCellById(nodeId) : undefined;
    const view = node && graph.findViewByCell(node);
    if (!point || !node?.isNode() || !view) return undefined;
    const portBodies = view.container.querySelectorAll<SVGElement>('.x6-port-body[port]');
    for (let index = 0; index < portBodies.length; index += 1) {
        const portBody = portBodies[index];
        const port = portBody.getAttribute('port');
        if (!port) continue;
        const label = portBody.parentElement?.querySelector('.x6-port-label');
        const containsPoint = (target: Element): boolean => {
            const bounds = target.getBoundingClientRect();
            return point.x >= bounds.left && point.x <= bounds.right
                && point.y >= bounds.top && point.y <= bounds.bottom;
        };
        const bodyHit = containsPoint(portBody);
        if (bodyHit || (label !== null && label !== undefined && containsPoint(label))) {
            return { node, port, bodyHit, point };
        }
    }
    return undefined;
}

function selectPinTarget(event: Event): void {
    if (!(event.target instanceof Element)) return;
    const label = event.target.closest('.x6-port-label');
    if (label) {
        event.stopPropagation();
        const port = label.parentElement
            ?.querySelector<SVGElement>('.x6-port-body[port]')
            ?.getAttribute('port');
        const nodeId = label.closest('.x6-node[data-cell-id]')?.getAttribute('data-cell-id');
        const node = nodeId ? graph.getCellById(nodeId) : undefined;
        if (node) selectPin(node, port);
        return;
    }
    const selectionBox = event.target.closest(
        '.x6-widget-selection-box[data-cell-id]'
    );
    if (!selectionBox) return;
    const hit = portAtSelectionBoxPoint(selectionBox, event);
    if (!hit) return;
    event.stopPropagation();
    selectPin(hit.node, hit.port);
    if (hit.bodyHit && (!(event instanceof MouseEvent) || event.button === 0)) {
        const local = graph.clientToLocal(hit.point.x, hit.point.y);
        handleConnectionPinClick(hit.node, hit.port, local.x, local.y);
    }
}

document.addEventListener('mousedown', selectPinTarget, true);
document.addEventListener('touchstart', selectPinTarget, true);

graph.on('node:port:click', ({ e, node, port, x, y }) => {
    selectPin(node, port);
    if (port && e.target instanceof Element && e.target.closest('.x6-port-body')) {
        handleConnectionPinClick(node, port, x, y);
    }
});

document.addEventListener('mousemove', event => {
    if (!pendingConnectionPreview || !graph.hasCell(pendingConnectionPreview)) return;
    pendingConnectionPreview.setTarget(graph.clientToLocal(event.clientX, event.clientY));
});

function editableShortcutTarget(target: EventTarget | null): boolean {
    return target instanceof Element && target.closest(
        'input, select, textarea, [contenteditable]:not([contenteditable="false"])'
    ) !== null;
}

function closeActiveDialog(): boolean {
    const dialog = document.querySelector<HTMLDialogElement>('dialog[open]');
    if (!dialog) return false;
    dialog.close();
    if (dialog === dom.addInstanceDialog) dom.addInstanceButton.focus();
    if (dialog === dom.addLogicDialog) dom.addLogicButton.focus();
    if (dialog === dom.addSimulationDialog) dom.addSimulationButton.focus();
    if (dialog === dom.addPortDialog) dom.addPortButton.focus();
    return true;
}

function openSelectedDefinition(): boolean {
    const selected = selection.getSelectedCells();
    const cell = selected[selected.length - 1];
    if (!cell) return false;
    const command = navigationCommandForCell(navigationTargetForCell(cell), true);
    if (!command) return false;
    post(command);
    return true;
}

function cancelPendingConnectionShortcut(): boolean {
    if (!pendingConnection) return false;
    cancelPendingConnection();
    return true;
}

function handleArchDesignShortcut(key: string): boolean {
    switch (key) {
        case 'a': return showAddInstanceDialog();
        case 'l': return showAddLogicDialog();
        case 'p': return showAddPortDialog();
        case 'c': return toggleConnectionMode();
        case 'e': return exportRtl();
        case 'f': return fitSchematic();
        case '0': return resetSchematicZoom();
        case 'r': return relayoutSchematic();
        case 'm': return toggleMinimap();
        case 'i': return toggleInspector();
        case 'delete':
        case 'backspace': return deleteSelection();
        case 'enter': return openSelectedDefinition();
        default: return false;
    }
}

document.addEventListener('keydown', event => {
    if (event.defaultPrevented || event.isComposing || event.repeat) return;
    if (event.key === 'Escape') {
        const handled = closeActiveDialog()
            || closeSearch()
            || cancelPendingConnectionShortcut();
        if (handled) event.preventDefault();
        return;
    }
    if (document.querySelector('dialog[open]')) return;

    const key = event.key.toLocaleLowerCase();
    if ((event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey && key === 'f') {
        if (focusSearch()) event.preventDefault();
        return;
    }
    if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey
        || !archDesignDocument || editableShortcutTarget(event.target)) return;

    if (handleArchDesignShortcut(key)) event.preventDefault();
});

graph.on('blank:click', () => {
    selectNetwork(undefined);
});

selection.on('selection:changed', ({ selected }) => {
    if (applyingLayout || syncingSelection) return;
    selectedNetworkId = undefined;
    selectedPinId = undefined;
    refreshNetworkSelectionStyles();
    updateSelectionStatus(selected);
});

selection.on('box:mousedown', ({ nodes }) => {
    selectionBoxOrigins = applyingLayout
        ? new Map()
        : new Map(nodes.map(node => [node.id, nodePosition(node)]));
});

selection.on('box:mouseup', () => {
    const origins = selectionBoxOrigins;
    selectionBoxOrigins = new Map();
    if (applyingLayout) return;
    for (const [nodeId, origin] of origins) {
        const cell = graph.getCellById(nodeId);
        if (!cell?.isNode()) continue;
        const position = nodePosition(cell);
        if (position.x !== origin.x || position.y !== origin.y) {
            queueNodeMove(cell);
        }
    }
});

const resizeObserver = new ResizeObserver(() => {
    graph.resize(dom.canvas.clientWidth, dom.canvas.clientHeight);
});
resizeObserver.observe(dom.canvasRegion);

window.addEventListener('pagehide', flushLayoutSavesForUnload);
window.addEventListener('beforeunload', flushLayoutSavesForUnload);

window.addEventListener('message', event => {
    if (!event.data || typeof event.data !== 'object') return;
    const type = (event.data as { type?: unknown }).type;
    if (type === 'initialize' || type === 'graph' || type === 'diagnostics'
        || type === 'simulationTaskState'
        || type === 'archDesignState' || type === 'archDesignLayoutSaved'
        || type === 'archDesignRevisionChanged'
        || type === 'hostError') {
        handleHostEvent(event.data as HostEvent);
    }
});

dom.shell.dataset.runtimeReady = 'true';
post({ type: 'ready' });
