# Verilog Design Flow（VeriFlow）

[English](https://github.com/AlexMercer12138/Vik-VeriFlow/blob/main/veriflow-vscode/README.md)

Verilog Design Flow 将模块扫描、依赖分析、编译仿真、波形查看、原理图浏览和可视化架构设计集成到 VS Code。

![VeriFlow 功能预览](https://img.cdn1.vip/i/6a0a6a9964326_1779067545.webp)

## 环境要求

- VS Code `1.82.0` 或更高版本
- 无需安装外部仿真器，默认使用内置 WASM 版 Icarus Verilog
- 无需安装外部波形工具，默认使用内置 VCD 查看器

内置仿真器目标为 Verilog-2005。需要调用本机工具时，在设置中选择
`custom` 并填写命令模板。

## HDL 工作流

1. 打开包含 `.v` 或 `.sv` 文件的工作区。
2. 从活动栏进入 **VeriFlow**。在 **Design（设计）** 中选择设计顶层、浏览模块库和设计层次，或创建、编辑图形设计。
3. 在 **Simulation（仿真）** 点击 **New Simulation Task**，选择已有 Testbench，或为当前设计生成 Testbench。生成器在主编辑区打开，支持端口、参数、时钟和复位配置，并可勾选生成后立即运行。
4. 确认任务的 **Design under test（验证对象）** 与 **Simulation entry（仿真入口）**，点击 **Run Simulation Task**。例如验证对象为 `soc_top`，运行入口为 `tb_soc`；二者独立保存。
5. 在 **Results（结果）** 查看最近一次运行的状态、波形副本和编译／运行日志。

仿真任务保存在当前工作区的扩展状态中，支持切换、重命名、配置仿真器和波形路径；无需修改工程文件格式。已有工程的仿真顶层仍可继续使用。对图形设计创建任务和执行任务时，会先校验并导出 RTL；设计端口或参数变化时会提示检查 Testbench，已有 Testbench 文件不会被生成器覆盖。

结果记录保留运行时的任务名称与仿真入口，切换任务不会改变其归属。源码变化后显示 **Results are outdated**。**Run completed** 仅表示仿真正常结束，不代表功能验证通过；验证通过需要 Testbench 的检查逻辑支持。当前提供最近一次运行，尚未提供历史运行列表。

`.vcd` 文件可直接使用 **VeriFlow Waveform Viewer** 打开。对 `.v` 或 `.sv` 文件执行 **Open as VeriFlow Schematic**，可查看支持稳定列布局、正交布线、搜索、缩放、minimap、整网选择和布局调整的只读原理图。

## 架构设计编辑器

在 **Design** 区域点击 **Create Graphical Design**，输入顶层模块名并选择 `.ad` 文件保存位置，新设计会直接在可视化编辑器中打开。右键该设计可将其设为设计顶层或创建仿真任务。

使用工具栏添加模块实例、顶层端口和 Logic Utility（逻辑工具）。Logic Utility 包含显式常量、非、与/或/异或及其反相形式、MUX、拼接、切片、复制、零/符号扩展，以及与/或/异或归约。它们作为 Arch Design schema v2 的一等节点保存，并以连续 `assign` 逻辑导出。连线时先单击任意一侧端点，再单击另一侧端点；两次单击之间可以平移画布。选中模块、逻辑工具、端口、引脚、网络或识别出的接口，可在右侧属性栏查看和修改对应内容。

模块和 Logic Utility 的未驱动输入仅在验证与 RTL 导出时采用等效常量 `0`；未连接的 inout `t` 采用 `1`。这些等效默认值会显示在属性栏中，但不会在画布上生成常量框或分支。需要可见、可复用的常量源时，应显式添加 Constant Logic Utility。

错误和警告会实时显示在 E/W 计数与 Problems 面板中。编辑器内只保留画布工具栏的 **Export RTL** 导出入口；每个文件的 **Design** 右键菜单和命令面板也可执行验证与导出。默认导出同目录、同名的 `.v` 文件；可在属性栏选择 SystemVerilog 和相对 `.sv` 输出路径。扩展不会覆盖手写 RTL。

`.ad` 是 VeriFlow 的 Arch Design 格式，不表示兼容 Vivado Block Design。schema v1 文件仍可读取，并会在编辑时迁移到 schema v2 模型。

编辑器可根据 HDL 端口名称和方向识别内置的 AXI4、AXI-Stream、APB 与 AHB-Lite 接口，AXI4-Lite 按成员不完整的 AXI4 处理。接口可折叠、展开、从 Master 连接到 Slave，或整体提升为顶层接口；展开后的成员仍可作为普通引脚单独提升。无法自动推断角色时，可在属性栏指定 Master 或 Slave。

协议接口固定一对一连接，一对多应使用专门的互联模块。已有输出找不到对端输入时保持悬空；已有输入找不到对端输出时使用属性栏显示的连接自定义值或协议默认值。协议定义不包含位宽，位宽始终取自 HDL 端口；Master 与 Slave 位宽不一致时显示警告，但不阻止 RTL 导出。

项目自定义协议与内置协议使用相同的识别和导出流程。在 `project.json` 中引用相对工作区的协议文件：

```json
{
  "schematic": {
    "interface_protocols": ["protocols/my-bus.json"]
  }
}
```

## 其他命令

- **Select Simulation Entry (Testbench)**
- **Scan Modules**
- **Instantiate Module**
- **Open VCD in VeriFlow Viewer**
- **Generate Testbench**（在主编辑区配置新仿真任务）

## 常用设置

| 设置 | 用途 |
|---|---|
| `veriflow.libDirs` | HDL 库目录 |
| `veriflow.defines` | SystemVerilog 预处理宏 |
| `veriflow.simulator` | `builtin`（内置 Icarus Verilog WASM）或 `custom` |
| `veriflow.waveViewer` | `builtin`（内置 VeriFlow VCD 查看器）或 `custom` |
| `veriflow.waveFileTemplate` | 波形文件路径模板 |
| `veriflow.testbenchOutputDir` | 工作区相对 Testbench 输出目录 |

自定义命令可在 VS Code 设置中配置，以下是常见工具的模板示例：

```text
Icarus Verilog 编译：iverilog -g2005 -o "{output}" {files}
Icarus Verilog 运行：vvp "{output}"
VCS 编译：          vcs -full64 -o "{output}" {files}
VCS 运行：          ./"{output}"
XSim 编译：         xvlog {files} && xelab {top_module} -snapshot "{output}"
XSim 运行：         xsim "{output}" --runall
Surfer：            surfer "{wave_file}"
GTKWave：           gtkwave "{wave_file}"
```

## 许可证

VeriFlow 扩展主体代码采用 MIT 许可证。内置 Icarus Verilog WASM 运行时采用
`GPL-2.0-or-later`，许可证与对应源码获取方式见
[Icarus Verilog WASM 说明](https://github.com/AlexMercer12138/Vik-VeriFlow/blob/main/docs/licenses/iverilog-wasm.md)。
