# Vik-VeriFlow

[English](README.md)

**Vik-VeriFlow** 是面向 Verilog/SystemVerilog 工程的一体化设计工作流，覆盖依赖分析、编译仿真、波形查看、原理图浏览、可视化架构设计（Arch Design）与图形化 Testbench 编写。

两个面向用户的产品共享同一套 TypeScript 核心：

| 产品 | 渠道 | 说明 |
| --------------- | ------ | --------------------------------------------------------- |
| `@veriflow/cli` | npm | 命令行：分析、仿真、波形、Arch Design（`.ad`）与 Simulation Task（`.st`）工具 |
| **Verilog Design Flow** | VS Code 扩展商店 | 扩展：模块浏览器、原理图与架构设计编辑器、波形查看器、Testbench 编写 |

## 下载与安装

**环境要求** — Node.js `24.14.1+` · VS Code `1.82.0+`（仅扩展）。

### CLI（npm）

```
npm install --global @veriflow/cli

veriflow --help
```

无需安装外部仿真器或波形工具：内置 WASM 版 Icarus Verilog 与内置 VCD 查看器开箱即用。需要调用本机工具时，在项目配置中选择 `custom` 并填写命令模板。

### VS Code 扩展

* **扩展商店**：在 VS Code 中搜索 **Verilog Design Flow** 安装。

## 快速开始

### CLI

```
# 1. 创建项目

veriflow project new --name demo --root ./rtl --top top --output project.json

# 2. 分析依赖

veriflow analyze --project project.json

# 3. 编译并仿真

veriflow sim --project project.json

# 4. 查看波形

veriflow wave --project project.json

# Arch Design（可视化 RTL 顶层）

veriflow ad new soc_top -o design/soc.ad

veriflow ad validate design/soc.ad --project project.json

veriflow ad export design/soc.ad --project project.json

veriflow ad export design/soc.ad --language systemverilog -o generated/soc.sv

# Simulation Task（图形化 Testbench）

veriflow task validate simulation.st

veriflow task run simulation.st --project project.json
```

每个命令都支持 `--help`。

### VS Code

1. 打开包含 `.v` / `.sv` 文件的工作区。

2. 从活动栏进入 **VeriFlow**：Module Browser → Architecture Design → Simulation Task。

3. 在画布上完成设计 / Testbench，生成并运行，再打开波形 —— 全程无需离开编辑器。

## 配置

仿真器与波形工具默认 `builtin`；选择 `custom` 并填写命令模板即可调用本机工具：

```
Icarus Verilog: iverilog -g2005 -o "{output}" {files}; vvp "{output}"

VCS:            vcs -full64 -o "{output}" {files}; ./"{output}"

XSim:           xvlog {files} && xelab {top_module} -snapshot "{output}"; xsim "{output}" --runall

Surfer:         surfer "{wave_file}"

GTKWave:        gtkwave "{wave_file}"
```

占位符：`{files}` `{output}` `{top_module}` `{wave_file}`—— 扩展设置与 CLI 项目配置使用同一语法。

## 开发



```
nvm use                      # Node 24.14.1+（.nvmrc）

npm ci                       # 锁定依赖安装

npm run build                # 构建 parser 与 VS Code 扩展

npm test                     # 运行全部 workspace 测试

npm run watch:vscode         # 增量构建，用于扩展开发

npm run build:cli            # 构建 CLI 与波形桌面端
```

仓库结构：`packages/*`（共享核心 ——hdl-core、flow-core、schematic-core、hdl-runtime、simulator-*、waveform-*）· `veriflow-vscode`（扩展）・`scripts`（构建 / 发布工具）。

## 发布

准备发布：

```
npm run release -- --all <version>
```

预期产物：

```
dist/npm/veriflow-<包名>-<version>.tgz

veriflow-vscode/veriflow-<version>.vsix
```

发布已构建好的 VSIX：

```
npm exec -- vsce publish --packagePath veriflow-vscode/veriflow-<version>.vsix
```

## 许可证

VeriFlow 主体代码采用 MIT 许可证。内置 Icarus Verilog WASM 运行时采用 `GPL-2.0-or-later`，许可证与对应源码获取方式见 [docs/licenses/iverilog-wasm.md](docs/licenses/iverilog-wasm.md)。