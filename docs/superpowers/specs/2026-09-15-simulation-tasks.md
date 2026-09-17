# Simulation Task（.st）设计

> 历史方案，已由 2026-09-16 的 AD/ST 核心统一方案取代；文中的用例矩阵、验证环境、拖放和独立编辑页面不代表当前功能。当前使用说明见 [Simulation Task](../../simulation-tasks.md)。

## 已确认目标

任务专用文件扩展名为 `.st`，内容为 UTF-8 JSON，含 `format: "veriflow-simulation-task"` 和 `schemaVersion: 1`。新建任务不要求先有 TB。普通流程为：新建任务 → 添加多个模块并连接 → 配置参数场景 → 添加激励、检查和探针 → 运行 → 查看各场景结果。底层 Verilog-2005 TB 由软件生成。

## 用户模型

- **任务**：一个只保存配置、可复制和版本控制的 `.st` 文件。
- **环境**：若干模块实例、网络、时钟、复位。允许同一模块多个实例，每个实例独立参数。模块以相对源码路径和模块名标识，不保存索引 key。
- **用例**：有名称的行为步骤、参数覆盖、种子；每个用例独立编译和运行，互不共享 HDL 状态。
- **运行**：使用当前工程内容的一次执行，临时 TB/日志/波形和内存检查结果；不自动归档或保存输入快照。

仿真工作区显示当前任务、任务文件和当前会话结果。点击当前任务打开编辑器，切换任务选择 `.st` 文件。普通任务不再出现 DUT 和 Simulation entry。现有手写 TB 通过明确的“导入 HDL Testbench”创建任务，此模式才显示 HDL top。

编辑器采用环境、用例、结果三个页面。第一阶段使用模块卡片和明确的端口/网络表单；后续增加可拖动连线画布，复用 AD 布局和端点校验。保留“打开 JSON”用于高级编辑，表单修改通过 VS Code WorkspaceEdit，支持撤销、保存、外部变更同步。

## 文件与语义

根字段：`format`、`schemaVersion`、`name`、`mode`、`sources`、`environment`、`defaults`、`cases`、`probes`、`extensions`、可选 `hdlTop`、`presentation`。`mode` 为 `generated` / `hybrid` / `hdl`。路径相对 `.st` 所在目录，使用 `/`；允许 `../` 引用共享源码，输出由工具分配，不使用用户提供的实例/用例名字作为目录路径。

环境保存实例（id/module/source/parameters/connections）、网络（name/width/initial）、时钟（signal/period）、复位（signal/active/releaseAfter）。所有时间数值以 defaults.timeUnit 为单位；timePrecision 不大于 timeUnit。第一阶段网络宽度为正整数，用例可覆盖网络宽度，避免参数改变后继续使用错误位宽。编译前解析当前模块端口和参数，检查连接、重复驱动、未知端点；不把无法解析的宽度偷偷降为 1。

第一阶段行为：drive、delay、cycles、expect、waitUntil、repeat、parallel。cycles 指定时钟和边沿；waitUntil 必须有超时。expect 采用四态严格比较（含 x/z），失败保留步骤路径和期望值。驱动避开采样边沿，采样延后一精度 tick。parallel 的并行分支不得驱动同一网络；也不得驱动时钟/自动复位/模块输出。inout 可通过值 z 释放，但普通多驱动连接仍需明确拒绝。

默认参数：backend、timeUnit、timePrecision、duration、timeoutMs、seed；参数覆盖按实例 id 分组，参数编译期解析。运行时激励使用独立 seed，不以随机名字破坏可重现性。没有任何检查时结果为 `completed-unverified`，不显示通过。

HDL 扩展为外部用户文件，在生成 TB 的声明区包含，不覆盖用户文件。允许声明 task/function 并通过 `call` 步骤调用无参数 task；模块级自定义组件作为环境实例。外部文件可能运行任意 HDL，按 VS Code 工作区信任控制执行。生成 TB 只读查看；手写 TB 不尝试反向转换为高层步骤。

## 结果和复现

状态为 `passed`、`failed`（检查失败）、`error`（输入/编译/执行错误）、`timeout`、`cancelled`、`completed-unverified`。不以 exit code 0 自动判定 passed；生成模式必须有完成标记和检查记录。

`.st` 只持久化工程引用、连接、参数、激励和探针。每次运行读取当前任务、源码、include、数据文件；源码改变后结果应随实际行为改变。必要生成 TB、日志、波形和运行数据放系统临时目录，结果留当前会话用于查看/比较，不保存 manifest、输入快照或长期历史。失败重跑读取当前配置和源码。工程版本与结果归档由工程管理软件负责；CLI 仅在显式要求时导出 JSON/JUnit。

## 分阶段验收

1. **基础闭环**：`.st` 解析/校验/保存、模块/用例表单、生成 TB、基础激励和检查、顺序多场景运行、波形/日志/会话结果、HDL 扩展与手写 TB 入口。验收：两模块联合仿真、三个参数用例，不手写 TB；混合通过/失败/未验证结果正确；取消和超时可见。
2. **验证效率**：UART、SPI、APB、AXI-Stream 模板；主动/响应/监视角色分开定义；数据文件、参数扫描预览和场景数量限制、失败重跑、结果比较、环境连线画布。协议模板不能仅根据名称猜映射，必须让用户确认端口角色、时钟和极性。
3. **轻量工程化**：临时执行产物、每次读取当前源码、可选编译缓存（包含全部编译输入与工具版本，绝不缓存结果）、受限并行、CLI/CI 和按需导出的 JSON/JUnit。取消输入快照、结果归档和重放。

## 兼容约束

保留手写 TB、旧 TB 生成器、AD 导出和现有仿真后端。旧 workspaceState 任务提供显式迁移到 `.st`，不删除旧数据。新增实现不改版本、不发布、不重新打包已有 1.5.1 VSIX。先前 AD 修复保留。

## 第三阶段与协议补充（2026-09-15）

按用户最新反馈简化工程化阶段：不提供归档或快照重放，执行读取当前工程输入。默认串行，可配置 1–8 个独立后端 worker；仅内置 Icarus 后端启用可选编译缓存，种子从运行 plusarg 读取。GUI 和 CLI 使用相同 runner 与结果格式，未验证用例不得显示为自动通过。

新增 I2C controller/target、AXI4 Full initiator/responder、AXI4-Lite initiator/responder、RGB888 source/monitor。RGB888 经用户确认使用像素时钟、HSYNC/VSYNC/DE、独立 R/G/B 各 8 位，支持分辨率、消隐、极性、色条、像素文件。I2C 使用开漏与 pullup，7 位地址、ACK/NACK、重复 START、时钟拉伸；AXI4 使用五独立握手通道、ID/byte enable/LAST/response、FIXED/INCR/WRAP 突发与 4 KiB 约束，第一版全宽对齐且一次一笔 outstanding。AXI4-Lite 为单拍读写。所有等待有限时，并以独立参考端在真实仿真器中验证；不冒充完整一致性验证 IP。

规格依据：[NXP UM10204](https://cache.nxp.com/docs/en/user-guide/UM10204.pdf)、[Arm AMBA AXI4/AXI4-Lite](https://developer.arm.com/-/media/Arm%20Developer%20Community/PDF/IHI0022H_amba_axi_protocol_spec.pdf)、[ST RGB888 SYNC-DE 接口说明](https://community.st.com/stm32-mcus-60/how-to-set-up-the-ltdc-peripheral-to-interface-with-the-display-panel-atm0500d27-ct-from-az-displays-84)。

`.st` 增加可选 runtimeFiles 和 defaults.parallelism/cache；外部 HDL 的运行数据显式声明，并在每次运行读取当前文件。RGB 文件保留 4096 像素数值上限，色条可支持普通显示分辨率。native/custom 正常执行，不引入外部工具版本归档限制。
