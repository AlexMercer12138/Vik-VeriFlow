# Vik-VeriFlow

[简体中文](README_zh-CN.md)

**Vik-VeriFlow** is an integrated workflow for Verilog/SystemVerilog projects, covering dependency analysis, compilation and simulation, waveform viewing, schematic browsing, visual architecture design (Arch Design), and graphical Testbench authoring.

Two user-facing products share the same TypeScript core:

| Product | Channel | Description |
| --- | --- | --- |
| `@veriflow/cli` | npm | Command-line tools for analysis, simulation, waveforms, Arch Design (`.ad`), and Simulation Task (`.st`) |
| **Verilog Design Flow** | VS Code Marketplace | Extension: Module Browser, schematic and architecture design editors, waveform viewer, and Testbench authoring |

## Download and Installation

**Requirements** — Node.js `24.14.1+` · VS Code `1.82.0+` (extension only).

### CLI (npm)

```bash
npm install --global @veriflow/cli
veriflow --help
```

No external simulator or waveform tool is required: the bundled Icarus Verilog WASM runtime and built-in VCD viewer work out of the box. To use local tools, select `custom` in the project configuration and provide command templates.

### VS Code Extension

- **Marketplace**: search for **Verilog Design Flow** in VS Code and install it.

## Quick Start

### CLI

```bash
# 1. Create a project
veriflow project new --name demo --root ./rtl --top top --output project.json

# 2. Analyze dependencies
veriflow analyze --project project.json

# 3. Compile and simulate
veriflow sim --project project.json

# 4. View waveforms
veriflow wave --project project.json

# Arch Design (visual RTL top-level design)
veriflow ad new soc_top -o design/soc.ad
veriflow ad validate design/soc.ad --project project.json
veriflow ad export design/soc.ad --project project.json
veriflow ad export design/soc.ad --language systemverilog -o generated/soc.sv

# Simulation Task (graphical Testbench)
veriflow task validate simulation.st
veriflow task run simulation.st --project project.json
```

Every command supports `--help`.

### VS Code

1. Open a workspace containing `.v` / `.sv` files.
2. Open **VeriFlow** from the Activity Bar: Module Browser → Architecture Design → Simulation Task.
3. Author your design or Testbench on the canvas, generate and run it, then open the waveform — all without leaving the editor.

## Configuration

The simulator and waveform viewer default to `builtin`. Select `custom` and provide command templates to use local tools:

```text
Icarus Verilog: iverilog -g2005 -o "{output}" {files}; vvp "{output}"

VCS:            vcs -full64 -o "{output}" {files}; ./"{output}"

XSim:           xvlog {files} && xelab {top_module} -snapshot "{output}"; xsim "{output}" --runall

Surfer:         surfer "{wave_file}"

GTKWave:        gtkwave "{wave_file}"
```

Placeholders: `{files}` `{output}` `{top_module}` `{wave_file}` — extension settings and CLI project configuration use the same syntax.

## Development

```bash
nvm use                      # Node 24.14.1+ (.nvmrc)
npm ci                       # Install locked dependencies
npm run build                # Build the parser and VS Code extension
npm test                     # Run all workspace tests
npm run watch:vscode         # Incremental build for extension development
npm run build:cli            # Build the CLI and waveform desktop application
```

Repository layout: `packages/*` (shared core — hdl-core, flow-core, schematic-core, hdl-runtime, simulator-*, waveform-*) · `veriflow-vscode` (extension) · `scripts` (build and release tools).

## Release

Prepare a release:

```bash
npm run release -- --all <version>
```

Expected artifacts:

```text
dist/npm/veriflow-<package>-<version>.tgz
veriflow-vscode/veriflow-<version>.vsix
```

Publish the already-built VSIX:

```bash
npm exec -- vsce publish --packagePath veriflow-vscode/veriflow-<version>.vsix
```

## License

VeriFlow's main code is licensed under MIT. The bundled Icarus Verilog WASM runtime is licensed under `GPL-2.0-or-later`; see [docs/licenses/iverilog-wasm.md](docs/licenses/iverilog-wasm.md) for licensing details and access to the corresponding source.
