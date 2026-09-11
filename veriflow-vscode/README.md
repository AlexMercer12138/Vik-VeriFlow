# Verilog Design Flow (VeriFlow)

[简体中文](https://github.com/AlexMercer12138/Vik-VeriFlow/blob/main/veriflow-vscode/README_zh-CN.md)

Verilog Design Flow brings module discovery, dependency analysis, simulation, waveform inspection, schematic browsing, and visual Arch Design editing into VS Code.

![VeriFlow preview](https://img.cdn1.vip/i/6a0a6a9964326_1779067545.webp)

## Requirements

- VS Code 1.82 or newer
- No external simulator is required: the default is the bundled Icarus Verilog WebAssembly runtime
- No external waveform tool is required: the default is the built-in VCD viewer

The bundled simulator targets Verilog-2005. Choose `custom` in the settings when
the project should invoke a local simulator or waveform application.

## HDL Workflow

1. Open a workspace containing `.v` or `.sv` files.
2. Open **VeriFlow** from the Activity Bar. Use **Design** to select the design top, browse the module library and design hierarchy, or create a graphical design.
3. In **Simulation**, select **New Simulation Task** to use an existing Testbench or generate one for the current design. The generator opens in the main editor with port, parameter, clock and reset settings, plus an option to run after generation.
4. Confirm the task's **Design under test** and **Simulation entry**, then select **Run Simulation Task**. For example, `soc_top` is the design and `tb_soc` is the simulation entry; these selections are stored independently.
5. In **Results**, inspect the latest run status, recorded waveform and compile/run log.

Tasks are saved in the extension's workspace state, with task switching, renaming, simulator configuration and waveform paths. Existing projects can continue using their selected simulation top. Graphical designs are validated and exported before task generation and execution. Changes to design ports or parameters prompt you to check the Testbench; the generator does not overwrite existing Testbench files.

Results retain the task name and entry used for that run, even after switching tasks. Source changes mark results as outdated. **Run completed** means the simulator finished normally; functional verification requires checks in the Testbench. The current view shows the latest run; a run history list is not included yet.

Open a `.vcd` file directly with **VeriFlow Waveform Viewer**. Run **Open as VeriFlow Schematic** on `.v` or `.sv` to inspect a read-only schematic with deterministic columns, orthogonal routing, search, zoom, minimap, network selection, and layout controls.

## Arch Design Editor

In **Design**, select **Create Graphical Design**, enter the top-level module name, and choose where to save the `.ad` file. The new design opens directly in the visual editor. Its context menu can select it as the design top or create a simulation task.

Add module instances, top-level ports, and Logic Utilities from the toolbar. Logic Utilities cover explicit constants, NOT, AND/OR/XOR and their inverted forms, MUX, concat, slice, replicate, zero/sign extension, and AND/OR/XOR reductions. They are stored as first-class nodes in Arch Design schema v2 and export as continuous `assign` logic. To connect nodes, click either endpoint and then click the other endpoint; you can pan the canvas between clicks. Select an instance, utility, port, pin, network, or recognized interface to inspect and edit it.

Undriven module and Logic Utility inputs use an effective zero during validation and RTL export; an unconnected inout `t` uses `1`. Effective defaults are shown in the Inspector but do not create constant boxes or branches on the canvas. Add an explicit Constant Logic Utility when a visible, reusable constant source is required.

Errors and warnings update live in the E/W counters and the Problems panel. The editor has one in-editor export action: **Export RTL** in the canvas toolbar. Validate and export are also available from each file's **Design** context menu and the Command Palette. Verilog is exported to a sibling `.v` file by default; SystemVerilog and a relative `.sv` output can be selected in the Inspector. Existing hand-written RTL is never overwritten.

`.ad` is the VeriFlow Arch Design format and does not claim Vivado Block Design compatibility. Schema-v1 files remain readable and are migrated to the schema-v2 model when edited.

The editor recognizes built-in AXI4, AXI-Stream, APB, and AHB-Lite interfaces from HDL port names and directions. AXI4-Lite is handled as an incomplete AXI4 interface. Interfaces can be collapsed, expanded, connected from Master to Slave, or exposed as top-level interfaces. Expanded members remain available as ordinary pins, including individual top-level promotion. Roles that cannot be inferred can be assigned in the Inspector.

Interface connections are intentionally one-to-one; use a dedicated interconnect module for fan-out. An output without a peer input remains open, while an input without a peer output uses the connection override or protocol default shown in the Inspector. Protocol definitions contain no widths: widths always come from HDL ports, and a Master/Slave mismatch produces a warning without blocking RTL export.

Project-defined protocol JSON files use the same recognition and export path as built-ins. Reference workspace-relative files from `project.json`:

```json
{
  "schematic": {
    "interface_protocols": ["protocols/my-bus.json"]
  }
}
```

## Other Commands

- **Select Simulation Entry (Testbench)**
- **Scan Modules**
- **Instantiate Module**
- **Open VCD in VeriFlow Viewer**
- **Generate Testbench** to configure a new simulation task in the main editor

## Settings

| Setting | Purpose |
|---|---|
| `veriflow.libDirs` | HDL library directories |
| `veriflow.defines` | SystemVerilog preprocessor definitions |
| `veriflow.simulator` | `builtin` (bundled Icarus Verilog WASM) or `custom` |
| `veriflow.waveViewer` | `builtin` (VeriFlow VCD viewer) or `custom` |
| `veriflow.waveFileTemplate` | Generated waveform path template |
| `veriflow.testbenchOutputDir` | Workspace-relative Testbench output directory |

Custom command templates are available in VS Code settings. Examples:

```text
Icarus Verilog compile: iverilog -g2005 -o "{output}" {files}
Icarus Verilog run:     vvp "{output}"
VCS compile:            vcs -full64 -o "{output}" {files}
VCS run:                ./"{output}"
XSim compile:           xvlog {files} && xelab {top_module} -snapshot "{output}"
XSim run:               xsim "{output}" --runall
Surfer:                 surfer "{wave_file}"
GTKWave:                gtkwave "{wave_file}"
```

## License

The VeriFlow extension code is licensed under MIT. The bundled Icarus Verilog
WebAssembly runtime is distributed under `GPL-2.0-or-later`; see the
[license and corresponding-source details](https://github.com/AlexMercer12138/Vik-VeriFlow/blob/main/docs/licenses/iverilog-wasm.md).

## HDL formatting

Open a Verilog or SystemVerilog document and choose **Format Verilog/SystemVerilog**
from the editor context menu, or run **VeriFlow: Format Verilog/SystemVerilog** from
 the command palette. The standard **Format Document** action also supports VeriFlow.
To enable formatting on save, select `Vikai-mercer.veriflow` as the default formatter
for the `verilog` and `systemverilog` language modes and enable `editor.formatOnSave`.

The fixed RTL style uses four spaces, multiline module ports and parameters,
aligned declaration fields and named instance connections, same-line `begin`,
structured blocks and conventional operator spacing. Existing comments, headers,
macro definitions and logical blank-line groups are preserved. It does not create
copyright banners or reorder declarations/statements. Files use the active editor's
language mode, including untitled documents and headers assigned an HDL mode.

Formatting uses the bundled SystemVerilog Tree-sitter grammar on original source,
then reparses and verifies the output before returning an edit. Grammar errors or
unsupported constructs cause a warning and leave the document unchanged. This is
not a semantic rewrite or a full SystemVerilog compiler. Styles in rtl-repo differ
in exact column widths; VeriFlow applies one deterministic shared column policy.
