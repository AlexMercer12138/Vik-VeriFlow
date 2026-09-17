# Vik-VeriFlow

Vik-VeriFlow 是面向 Verilog/SystemVerilog 工程的一键分析、仿真、波形查看和可视化架构设计工具。目前维护 `veriflow` Node CLI 与 **Verilog Design Flow** VS Code 扩展，两者共享 TypeScript 核心组件。

## 功能

- 扫描 HDL 模块、分析依赖并生成稳定的编译顺序
- 默认使用内置 WASM 版 Icarus Verilog（Verilog-2005）完成仿真，也可选择 Custom 配置外部命令
- 默认使用内置 VCD 查看器，也可选择 Custom 配置外部波形工具
- 浏览带列布局、正交布线和搜索功能的 HDL 原理图
- 可视化编辑 `.ad` 架构设计并导出 Verilog/SystemVerilog 顶层
- 自动识别 AXI4、AXI-Stream、APB、AHB-Lite 及项目自定义接口
- 在 VS Code 中例化模块、就地插入 HDL 模板，并直接运行传统 Testbench
- 使用 `.st` 图形仿真任务组合 HDL/AD、Clock/Reset/Stimulus 预设，生成并运行 Testbench

## 安装

需要 Node.js `24.14.1` 或更高版本：

```bash
npm install --global @veriflow/cli
veriflow --help
```

CLI 包含 Electron 波形窗口，因此安装包体积较大。默认仿真器和波形查看器均已内置，无需另外安装 Icarus Verilog 或波形工具。

VS Code 扩展可在扩展商店搜索 **Verilog Design Flow**，也可从 [GitHub 发布页](https://github.com/AlexMercer12138/Vik-VeriFlow/releases) 下载 `.vsix`。扩展要求 VS Code `1.82.0` 或更高版本。

## 命令行

```bash
veriflow project new --name demo --root ./rtl --top top --output project.json
veriflow analyze --project project.json
veriflow sim --project project.json
veriflow wave --project project.json

veriflow ad new soc_top -o design/soc.ad
veriflow ad validate design/soc.ad --project project.json
veriflow ad export design/soc.ad --project project.json
veriflow ad export design/soc.ad --language systemverilog -o generated/soc.sv
```

每个命令都支持 `--help`。`.ad` 是 Vik-VeriFlow 的 Arch Design 格式，不表示兼容 Vivado Block Design。默认导出同目录、同名的 `.v`；选择 SystemVerilog 时输出 `.sv`。导出只覆盖带 Vik-VeriFlow 生成标记的文件，不覆盖手写 RTL。

## 仿真与波形配置

新项目默认使用 `builtin` 仿真器和 `builtin` 波形查看器。内置仿真器包含 WASM 版 Icarus Verilog，目标语言为 Verilog-2005；生成的 VCD 由内置查看器打开。

需要调用本机工具时，将对应选项改为 `custom`，并填写命令模板。可参考以下命令：

```text
Icarus Verilog: iverilog -g2005 -o "{output}" {files}; vvp "{output}"
VCS:             vcs -full64 -o "{output}" {files}; ./"{output}"
XSim:            xvlog {files} && xelab {top_module} -snapshot "{output}"; xsim "{output}" --runall
Surfer:          surfer "{wave_file}"
GTKWave:         gtkwave "{wave_file}"
```

Custom 模板中的 `{files}`、`{output}`、`{top_module}` 和 `{wave_file}` 会由项目配置替换。

## VS Code

打开 HDL 工作区后，从活动栏进入 **VeriFlow**。左侧 **Module Browser** 浏览模块，**Architecture Design** 和 **Simulation Task** 分别列出 `.ad`、`.st` 文件及其依赖和导出文件；中间是共享 AD/ST 画布，右侧属性栏编辑选中节点或任务配置。`.vcd` 可直接用内置查看器打开，对 `.v`、`.sv` 执行 **Open as VeriFlow Schematic** 可查看只读原理图。

在 **Architecture Design** 点击加号，选择 `.ad` 保存位置，扩展会创建并打开空白图形设计。编辑器支持添加实例和顶层端口、编辑参数与默认值，以及连接标量或协议接口。连线时依次单击两个端点即可，起点方向不限，两次单击之间可平移画布。

设计错误和警告会实时显示在 E/W 计数与 Problems 面板中，点击 E 或 W 可查看具体诊断。输入端口之间也可连线，连接后整个网络最多允许一个确定驱动、多个负载。编辑器内只保留画布工具栏的 **Export RTL** 按钮；验证和导出也可从 **Architecture Design** 文件右键菜单或命令面板执行。默认导出同目录、同名的 `.v`，也可在属性栏选择 SystemVerilog 和相对 `.sv` 输出路径。

顶层 inout 支持 **Direct**（单个双向引脚）和 **Tri-state**（i/o/t）两种模式。模块 inout 暴露到顶层时自动使用 Direct；手动添加默认使用 Tri-state，旧文件的三态行为保持不变。切换模式前需断开该端口的连接。Direct 网络与对应顶层端口同名，导出时直接连接模块 inout；新建直通连接和重命名直通端口会自动同步网络名。

导出的标量网络使用 AD 中的名称，接口成员使用 `连接名_成员名`，不添加 `__vf_net_` 或 `__vf_if_` 前缀。同名且相连的顶层端口会直接复用；无法保留原名的冲突会明确报错。

接口按端口名称和方向自动识别，可折叠为一条连接，也可展开后单独操作成员。角色无法推断时可在属性栏指定 Master 或 Slave；协议接口固定一对一连接，一对多应使用专门的互联模块。实例接口可整体提升为顶层接口，展开后的成员也可按普通端口单独提升。

内置协议包括 AXI4、AXI-Stream、APB 和 AHB-Lite。AXI4-Lite 作为成员不完整的 AXI4 处理。自定义协议文件在 `project.json` 中声明，路径相对该项目文件所在目录；VS Code 使用工作区根目录的 `project.json`：

```json
{
  "schematic": {
    "interface_protocols": ["protocols/my-bus.json"]
  }
}
```

协议 JSON 定义成员、方向、识别特征和缺失输入的默认表达式，不定义位宽。位宽来自实际 HDL 端口；Master 与 Slave 位宽不一致时显示警告，但不会阻止 RTL 导出。已有输出找不到对端输入时保持悬空；已有输入找不到对端输出时使用连接自定义值或协议默认值。

## 图形仿真任务

Module Browser 按工作区、外部库和子目录组织模块，顶部固定过滤框实时筛选。右键“Add to Canvas”只作用于当前活动的 AD/ST 图形编辑器。AD/ST 两栏使用相同图标和创建按钮，展开文件可查看依赖与实际导出路径。

新建 `.st` 只选择一次保存位置，得到空白画布。用与 AD 相同的添加实例对话框加入 HDL/AD，用 Simulation Utility 加入 Clock、Reset、Stimulus 或 UART、SPI、I2C、APB、AXI-STREAM、AXI-Lite、AXI-Full、RGB 接口激励；在画布连线，在右侧配置时序、角色、参数与数值表。总线事务逐条配置读写、地址和数据，RGB 采用 H/V total、active、syncstart、syncend。任务属性提供 timescale、结束时间和波形选项。

Generate Testbench 导出可读 Verilog-2005；运行使用同一生成器，完成后可打开最新波形。一次任务运行一个 TB，完成表示仿真结束。传统 `.v/.sv` TB 仍可直接运行；HDL 右键 VeriFlow 菜单保留光标处模板插入。

```bash
veriflow task validate simulation.st
veriflow task run simulation.st --project project.json
```

上述命令使用在 Simulation Task 中创建并保存的 `simulation.st`。默认使用 builtin；custom 外部工具由 VS Code 设置或显式项目配置提供。
## 开发

```bash
nvm use
npm ci
npm run build
npm test
```

VeriFlow 主体代码采用 [MIT 许可证](LICENSE)。内置 Icarus Verilog WASM
运行时采用 `GPL-2.0-or-later`，许可证与对应源码获取方式见
[Icarus Verilog WASM 说明](docs/licenses/iverilog-wasm.md)。
