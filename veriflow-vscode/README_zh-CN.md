# Verilog Design Flow（VeriFlow）

[English](https://github.com/AlexMercer12138/Vik-VeriFlow/blob/main/veriflow-vscode/README.md)

**Verilog Design Flow** 将完整的 Verilog/SystemVerilog 工作流集成到 VS Code：模块扫描、快速仿真、波形查看、图形化 HDL 设计。

## 环境要求

* VS Code **1.82.0+**

* 无需外部仿真器：默认使用内置 **WASM 版 Icarus Verilog** 仿真器

* 无需外部波形工具：默认使用内置 **VCD 波形查看器**

* 可通过配置命令调用本地工具

## 快速开始

1. 打开 `.v` / `.sv` 文件。

2. 在文件内右键 -> VeriFlow -> 插入模板 / 例化模块 / 格式化文档 / 运行仿真。

3. 从活动栏进入 **VeriFlow**。

4. 侧边栏包括：浏览模块 → 图形化顶层设计 → 图形化测试平台设计。

## 功能

### 1. 一键仿真

在 Testbench 文件内右键 -> VeriFlow -> Run Current Testbench，自动以当前文件作为顶层，执行依赖分析 -> 文件编译 -> 运行仿真 -> 打开波形的流程。

![一键仿真](https://i.imgs.ovh/2026/09/18/95096c5e37272e6e89f23df5d97af5f5.gif)

### 2. 架构设计

在侧边栏的 **Architecture Design** 下选择 **Create Architecture Design** 来新建一个架构设计画布，在画布内添加 Verilog / SystemVerilog 模块并连线来快速设计项目顶层。

- 自动识别 **APB、AHB、AXI** 总线接口，实现主从快速连接
- 内置常用组合逻辑模块 **Logic Utility**，提高连接灵活性

![图形化架构设计](https://i.imgs.ovh/2026/09/18/3254e83e61781f004e33ccb05d88f7f3.gif)

### 3. 仿真任务

在侧边栏的 **Simulation Task** 下选择 **Create Simulation Task** 来新建一个仿真任务画布，在画布内添加 Verilog / SystemVerilog 模块并连线来快速设计测试平台。

- 内置 **UART、SPI、I2C、APB、AXI-STREAM、AXI-Lite、AXI-Full、RGB888** 常见接口激励
- 可直接从 **Simulation Task** 快速运行仿真并查看波形

![图形化测试平台](https://i.imgs.ovh/2026/09/18/b2092a9a5e1dc50dc859305a20f7a7e2.gif)

### 4. 常用工具

在 Verilog / SystemVerilog 文件内右键 -> VeriFlow ->

- Insert HDL template 插入常见 HDL 模板。
- Instantiate Module 一键例化列表中的模块。
- Format Verilog / SystemVerilog 一键格式化你的代码。

![常用工具](https://i.imgs.ovh/2026/09/18/13ab5c06bfd09baba83b1bb979a5c353.gif)

## 常用设置

| 设置 | 用途 |
| ------------------ | ---------------- |
| `veriflow.libDirs` | HDL 库目录 |
| `veriflow.defines` | SystemVerilog 预处理宏 |
| `veriflow.simulator` | 仿真器选择 |
| `veriflow.simulatorCompileCmd` / `simulatorRunCmd` | 自定义仿真器命令 |
| `veriflow.waveViewer` | 波形工具选择 |
| `veriflow.waveViewerCmd` | 自定义波形工具命令 |
| `veriflow.waveFileTemplate` | 波形文件路径模板 |
| `veriflow.testbenchOutputDir` | 工作区相对 Testbench 输出目录 |

命令模板示例：

```
Icarus Verilog: iverilog -g2012 -o "{output}" {files}   ·   vvp "{output}"

VCS:            vcs -full64 -o "{output}" {files}       ·   ./"{output}"

XSim:           xvlog {files} && xelab {top_module} -snapshot "{output}"   ·   xsim "{output}" --runall

Surfer:         surfer "{wave_file}"

GTKWave:        gtkwave "{wave_file}"
```

## 许可证

扩展主体代码采用 MIT 许可证。内置 Icarus Verilog WASM 运行时采用 `GPL-2.0-or-later`，许可证与对应源码获取方式见 [Icarus Verilog WASM 说明](https://github.com/AlexMercer12138/Vik-VeriFlow/blob/main/docs/licenses/iverilog-wasm.md)。