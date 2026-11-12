import {
    projectArchDesignGraph,
    applyArchDesignEdit,
    parseArchDesignText,
    serializeArchDesign,
    reconcileArchDesignInstanceParameters,
    type ArchDesign,
    type ArchDesignModuleDefinition,
    type ArchDesignEdit,
} from '@veriflow/schematic-core/arch-design';
import { createInterfaceProtocolCatalog, type InterfaceProtocolCatalog } from '@veriflow/schematic-core/interfaces';
import type { WebviewCommand, HostEvent } from './protocol';
import type { WorkbenchDocumentHost, WorkbenchDocumentSnapshot } from './documentHost';
import { archDesignLayout, archDesignPresentationFromLayout, projectArchDesignInspectorData } from './editorSupport';
import { relayoutAll, type SchematicLayout } from './layoutStore';

export interface ArchDesignSessionServices {
    documents: WorkbenchDocumentHost;
    definitions(filepath: string, design: ArchDesign): Promise<readonly ArchDesignModuleDefinition[]>;
    interfaces?(filepath: string): Promise<InterfaceProtocolCatalog>;
    normalizeDesign?(filepath: string, design: ArchDesign, definitions: readonly ArchDesignModuleDefinition[]): Promise<ArchDesign> | ArchDesign;
    moduleChoices?(filepath: string, design: ArchDesign, definitions: readonly ArchDesignModuleDefinition[]): Promise<readonly Readonly<{
        label: string;
        description: string;
        moduleName: string;
        definitionKey: string;
    }>[]>;
    command?(filepath: string, command: Extract<WebviewCommand,
        { type: 'exportArchDesign' | 'buildArchDesign' | 'openPhysicalPins' }>): Promise<void>;
}

export class ArchDesignSession {
    private filepath?: string;
    private snapshot?: WorkbenchDocumentSnapshot;
    private design?: ArchDesign;
    private disposed = false;
    private readonly listeners = new Set<(event: HostEvent) => void>();

    constructor(private readonly services: ArchDesignSessionServices) {}

    get revision(): string | undefined { return this.snapshot?.version; }

    get currentDesign(): ArchDesign | undefined { return this.design; }

    onEvent(listener: (event: HostEvent) => void): () => void {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    async open(filepath: string): Promise<void> {
        this.assertActive();
        this.filepath = filepath;
        await this.refresh();
    }

    async refresh(): Promise<void> {
        this.assertActive();
        if (!this.filepath) throw new Error('Open an Arch Design first.');
        const filepath = this.filepath!;
        const snapshot = await this.services.documents.readText(filepath);
        this.snapshot = snapshot;
        const parsed = parseArchDesignText(snapshot.text);
        if (parsed.status === 'invalid') {
            this.design = undefined;
            this.emit({ type: 'initialize', fileUri: filepath, modules: [], selectedModuleKey: '', documentKind: 'arch-design', editable: false });
            this.emit({ type: 'diagnostics', errors: parsed.diagnostics.length, warnings: 0 });
            this.emit({ type: 'archDesignState', status: 'invalid', revision: snapshot.version, diagnostics: parsed.diagnostics });
            return;
        }
        if (parsed.status === 'unsupported') {
            this.design = undefined;
            const reason = `Schema version ${parsed.schemaVersion} is not supported`;
            this.emit({ type: 'initialize', fileUri: filepath, modules: [], selectedModuleKey: '', documentKind: 'arch-design', editable: false });
            this.emit({ type: 'archDesignState', status: 'readonly', revision: snapshot.version, schemaVersion: parsed.schemaVersion, reason });
            return;
        }

        const interfaces = await (this.services.interfaces?.(filepath) ?? Promise.resolve(createInterfaceProtocolCatalog()));
        const definitions = await this.services.definitions(filepath, parsed.design);
        const normalized = await this.services.normalizeDesign?.(filepath, parsed.design, definitions) ?? parsed.design;
        const design = reconcileArchDesignInstanceParameters(normalized, definitions);
        this.design = design;
        const projected = projectArchDesignGraph(design, definitions, { fileUri: filepath, interfaceCatalog: interfaces });
        const choices = await this.services.moduleChoices?.(filepath, design, definitions);
        const validation = projected.validation;
        this.emit({ type: 'initialize', fileUri: filepath,
            modules: [{ key: projected.graph.moduleKey, name: projected.graph.moduleName }],
            selectedModuleKey: projected.graph.moduleKey, documentKind: 'arch-design', editable: true });
        this.emit({ type: 'graph', revision: snapshot.version, graph: projected.graph,
            layout: archDesignLayout(design, projected.graph), fitOnFirstRender: true });
        this.emit({ type: 'diagnostics', errors: validation.diagnostics.length,
            warnings: validation.warnings.length,
            details: [...validation.diagnostics.map(item => ({ ...item, severity: 'error' as const })),
                ...validation.warnings.map(item => ({ ...item, severity: 'warning' as const }))] });
        this.emit({ type: 'archDesignState', status: 'editable', revision: snapshot.version, design,
            catalog: definitions, ...(choices ? { moduleChoices: choices } : {}), validation,
            inspector: projectArchDesignInspectorData(design, definitions, interfaces) });
    }

    async handle(command: WebviewCommand): Promise<void> {
        this.assertOpen();
        if (command.type === 'ready') return this.refresh();
        if ('revision' in command && command.revision !== this.snapshot!.version) {
            throw new Error('The Arch Design changed; retry this action.');
        }
        if (command.type === 'editArchDesign') {
            await this.applyEdit(command.edit, command.revision);
            return;
        }
        if (command.type === 'saveLayout' || command.type === 'relayoutAll') {
            const { graph, layout } = await this.currentProjection();
            if (command.moduleKey !== graph.moduleKey) return;
            const nextLayout: SchematicLayout = command.type === 'saveLayout'
                ? command.layout : relayoutAll(graph, layout);
            const next = { ...this.design!, presentation: archDesignPresentationFromLayout(this.design!, graph, nextLayout) };
            await this.write(next, command.revision);
            this.emit({ type: 'archDesignLayoutSaved', revision: this.revision! });
            return;
        }
        if (command.type === 'buildArchDesign' || command.type === 'exportArchDesign' || command.type === 'openPhysicalPins') {
            await this.services.command?.(this.filepath!, command);
        }
    }

    async replaceDesign(design: ArchDesign, expectedVersion = this.snapshot?.version): Promise<void> {
        if (!expectedVersion) throw new Error('Open an Arch Design first.');
        await this.write(design, expectedVersion);
    }

    dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        this.listeners.clear();
    }

    private async applyEdit(edit: ArchDesignEdit, expectedVersion: string): Promise<void> {
        const interfaces = await (this.services.interfaces?.(this.filepath!) ?? Promise.resolve(createInterfaceProtocolCatalog()));
        const next = applyArchDesignEdit(this.design!, edit, interfaces);
        if (edit.type === 'connect') {
            const definitions = await this.services.definitions(this.filepath!, next);
            const result = projectArchDesignGraph(next, definitions, { fileUri: this.filepath!, interfaceCatalog: interfaces });
            const conflict = result.validation.diagnostics.find(item => item.code === 'AD_MULTIPLE_DRIVERS');
            if (conflict) throw new Error(conflict.message);
        }
        await this.write(next, expectedVersion);
    }

    private async write(design: ArchDesign, expectedVersion: string): Promise<void> {
        const filepath = this.filepath!;
        await this.services.documents.replaceText(filepath, expectedVersion, serializeArchDesign(design));
        await this.refresh();
    }

    private async currentProjection(): Promise<{ graph: import('@veriflow/schematic-core').SchematicGraph; layout: SchematicLayout }> {
        const definitions = await this.services.definitions(this.filepath!, this.design!);
        const interfaces = await (this.services.interfaces?.(this.filepath!) ?? Promise.resolve(createInterfaceProtocolCatalog()));
        const projected = projectArchDesignGraph(this.design!, definitions, { fileUri: this.filepath!, interfaceCatalog: interfaces });
        return { graph: projected.graph, layout: archDesignLayout(this.design!, projected.graph) };
    }

    private emit(event: HostEvent): void {
        if (!this.disposed) this.listeners.forEach(listener => listener(event));
    }

    private assertActive(): void {
        if (this.disposed) throw new Error('Arch Design session is disposed.');
    }

    private assertOpen(): void {
        this.assertActive();
        if (!this.filepath || !this.snapshot) throw new Error('Open an Arch Design first.');
    }
}
