# Verilog Design Flow (VeriFlow)

[简体中文](https://github.com/AlexMercer12138/Vik-VeriFlow/blob/main/veriflow-vscode/README_zh-CN.md)

**Verilog Design Flow** brings the complete Verilog/SystemVerilog workflow into VS Code: module scanning, quick simulation, waveform viewing, and graphical HDL design.

## Requirements

- VS Code **1.82.0+**
- No external simulator required: uses the built-in **Icarus Verilog WASM** simulator by default.
- No external waveform tool required: uses the built-in **VCD waveform viewer** by default.
- Local tools can be invoked through configurable commands.

## Quick Start

1. Open a `.v` / `.sv` file.
2. Right-click inside the file → **VeriFlow** → insert a template / instantiate a module / format the document / run a simulation.
3. Open **VeriFlow** from the Activity Bar.
4. The sidebar provides module browsing → graphical top-level design → graphical Testbench design.

## Features

### 1. One-Click Simulation

Right-click inside a Testbench file → **VeriFlow** → **Run Current Testbench**. VeriFlow automatically uses the current file as the top level and runs dependency analysis → compilation → simulation → waveform viewing.

![One-click simulation](https://i.imgs.ovh/2026/09/18/95096c5e37272e6e89f23df5d97af5f5.gif)

### 2. Architecture Design

Select **Create Architecture Design** under **Architecture Design** in the sidebar to create an architecture design canvas. Add Verilog / SystemVerilog modules and connect them to quickly design your project's top level.

- Automatically recognizes **APB, AHB, and AXI** bus interfaces for quick master/slave connections.
- Built-in **Logic Utility** components provide common combinational logic for more flexible connections.
- **Pins / XDC** shares saved boards between projects through `~/.veriflow_config.json`. Import a board once, select its interfaces on the left, assign top-level ports in the middle by dragging from the right, then confirm to generate XDC. Selection locks conflicting pins and mandatory groups before assignment. AD saves selections and bindings only on confirmation; RTL uses the same temporary tool with a save dialog. Bus dragging also binds matching P/N ports. AD XDC follows the RTL output stem and appears beside RTL in the AD tree. Only reusable interface definitions ship with the extension.

Select a board-declared Bank voltage first, then explicitly choose an allowed I/O standard in each compact two-line assignment row. AMD UltraScale/UltraScale+ choices follow Bank type, voltage, direction and differential use. DDR/MIPI IP settings, VREF and termination remain part of the user's design. See the [pin binding guide](https://github.com/AlexMercer12138/Vik-VeriFlow/blob/main/docs/physical-pin-bindings.md).

![Graphical architecture design](https://i.imgs.ovh/2026/09/18/3254e83e61781f004e33ccb05d88f7f3.gif)

### 3. Simulation Task

Select **Create Simulation Task** under **Simulation Task** in the sidebar to create a simulation task canvas. Add Verilog / SystemVerilog modules and connect them to quickly design a Testbench.

- Built-in stimulus for common interfaces: **UART, SPI, I2C, APB, AXI-STREAM, AXI-Lite, AXI-Full, and RGB888**.
- Run a simulation and view waveforms directly from **Simulation Task**.

![Graphical Testbench](https://i.imgs.ovh/2026/09/18/b2092a9a5e1dc50dc859305a20f7a7e2.gif)

### 4. Common Tools

Right-click inside a Verilog / SystemVerilog file → **VeriFlow** →

- **Insert HDL Template**: insert common HDL templates.
- **Instantiate Module**: instantiate a module from the list with one click.
- **Format Verilog/SystemVerilog**: format your code with one click.

![Common tools](https://i.imgs.ovh/2026/09/18/13ab5c06bfd09baba83b1bb979a5c353.gif)

## Common Settings

### HDL Templates and Formatting

Open VeriFlow settings and edit `veriflow.hdlTemplates` in settings.json. Settings can be scoped to the user, workspace or workspace folder and are read for the active document each time you insert a template. Built-ins remain available by default; a matching ID overrides one, a new ID adds one, and `enabled: false` hides one. Remove an override to restore its built-in definition.

```json
{
  "veriflow.hdlTemplates": {
    "register": {
      "label": "Register",
      "description": "Named register with a configurable width",
      "languages": ["verilog", "systemverilog"],
      "body": ["reg [{{1:7}}:0] {{2:data}};", "{{0}}"]
    },
    "clock": { "body": ["reg {{1:clk}} = 1'b0;", "always #{{2:5}} {{1}} = ~{{1}};"] },
    "timeout": { "enabled": false }
  },
  "veriflow.formatting.alignment": "columns",
  "veriflow.formatting.columns": [4, 12, 20, 44, 56]
}
```

`body` accepts a string or an array of lines. `{{1:default}}` creates an editable placeholder, `{{1}}` mirrors it, and `{{0}}` sets the final cursor. Defaults cannot contain `}`. Other text, including `$display`, `$finish` and backslashes, stays literal; native snippet variables are not evaluated. Invalid entries produce one configuration warning while valid templates remain usable. Each insertion is one undo step and preserves the document's line endings.

Format Document and **Format Verilog/SystemVerilog** use the same formatting settings. Columns are zero-based space offsets: `4` means four preceding spaces (editor column 5). Supply five increasing integers; the first is also the indent size (1–8), and no column may exceed 240. Language-specific overrides are supported. Use `"adaptive"` for the previous alignment style. Invalid columns fall back to defaults without changing a valid alignment mode.

For example, `localparam [31:0] BAUD_RATE=115200;` in a module becomes:

```verilog
    localparam      [31:0]                  BAUD_RATE   = 115200;
```

Port and signal names start at offset 44; parameter names also use offset 44 and their `=` uses offset 56. Long content keeps minimum separating whitespace instead of pushing other lines right. Nested blocks indent by the first offset. Formatting preserves comments, macros, line endings and syntax; unsupported or invalid source is left unchanged. Template insertion, instance insertion/copy and AD/ST export do not automatically apply these settings; format the resulting document explicitly.

### Other Settings

| Setting | Purpose |
| --- | --- |
| `veriflow.libDirs` | HDL library directories |
| `veriflow.defines` | SystemVerilog preprocessor defines |
| `veriflow.simulator` | Simulator selection |
| `veriflow.simulatorCompileCmd` / `simulatorRunCmd` | Custom simulator commands |
| `veriflow.waveViewer` | Waveform viewer selection |
| `veriflow.waveViewerCmd` | Custom waveform viewer command |
| `veriflow.waveFileTemplate` | Waveform file path template |
| `veriflow.testbenchOutputDir` | Workspace-relative Testbench output directory |

Example command templates:

```text
Icarus Verilog: iverilog -g2012 -o "{output}" {files}   ·   vvp "{output}"

VCS:            vcs -full64 -o "{output}" {files}       ·   ./"{output}"

XSim:           xvlog {files} && xelab {top_module} -snapshot "{output}"   ·   xsim "{output}" --runall

Surfer:         surfer "{wave_file}"

GTKWave:        gtkwave "{wave_file}"
```

## License

The extension's main code is licensed under MIT. The bundled Icarus Verilog WASM runtime is licensed under `GPL-2.0-or-later`; see the [Icarus Verilog WASM notes](https://github.com/AlexMercer12138/Vik-VeriFlow/blob/main/docs/licenses/iverilog-wasm.md) for licensing details and access to the corresponding source.
