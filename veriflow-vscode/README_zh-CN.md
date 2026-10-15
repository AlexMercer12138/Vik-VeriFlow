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
- **Pins / XDC** 将板卡导入 `~/.veriflow_config.json` 后供所有工程共用。左栏勾选接口即检查并锁定冲突引脚与必选组，中栏接收右栏顶层端口的拖放，确认后生成 XDC。AD 在确认时保存选择和绑定；RTL 右键与命令入口使用相同界面，确认时弹出保存对话框。总线拖放同步绑定 P/N；AD 的 XDC 默认与 RTL 使用相同目录和文件主名，在 AD 树下并列显示。插件只打包通用接口。

引脚绑定首版支持 AU15P 的 GPIO/LVDS 与专用 GT 封装位置；DDR/MIPI 数据线需 IP 电气规则，暂不导出。详见 [引脚绑定说明](https://github.com/AlexMercer12138/Vik-VeriFlow/blob/main/docs/physical-pin-bindings.md)。

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

### HDL 模板与格式化

在 VeriFlow 设置中找到 `veriflow.hdlTemplates`，通过“在 settings.json 中编辑”新增或修改模板。支持用户、工作区和工作区文件夹作用域，每次插入时按当前文档读取。默认保留内置模板；相同 ID 覆盖内置项，新 ID 新增模板，`enabled: false` 隐藏模板。删除覆盖项即可恢复内置内容。

```json
{
  "veriflow.hdlTemplates": {
    "register": {
      "label": "寄存器",
      "description": "可修改位宽和名称的寄存器",
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

`body` 支持字符串或字符串数组。`{{1:默认值}}` 创建可编辑占位符，`{{1}}` 引用同一内容，`{{0}}` 设置最终光标；默认值不能包含 `}`。其余内容包括 `$display`、`$finish` 和反斜杠均按原文插入，不执行原生 snippet 变量。非法配置汇总提示一次，不影响其他合法模板。插入保留文档换行风格，并可一次撤销。

Format Document 与 **Format Verilog/SystemVerilog** 使用同一组设置。列位置从 0 计数，`4` 表示前面有四个空格（编辑器第 5 列）；必须是五个递增整数，第一项同时控制每级缩进（1–8），各列最大为 240。支持按 Verilog/SystemVerilog 分别覆盖。将模式改为 `"adaptive"` 可恢复旧动态对齐；列配置非法时回退默认列，并保留有效的模式选择。

例如模块内的 `localparam [31:0] BAUD_RATE=115200;` 格式化为：

```verilog
    localparam      [31:0]                  BAUD_RATE   = 115200;
```

端口和信号名称位于偏移 44；参数名称同样位于偏移 44，其 `=` 位于偏移 56。长内容占用目标列时仅保留必要间隔，不推动其他行。嵌套块按第一列逐级缩进。格式化保留注释、宏、换行和语法；语法错误或不支持的内容不会被修改。插入模板、插入/复制例化和 AD/ST 导出不自动应用格式设置，需要对生成后的文档显式格式化。

### 其他设置

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
