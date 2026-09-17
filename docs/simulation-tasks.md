# Simulation Task（.st）

一个 `.st` 表示一个图形 Testbench。它与 `.ad` 共用画布、添加模块对话框、连线、Logic Utility、属性栏和撤销重做；任务保存 HDL/AD 引用、预设、连接和仿真时间配置。

## 三个侧栏

- **Module Browser**：顶层为当前工作区和外部库目录，依次展开子目录，叶子节点为模块，右侧显示源码文件。同文件多个模块和不同路径的同名模块分别显示。顶部固定过滤框实时筛选模块并保留目录层级。点击跳到声明，右键“Add to Canvas”加入当前活动的 AD/ST 图形编辑器；普通文本编辑器或其他编辑器活动时不能添加。标题保留刷新和新建 HDL 文件图标。
- **Architecture Design**：列出 `.ad` 文件，展开查看依赖和对应导出的 RTL 文件。
- **Simulation Task**：列出 `.st` 文件，展开查看依赖和对应导出的 TB 文件。

AD/ST 使用相同的电路板图标和标题加号。空列表使用相同样式的创建按钮；新建时只选择一次保存文件名，然后打开空白画布。未生成的输出明确标记，不作为已有文件打开。侧栏没有扩展过滤弹窗，也不支持把模块拖入画布。

## 创建并运行

1. 在 **Simulation Task** 点击加号，保存 `.st`。
2. 用画布 **Add instance**（快捷键 A）选择 HDL 模块或 AD 来源，设置实例名后添加；也可从 Module Browser 右键添加。
3. 用 **Simulation Utility** 添加 Clock、Reset、Stimulus 或接口激励模块，设置实例名后添加节点。选中节点，在右侧属性栏修改配置。
4. 在画布连接真实端口。输入网络必须有驱动；未使用的输出可保持悬空。Logic Utility、参数编辑、接口成组连线和撤销重做沿用 AD。
5. 点击 **Generate Testbench**，选择 `.v` 输出位置，生成可读的 Verilog-2005 并打开。点击运行按钮执行当前任务，运行期间同一按钮用于停止；完成后用波形按钮打开最新 VCD。

生成和运行使用同一个生成器。生成的文件包含 TB 顶层、预设辅助模块和所需 AD 包装；实际 DUT HDL 保持工程依赖。运行在临时目录准备编译输入，不覆盖导出的 HDL。运行完成只表示仿真进程正常结束。

## 预设与任务属性

| 节点 | 端口 | 属性 |
|---|---|---|
| Clock | `clk` 输出，1 bit | 频率 MHz、初始 0/1；默认 100 MHz、0，首个翻转在半周期 |
| Reset | `reset` 输出，1 bit | 有效电平、持续时间；默认低有效、100 个任务时间单位 |
| Stimulus | `out` 输出，宽度可设 | 位宽、初始数值、绝对时间/数值表；默认 1 bit、`1'b0`、空表 |

接口激励也从 **Simulation Utility** 添加，按 UART → SPI → I2C → APB → AXI-STREAM → AXI-Lite → AXI-Full → RGB 排列。角色、起始时间、超时、位宽与协议参数都在右侧修改；发送值和期望值用逐行表格编辑。允许保存未填完整的数据，生成或运行前检查完整性。切换角色会使用该角色的默认配置，可撤销。

| 接口模块 | 角色 | 主要配置 |
|---|---|---|
| UART | TX / RX | 位周期、数据位、奇偶校验、停止位 |
| SPI | Controller / Peripheral | 位周期、字宽、CPOL、CPHA、发送和可选接收校验 |
| APB | Initiator / Responder | 时钟输入、地址/数据位宽、逐条读写事务及地址、等待周期 |
| AXI-Stream | Source / Sink / Monitor | 时钟输入、数据位宽、发送/期望数据、背压 |
| I2C | Controller / Target | SCL/SDA 双向引脚、地址、读写、重复 START、时钟拉伸 |
| AXI-Lite | Initiator / Responder | 时钟输入、地址/数据位宽、逐条读写事务及地址、字节使能、响应 |
| AXI-Full | Initiator / Responder | 时钟输入、地址/数据/ID 位宽、逐条读写事务及地址、突发数据、字节使能、响应 |
| RGB | Source / Monitor | RGB888 数据、外部像素时钟、H/V total、active、syncstart、syncend、极性、帧数、彩条或像素表 |

APB、AXI-Lite、AXI-Full 的 **Transactions** 按顺序执行，可混合 Read 和 Write，每条都有独立地址。Initiator 的 Write 填写写入数据，Read 填写期望读回数据；Responder 的 Write 填写期望收到的数据，Read 填写返回数据。APB/AXI-Lite 每条一拍，AXI-Full 可填写多拍突发数据，每行一拍，按 Ctrl+Enter 或移开焦点保存。

RGB 时序以零为起点：有效区间为 `[0, active)`，同步区间为 `[syncstart, syncend)`，计数范围为 `[0, total)`。生成前要求 `0 < active ≤ syncstart < syncend ≤ total`。例如 1080p 可配置 H 为 `2200 / 1920 / 2008 / 2052`，V 为 `1125 / 1080 / 1084 / 1089`，顺序均为 total / active / syncstart / syncend。像素时钟仍由画布 Clock 配置。

同步总线的 `clk` 接到画布 Clock 或 DUT 时钟；RGB888 Source 的 `clk` 为输入，`pclk` 为输出，Monitor 的 `pclk` 接被观测像素时钟。UART/SPI/I2C 的位时序使用模块属性中的周期。I2C 模块提供开漏驱动和上拉。期望数据不匹配或握手超时会使仿真失败，日志指出模块与原因。

APB、AXI-STREAM 和 AXI 端口采用 `m_apb_paddr`、`s_apb_paddr`、`m_axis_tdata`、`s_axis_tdata`、`m_axi_awaddr` 等标准命名，自动使用 AD 的总线聚合规则。主从模块可以直接通过聚合接口连线；时钟仍单独连接。

AXI-Stream 的 `last`、APB 的 `error` 默认启用，可在右侧属性中关闭以匹配 DUT 的实际接口。若到达任务结束时间仍有接口激励尚未完成，运行会明确报错；可调整任务结束时间、模块起始时间或连线后重试。

预设是类型化配置，不保存任意 HDL。添加后不自动连线。Stimulus 数值使用带位宽的 Verilog 字面量，例如 `8'h5a`；时间必须非负且严格递增。

点击画布空白处编辑任务属性：TB 模块名由 `.st` 文件名派生并只读；默认时间单位 `1ns`、精度 `1ps`、结束时间 `1000000`、波形开启。激励时刻须能由精度准确表示；时钟半周期四舍五入到最近的精度刻度，属性栏显示实际周期。例如 148.5 MHz 在 `1ns/1ps` 下使用 `3.367 ns` 半周期、`6.734 ns` 周期。若半周期取整后为零，需提高时间精度或降低频率。未知位宽、位宽冲突、多驱动或未驱动 DUT 输入会阻止生成/运行，编辑中可保留未完成连接。

## 文件与工具配置

`.st` 的顶层字段为 `format`、`schemaVersion`、`settings`、`instances`、`connections`、`logic`、`defaults`、`interfaceConnections`、`interfaceOverrides`、`presentation`。HDL 来源保存相对任务文件的 `path` 和 `module`，AD 来源保存相对 `path`。可选 `settings.exportPath` 记录导出的 TB 路径。文件不保存仿真器命令。

VS Code 设置选择 `builtin` 或 `custom` 仿真器及波形工具；内置后端支持 Verilog-2005。任务运行读取当前保存的任务和依赖，最新波形保留在当前会话；源码改变后需要重新运行。CLI 的波形保存在命令输出的系统临时路径。

传统 TB 和 ST 的仿真器打印、编译错误及执行状态统一显示在 **VeriFlow** 输出窗口，仿真不会清空已有的分析日志。

本格式不接受旧任务的 cases、assets、verification、独立协议事务步骤、参数扫描、并行场景或报告配置。接口激励保存在实例的预设中；旧格式不能直接当成精简任务运行。

## 示例与传统 Testbench

打开 [basic.st](../examples/simulation-task/basic.st)：100 MHz 时钟、20 ns 低有效复位和 8 bit 激励共同驱动参数化 [counter.v](../examples/simulation-task/counter.v)。激励在 30、70、110 ns 变为 1、3、16；160 ns 结束时 `count` 为 `8'h60`。

[uart-loopback.st](../examples/simulation-task/uart-loopback.st) 将 UART TX 与 RX 两个预设直接连线，发送并校验 `8'h55`，2000 ns 结束。选中 TX 可修改发送表，选中 RX 可修改期望表，适合先熟悉接口模块的配置与连线。

[manual_tb.v](../examples/simulation-task/manual_tb.v) 用同样的激励演示独立传统 TB，包含复位和计数检查。普通 `.v/.sv` Testbench 可通过 **Run Current Testbench** 将当前文件中的模块设为 top、分析依赖并运行，无需创建 `.st`。同文件有多个独立顶层时选择运行哪个模块；产生新波形后自动打开，没有新波形时不会打开旧结果。HDL 编辑器 VeriFlow 子菜单的 **Insert HDL Template** 保留光标处模板插入。

传统 TB 优先使用 top 及其依赖中唯一的 `$dumpfile("文件名.vcd")` 路径。动态计算文件名或存在多个候选路径时，仍使用设置中的 Wave File Template。

## CLI

```bash
veriflow task validate examples/simulation-task/basic.st
veriflow task run examples/simulation-task/basic.st
veriflow task run examples/simulation-task/basic.st --project project.json
```

默认使用 builtin；`--project` 提供项目的工具、宏、库目录和接口配置，custom 需要完整编译/运行命令。`validate` 解析来源并生成检查，不执行 HDL；`run` 只执行一个 TB。退出码 0 表示操作成功，1 表示任务、编译、运行或取消失败，2 表示命令参数错误。CLI 不提供用例、并行、缓存或 JSON/JUnit 报告选项。
