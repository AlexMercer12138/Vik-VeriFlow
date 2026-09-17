/** Text-only templates. The editor decides where to insert them; no syntax relocation. */
export interface HdlTemplate {
    id: string;
    label: string;
    description: string;
    text: string;
    /** {{index:default}} placeholders and {{index}} mirrors; all other text is literal HDL. */
    snippet?: string;
}
export const hdlTemplates: readonly HdlTemplate[] = [
    { snippet: "reg {{1:clk}} = 1'b0;\nalways #({{2:5}}) {{1}} = ~{{1}};\n", id: 'clock', label: 'Clock', description: 'Module scope; half period in the current timescale',
        text: 'reg clk = 1\'b0;\nalways #(5) clk = ~clk;\n' },
    { snippet: "reg {{1:rst_n}} = 1'b0;\ninitial begin\n    #{{2:100}};\n    {{1}} = 1'b1;\nend\n", id: 'reset', label: 'Reset', description: 'Module scope; edit reset polarity and duration',
        text: "reg rst_n = 1'b0;\ninitial begin\n    #100;\n    rst_n = 1'b1;\nend\n" },
    { id: 'timeout', label: 'Timeout', description: 'Module scope; finish the Testbench after a delay',
        text: 'initial begin\n    #1000000;\n    $display("Simulation timeout");\n    $finish;\nend\n' },
    { snippet: 'initial begin\n    $dumpfile("{{1:waves.vcd}}");\n    $dumpvars(0, {{2:tb_top}});\nend\n', id: 'waveform', label: 'Waveform', description: 'Module scope; edit the VCD filename and top module',
        text: 'initial begin\n    $dumpfile("waves.vcd");\n    $dumpvars(0, tb_top);\nend\n' },
    { id: 'initial', label: 'Initial', description: 'Module scope; initialization or stimulus process', text: 'initial begin\n    // Stimulus\nend\n' },
    { snippet: 'repeat ({{1:10}}) @(posedge {{2:clk}});\n', id: 'wait-cycles', label: 'Wait Cycles', description: 'Inside a process; wait for clock edges', text: 'repeat (10) @(posedge clk);\n' },
    { id: 'finish', label: 'Finish', description: 'Inside a process; finish the Testbench', text: '$finish;\n' },
    { id: 'timescale', label: 'Timescale', description: 'File scope; insert the timescale directive at the cursor', text: '`timescale 1ns / 1ps\n' },
    { id: 'combinational', label: 'Combinational', description: 'Module scope; always @*', text: 'always @* begin\n    // Assign every output on every path.\nend\n' },
    { id: 'sequential', label: 'Sequential', description: 'Module scope; asynchronous active-low reset',
        text: "always @(posedge clk or negedge rst_n) begin\n    if (!rst_n) begin\n        // Reset registers.\n    end else begin\n        // Update registers using <=.\n    end\nend\n" },
];
export function renderHdlTemplate(id: string): string {
    const template = hdlTemplates.find(item => item.id === id);
    if (!template) throw new Error(`Unknown HDL template: ${id}`);
    return template.text;
}
