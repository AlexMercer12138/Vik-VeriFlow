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
