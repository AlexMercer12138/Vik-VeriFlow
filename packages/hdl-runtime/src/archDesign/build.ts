import * as path from 'node:path';
import { adPhysicalPorts, exportArchDesignRtl, generateConstraints, parseArchDesignRtlMarker, type ArchDesign, type ArchDesignLanguage, type ArchDesignModuleDefinition } from '@veriflow/schematic-core/arch-design';
import { createInterfaceProtocolCatalog, type InterfaceProtocolCatalog } from '@veriflow/schematic-core/interfaces';
import { resolvePhysicalConfiguration } from '../physical/resolveBoard';
import { constraintArtifacts } from '../physical/constraintArtifacts';
import { optionalFile, type ArtifactPlan } from '../artifacts/plan';
export type ArchDesignBuildOptions = {
    sourceText?: string;
    inputs?: ArtifactPlan['inputs'];
    output?: string;
    constraintsOutput?: string;
    language?: ArchDesignLanguage;
    rtlOnly?: boolean;
    interfaceCatalog?: InterfaceProtocolCatalog;
    configPath?: string;
};
export async function prepareArchDesignBuild(source: string, design: ArchDesign, definitions: readonly ArchDesignModuleDefinition[], options: ArchDesignBuildOptions = {}): Promise<ArtifactPlan> {
    const plan: ArtifactPlan = { diagnostics: [], artifacts: [], inputs: [...options.inputs ?? []] }, input = options.sourceText ?? await optionalFile(source);
    if (input !== undefined)
        plan.inputs.push({ path: source, text: input });
    const language = options.language ?? design.export.language ?? 'verilog', extension = language === 'verilog' ? '.v' : '.sv';
    const output = options.output ?? (design.export.output ? path.resolve(path.dirname(source), design.export.output) : source.slice(0, -path.extname(source).length) + extension);
    if (path.extname(output).toLowerCase() !== extension)
        throw new Error(`Output file extension must be ${extension} for ${language}: ${output}`);
    const catalog = options.interfaceCatalog ?? createInterfaceProtocolCatalog(), generated = exportArchDesignRtl(design, definitions, { language, sourcePath: path.relative(path.dirname(output), source).replace(/\\/g, '/'), interfaceCatalog: catalog });
    if (generated.status === 'invalid') {
        plan.diagnostics.push(...generated.diagnostics);
        return plan;
    }
    const sourceLine = generated.text.split('\n')[1];
    plan.artifacts.push({ kind: 'rtl', path: output, text: generated.text, owns: text => parseArchDesignRtlMarker(text)?.language === language && text.split('\n')[1] === sourceLine });
    if (design.physical && !options.rtlOnly) {
        try {
            const board = await resolvePhysicalConfiguration(source, design.physical, { configPath: options.configPath, onInput: (file, text) => plan.inputs.push({ path: file, text }) });
            const constraints = generateConstraints(board, design.physical, adPhysicalPorts(design, definitions, catalog));
            if (constraints.text === undefined)
                plan.diagnostics.push(...constraints.diagnostics.map(d => ({ code: 'PHYSICAL_INVALID', path: '$.physical', message: d.message })));
            else {
                const configured = design.export.constraintsOutput;
                const target = options.constraintsOutput ?? (configured ? path.resolve(path.dirname(source), configured) : output.slice(0, -path.extname(output).length) + board.model.extension);
                if (path.extname(target) !== board.model.extension)
                    throw new Error('Constraint output must use ' + board.model.extension);
                plan.artifacts.push(...await constraintArtifacts(source, target, constraints.text));
            }
        }
        catch (e) {
            plan.diagnostics.push({ code: 'PHYSICAL_BUILD', path: '$.physical', message: (e as Error).message });
        }
    }
    if (plan.diagnostics.length)
        plan.artifacts = [];
    return plan;
}
