import * as path from 'node:path';
import {
    adPhysicalPorts, exportArchDesignRtl, generateXdc, parseArchDesignRtlMarker,
    type ArchDesign, type ArchDesignLanguage, type ArchDesignModuleDefinition,
} from '@veriflow/schematic-core/arch-design';
import { createInterfaceProtocolCatalog, type InterfaceProtocolCatalog } from '@veriflow/schematic-core/interfaces';
import { resolvePhysicalBoard } from '../physical/resolveBoard';
import { optionalFile, type ArtifactPlan } from '../artifacts/plan';

export type ArchDesignBuildOptions = {
    sourceText?: string; inputs?: ArtifactPlan['inputs'];
    output?: string; xdcOutput?: string; language?: ArchDesignLanguage; rtlOnly?: boolean;
    interfaceCatalog?: InterfaceProtocolCatalog; interfaceRoot?: string; configPath?: string;
};
export function generatedXdc(source: string, output: string, text: string): string {
    return `# vik-veriflow:generated xdc source=${encodeURIComponent(path.relative(path.dirname(output), source).replace(/\\/g, '/'))}\n${text}`;
}
export async function prepareArchDesignBuild(
    source: string, design: ArchDesign, definitions: readonly ArchDesignModuleDefinition[], options: ArchDesignBuildOptions = {}
): Promise<ArtifactPlan> {
    const plan: ArtifactPlan = { diagnostics: [], artifacts: [], inputs: [...options.inputs ?? []] };
    const input = options.sourceText ?? await optionalFile(source);
    if (input !== undefined) plan.inputs.push({ path: source, text: input });
    const language = options.language ?? design.export.language ?? 'verilog';
    const extension = language === 'verilog' ? '.v' : '.sv';
    const output = options.output ?? (design.export.output ? path.resolve(path.dirname(source), design.export.output)
        : source.slice(0, -path.extname(source).length) + extension);
    if (path.extname(output).toLowerCase() !== extension) throw new Error(`Output file extension must be ${extension} for ${language}: ${output}`);
    const catalog = options.interfaceCatalog ?? createInterfaceProtocolCatalog();
    const generated = exportArchDesignRtl(design, definitions, { language,
        sourcePath: path.relative(path.dirname(output), source).replace(/\\/g, '/'), interfaceCatalog: catalog });
    if (generated.status === 'invalid') { plan.diagnostics.push(...generated.diagnostics); return plan; }
    const sourceLine = generated.text.split('\n')[1];
    plan.artifacts.push({ kind: 'rtl', path: output, text: generated.text,
        owns: text => parseArchDesignRtlMarker(text)?.language === language && text.split('\n')[1] === sourceLine });
    if (design.physical && !options.rtlOnly) {
        try {
            const board = await resolvePhysicalBoard(source, design.physical.board, { ...options, onInput: (file, text) => plan.inputs.push({ path: file, text }) });
            const xdc = generateXdc(board, design.physical, adPhysicalPorts(design, definitions, catalog));
            if (!xdc.text) plan.diagnostics.push(...xdc.diagnostics.map(d => ({ ...d, code: 'PHYSICAL_INVALID', path: '$.physical' })));
            else {
                const target = options.xdcOutput ?? (design.export.xdcOutput ? path.resolve(path.dirname(source), design.export.xdcOutput)
                    : output.slice(0, -path.extname(output).length) + '.xdc');
                if (path.extname(target).toLowerCase() !== '.xdc') throw new Error('Constraint output must use .xdc');
                const text = generatedXdc(source, target, xdc.text), header = text.split('\n')[0];
                plan.artifacts.push({ kind: 'xdc', path: target, text, owns: previous => previous.split('\n')[0] === header });
            }
        } catch (error) { plan.diagnostics.push({ code: 'PHYSICAL_BUILD', path: '$.physical', message: (error as Error).message }); }
    }
    if (plan.diagnostics.length) plan.artifacts = [];
    return plan;
}
