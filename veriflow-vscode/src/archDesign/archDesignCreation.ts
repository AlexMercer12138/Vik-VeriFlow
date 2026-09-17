import { createEmptyArchDesignText } from '@veriflow/schematic-core/arch-design';

export type ArchDesignModuleValidator = (value: string) => string | undefined;

export type ArchDesignCreationServices<Resource> = Readonly<{
    filename(target: Resource): string;
    requestTarget(): PromiseLike<Resource | undefined>;
    writeFile(target: Resource, text: string): PromiseLike<void>;
    openEditor(target: Resource): PromiseLike<void>;
    reportError(message: string): PromiseLike<void>;
}>;

export function validateArchDesignModule(value: string): string | undefined {
    try {
        if (new Set('always and assign automatic begin buf bufif0 bufif1 case casex casez cell cmos config deassign default defparam design disable edge else end endcase endconfig endfunction endgenerate endmodule endprimitive endspecify endtable endtask event for force forever fork function generate genvar highz0 highz1 if ifnone incdir include initial inout input instance integer join large liblist library localparam macromodule medium module nand negedge nmos nor noshowcancelled not notif0 notif1 or output parameter pmos posedge primitive pull0 pull1 pulldown pullup pulsestyle_onevent pulsestyle_ondetect rcmos real realtime reg release repeat rnmos rpmos rtran rtranif0 rtranif1 scalared showcancelled signed small specify specparam strong0 strong1 supply0 supply1 table task time tran tranif0 tranif1 tri tri0 tri1 triand trior trireg unsigned use vectored wait wand weak0 weak1 while wire wor xnor xor'.split(' ')).has(value)) return 'Enter a valid Verilog module name';
        createEmptyArchDesignText(value);
        return undefined;
    } catch {
        return 'Enter a valid Verilog module name';
    }
}

export async function createArchDesign<Resource>(
    services: ArchDesignCreationServices<Resource>
): Promise<Resource | undefined> {
    const target = await services.requestTarget();
    if (target === undefined) return undefined;

    try {
        const stem = services.filename(target).replace(/\.ad$/i, '');
        let module = stem.replace(/[^a-zA-Z0-9_$]/g, '_');
        if (!/^[a-zA-Z_]/.test(module)) module = 'design_' + module;
        if (validateArchDesignModule(module)) module = 'design_' + module;
        const text = createEmptyArchDesignText(module);
        await services.writeFile(target, text);
        await services.openEditor(target);
        return target;
    } catch (error) {
        await services.reportError(
            error instanceof Error ? error.message : String(error)
        );
        return undefined;
    }
}
