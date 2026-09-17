# Simulation Task Implementation Plan

> 历史方案，已由 2026-09-16 的 AD/ST 核心统一方案取代；文中的用例矩阵、验证环境、拖放和独立编辑页面不代表当前功能。当前使用说明见 [Simulation Task](../../simulation-tasks.md)。

> **For agentic workers:** Use superpowers:subagent-driven-development or superpowers:executing-plans to implement task-by-task. Checkboxes are the execution record; later stages depend on acceptance of the preceding deliverables, not on another permission prompt.

**Goal:** 用 `.st` 文件保存多模块仿真配置，替代含义模糊的 TB 选择式任务；自动生成多参数用例的 TB，每次针对当前源码进行协议验证。

**Architecture:** 纯任务模型、校验和 Verilog 生成放入现有 `@veriflow/flow-core`，不增加包依赖。Node 运行器复用 SimulatorBackendRegistry；VS Code 自定义文本编辑器和任务树负责文件、索引与交互。旧设计工作区和手写 TB 流程保留，普通仿真入口切换到 `.st`。

**Tech Stack:** TypeScript、VS Code CustomTextEditorProvider、JSON Schema、Verilog-2005、现有 Icarus WASM/native backend、node:test。

**Spec:** `docs/superpowers/specs/2026-09-15-simulation-tasks.md`

## Global Constraints

- 扩展名严格使用 `.st`；内容为 UTF-8 JSON；format 为 `veriflow-simulation-task`，schemaVersion 为 1。
- 路径相对任务文件；模块持久标识为 source + module，不使用索引 key。
- 新建任务不选择 TB；普通模式不显示 DUT / Simulation entry。
- 生成 Verilog-2005；未知/无效输入必须报告，不能降级为默认 1-bit 或空任务。
- 检查失败、执行错误、超时、取消和未验证必须区分。
- 用户 HDL 文件不可被生成器覆盖；仅配置持久化，运行结果留在当前会话。
- 保留旧任务和 AD 修复；不发布、不打包、不修改工作区版本。

## 文件分工

| 文件 | 职责 |
|---|---|
| `packages/flow-core/src/simulationTask/model.ts` | `.st` 类型与默认任务 |
| `packages/flow-core/src/simulationTask/validation.ts` | JSON 和语义校验，定位到字段 |
| `packages/flow-core/src/simulationTask/compiler.ts` | 环境、步骤和用例展开成 TB |
| `packages/flow-core/src/simulationTask/results.ts` | 检查日志解析和结果分类 |
| `packages/flow-core/src/simulationTask/runner.ts` | 当前源码运行、并行调度与临时产物 |
| `veriflow-vscode/src/simulationTask/taskEditorProvider.ts` | 文档生命周期、表单消息与索引桥接 |
| `veriflow-vscode/src/simulationTask/taskEditorHtml.ts` | 环境/用例/结果页面 |
| `veriflow-vscode/src/simulationTask/taskController.ts` | 任务树、命令、运行和迁移 |
| `veriflow-vscode/schemas/simulation-task.schema.json` | `.st` JSON 补全 |
| `veriflow-vscode/src/extension.ts` | 注册新服务与默认仿真入口 |

## 第一阶段：基础闭环

### Task 1: 持久格式、校验、TB 编译

**Files:** model.ts、validation.ts、compiler.ts、results.ts、simulationTask/index.ts、flow-core/src/index.ts；`packages/flow-core/test/simulationTask.test.ts`。

**Interfaces:** `createSimulationTask(name: string): SimulationTaskDocument`；`parseSimulationTask(text: string): SimulationTaskDocument`（异常包含字段路径）；`validateSimulationTask(task): TaskDiagnostic[]`；`compileSimulationCase(task, caseId, modules: TaskModuleDefinition[]): CompiledSimulationCase`；`parseTaskOutput(output: string): TaskCheckResult[]`。精确类型由 model.ts 定义，后续任务导入同一来源。

- [x] 先写解析/往返/版本拒绝测试，输入 `{"format":"veriflow-simulation-task","schemaVersion":2}` 必须失败并标识 schemaVersion；新任务允许空环境，运行前拒绝空用例环境。
- [x] 实现根字段、实例/网络/时钟/复位、用例参数/网络宽度覆盖和基础步骤 union，使用显式类型保护解析任意 JSON。
- [x] 测试两模块连线、多负载、重复驱动、未知端口、参数覆盖、四态期望、waitUntil 超时和 parallel 驱动冲突。
- [x] 生成唯一内部 top `veriflow_task_tb`；用例独立编译；发出机器可解析的检查和完成标记；所有用户内容禁止作为未校验 HDL 标识符插入。
- [x] 运行 `npm run build --workspace @veriflow/flow-core` 和 flow-core 测试编译，然后 `node --test packages/flow-core/dist-test/test/simulationTask.test.js`；审查生成文本，不依赖字符串快照代替行为测试。

### Task 2: 运行器与场景结果

**Files:** runner.ts、results.ts；`packages/flow-core/test/simulationTaskRunner.test.ts`。

**Interfaces:** 运行器输入 taskPath、task、modules、SimulatorBackend、backendId、AbortSignal；输出各用例状态、检查、产物路径。依赖 Task 1 的编译 API；构造现有 createSimulationRequest，不启动任意新 shell 流程。

- [x] 假后端记录每个请求，断言三个用例分别拥有 generated TB 和独立输出目录，参数没有串用。
- [x] 测试 passed/failed/error/timeout/cancelled/completed-unverified；生成模式缺少完成标记不能判 passed。
- [x] 运行结果记录种子和版本元数据；随机 run id + 场景序号隔离临时文件，不由用户 case id 拼输出路径。原落盘快照方式由 Task 8 简化。
- [x] 通过 signal 取消当前场景并标记未运行场景；wall-clock 限时和 HDL duration 分开记录；失败后继续其余场景。
- [x] 用实际 Icarus WASM 跑两模块三参数集，校验检查记录与 VCD；当前会话可保留先前结果用于对比。

### Task 3: `.st` 自定义编辑器与文件发现

**Files:** taskEditorProvider.ts、taskEditorHtml.ts、schema JSON、extension package.json；`veriflow-vscode/src/test/simulationTaskEditor.test.ts`。

**Interfaces:** provider 接收 scan/definitions/run/openWave 回调；只通过 WorkspaceEdit 保存；webview 消息包含文档 version，拒绝过期覆盖。

- [x] 注册 `veriflow.simulationTask` editor，selector `*.st`；JSON validation 使用同一字段结构；工作区 watcher 发现新增/重命名/删除。
- [x] 新建即保存空 `.st` 并打开，无模块/TB 前提；添加模块从完整 HDL 索引选择，显示来源路径，并生成可编辑端口连线表。
- [x] 实现环境/用例/结果页面；时钟、复位、网络、参数、步骤、探针和 HDL 扩展可编辑；编辑器给出字段级错误，不自动丢弃无效文本。
- [x] 验证撤销重做、外部修改、两个编辑器、过期 webview 消息、特殊字符转义和工作区信任。
- [x] 通过本地浏览器 smoke 验证添加两个模块、三个用例和导航结果，无 `DUT` / `Simulation entry` 普通模式控件。

### Task 4: 工作区交互替换与兼容

**Files:** taskController.ts、extension.ts、workflowController.ts、workflowViews.ts；`veriflow-vscode/src/test/simulationTaskController.test.ts`。

**Interfaces:** 新控制器提供 simulationView/resultsView/new/open/select/run/importLegacy；原 workflowController 继续负责 design 和旧 TB 生成器。旧 command 路由在入口处统一选择 .st，避免双重注册。

- [x] Current task 打开文件，选择任务列出 .st；新增/运行按钮都指向新流程；结果以任务和场景组织。
- [x] 后端默认 builtin，使用打包 Icarus loader；探针和日志产物通过已有波形/文本查看器打开。
- [x] 显式导入现有 HDL TB 和旧 workspaceState 任务，保存为 hdl 模式 .st，原数据不删除。
- [x] 多模块源依赖合并、include/defines 跟随任务配置；重复模块名要求路径消歧；.ad 先导出再解析并捕获实际输入。
- [x] 测试空索引可新建、Current task 不弹 TB 选择、重启可恢复文件任务、批次运行取消与第二次运行。

### Task 5: 文档、演示和阶段验收

**Files:** `examples/simulation-task/`、`docs/simulation-tasks.md`、extension README/CHANGELOG 未发布条目。

- [x] 提供 producer→consumer 两模块示例、3 参数用例，自动激励和期望；另有混合 HDL 和手写 TB 示例。
- [x] 文档列明当前实现、后续路线图、时间语义、端口连接规则、状态含义和迁移方法。
- [x] 运行 flow-core 新测试、受影响 VS Code 测试、完整构建及浏览器 smoke；记录命令/结果；修复审查发现后更新本计划勾选状态。

## 第二阶段：验证效率

### Task 6: 协议激励、数据与扫描

第二阶段执行拆分：6A 协议事务生成与验证；6B `.st` 用例 `sweep` 的参数/网络位宽/seed Cartesian 展开，运行前预览，整个任务最多 256 个实际场景；6C UTF-8 数据文件（空白分隔 Verilog 数值）输入与失败重跑、两次运行对比；7 环境画布和表单共享网络模型。协议以 `kind: protocol` 步骤持久保存版本/角色/映射，编译时生成 HDL；不会把模板展开结果当用户源文件。

失败重跑按失败场景 id 读取当前配置、seed 和源码，明确标注 rerun。结果比较在当前会话按场景 id 对齐，显示状态/耗时/检查差异，缺失场景显示 added/removed。

**Files:** `packages/flow-core/src/simulationTask/protocols.ts`、`scenarios.ts`、相应测试；taskEditorHtml.ts。

- [x] 为 UART TX/RX、SPI controller/peripheral、APB initiator/responder、AXI-Stream source/sink/monitor 定义各自角色和端口契约；模板显式记录版本、时钟、极性、位宽与等待上限。
- [x] 每个模板以回环或参考模块验证成功、反压、错误输入和超时；模板展开为 Task 1 基础步骤/自定义辅助 HDL。
- [x] 数据文件相对任务解析，每次读取当前数据；用例扫参先预览 Cartesian 组合，默认最多 256 个，超过时禁止直接运行并要求缩小组合。
- [x] 添加失败重跑与结果比较（状态/耗时/检查）；按用户修订，重跑使用当前任务和数据，已有会话结果不覆盖。

### Task 7: 环境画布

**Files:** `veriflow-vscode/src/simulationTask/taskCanvas.ts`、`taskCanvasClient.ts`、taskEditorProvider.ts。复用 schematic-core 图模型、布局和走线，在 `.st` 自定义编辑器嵌入 SVG 适配器。

- [x] `.st` 环境转为 AD 共用 GraphNode/GraphPin/SchematicNetwork，网络语义仍由任务 core 验证。
- [x] 拖动连线写回 connections，拖动模块只写 presentation；网络、多负载、inout、协议角色分别验收。
- [x] 画布与表单/JSON 来回切换不改变语义；探针作为非驱动观察点。

## 第三阶段：轻量运行与协议扩展（按用户最新反馈修订）

用户明确要求 `.st` 只保存工程/仿真任务配置，结果归档交由工程管理软件；修改源码后再次运行必须得到当前源码对应的结果。以下设计取代此前归档/快照/重放方案，也取代前两阶段自动保存运行历史和旧配置重跑的细节。

### 本次执行拆分

1. **协议扩展**：I2C controller/target、AXI4 Full/Lite initiator/responder、并行 RGB888 source/monitor。提供选项、端口映射和有限超时；独立参考端验证真实 HDL 时序。修复审查发现的 FIXED 长度和 WRAP 起始地址边界。
2. **轻量运行器**：每次解析当前 `.st`、当前 HDL/include/数据；仅生成本次执行必要的临时 TB/日志/波形和运行数据。删除源码复制、输入快照、归档/重放及 manifest/resolved-task/checks 自动落盘。结果对象留在内存。
3. **执行效率**：保留 1–8 个独立后端 worker 和独立临时工作目录。可选内置编译缓存只保存编译程序，key 包含所有编译内容与版本；源码改变失效，仿真结果永不缓存。
4. **CLI**：仅保留 `task validate/run`，支持 case/jobs/cache。仅用户显式设置 `--json`/`--junit` 时保存报告；失败非零，未验证 JUnit skipped，SIGINT 取消。不提供 archive/replay。
5. **VS Code/文档**：移除归档/重放入口和磁盘历史恢复；Results 显示当前会话结果。失败重跑根据失败场景 id 读取当前任务、源码和数据。调整计划/规格/说明，进行新旧协议、当前源码变化、构建和浏览器验证。

### Task 8: 当前源码与可控执行

**Files:** `packages/flow-core/src/simulationTask/runner.ts`、`scheduler.ts`、`cache.ts` 及测试；VS Code taskController/provider/html。

- [x] 同一 `.st` 修改 RTL、include、激励文件后重新运行，检查值与状态反映当前内容。
- [x] 不创建工程 `.veriflow/runs`、输入快照、源码副本、结果 manifest 或归档；必要产物位于系统临时目录。
- [x] 当前会话可查看日志/波形/检查与比较，重启不加载运行历史；失败重跑读取当前任务。
- [x] 缓存 key 包含编译输入内容/参数/宏/版本；源码/include 改动使缓存失效，seed 改变可命中但重新执行。
- [x] 默认串行，有界并行使用独立后端/目录；取消完成剩余场景状态记录。

### Task 9: CLI / CI 与质量门

**Files:** `packages/cli/src/commands/task.ts`、main.ts、CLI 文档及测试。

- [x] CLI `task validate/run` 复用 core，支持展开后场景 id；无 archive/replay 命令。
- [x] JSON/JUnit 只在显式要求时导出，保护任务/源码不被报告覆盖；检查失败非零，未验证不伪装通过。
- [x] 同一任务修改当前源码/数据后，通过 CLI 和扩展再次运行均反映修改；真实后端覆盖 pass/fail/timeout/cancel。
- [x] 新增八个协议角色、示例、schema 和表单通过验证，保留已有九个角色。
- [x] 本阶段受影响测试与构建通过；完整 release checks 是另行准备发布的前置条件，本次不发布。

## 阶段进度（2026-09-15）

| 任务 | 状态 | 验收证据 |
|---|---|---|
| Task 1 格式与编译 | 已实现 | 严格 JSON 校验、参数宽度/驱动/时序检查测试通过 |
| Task 2 运行与记录 | 已实现并通过阶段验收 | 真实 WASM 两模块三场景及状态分类通过，嵌套 HDL include 回归通过 |
| Task 3 自定义编辑器 | 已实现 | 浏览器 smoke；文档修改、过期消息及错误 JSON 测试通过 |
| Task 4 工作区兼容 | 已实现 | 空索引新建、重启恢复、旧 HDL 仿真兼容测试通过 |
| Task 5 示例文档 | 已实现并通过阶段验收 | joint.st 示例、使用说明、未发布更新记录 |
| Task 6 协议与扫描 | 已实现并通过阶段验收 | 9 角色、真实 WASM 回归、文件快照与重跑、结果比较 |
| Task 7 环境画布 | 已实现并通过阶段验收 | 共享布局、输入连输入/inout/驱动冲突回归、浏览器拖动与探针 |
| Task 8–9 | 已实现并通过阶段验收 | 当前源码、临时产物、会话结果；42 core、38 真实 WASM、11 CLI、7 host 测试文件通过 |

第一阶段 UI 为模块卡片和表单。生成器保留内部 top 和辅助变量名称，不影响用户 RTL 命名。当前产物仅在系统临时目录保存运行必需的 TB、日志和波形；不保存任务快照、manifest 或 checks 文件。

## 执行记录

- 2026-09-15：设计确认 `.st`，完整路线图和第一阶段任务建立；在 `codex/simulation-tasks` 保留此前未提交 AD 修复。当前从 Task 1 开始，后续阶段的验收状态逐项记录。
- 2026-09-15：第二阶段完成。31 项 core 测试、18 项真实 WASM 集成测试、6 项 VS Code 测试文件通过；浏览器验证模块移动、输入连输入、双击探针、扫描预览和协议表单。`uart.st` 额外三场景通过，4 个示例通过 JSON Schema 校验。`npm run build:vscode` 成功，保留已有 tree-sitter require.resolve 警告。
- 第二阶段审查修复：inout 协议只替换赋值目标，避免改写检查记录或跳过总线解析；画布与编译器统一 inout/初始值规则；Analyze 使用展开场景和数据文件；结果标记 rerun 来源。协议与 host 复核通过。
- 当前画布协议信号标记使用第一个用例，文档和界面明确注明；协议为有限事务模板。完整协议一致性验证不属于本阶段。此条为第二阶段历史验收；第三阶段按上方轻量方案继续，未打包或发布新版本。


- 2026-09-15：用户取消结果归档与输入快照；第三阶段改为每次使用当前源码。历史验收记录保留供追踪，其涉及磁盘快照/历史恢复的旧行为已被新方案取代。

- 2026-09-15：第三阶段按轻量方案完成。42 项 core、38 项真实 Icarus WASM、11 项 CLI 任务测试和 7 个 host/工作流测试文件通过；VS Code 与 CLI 构建通过。5 个示例通过 schema 验证，新增四协议示例 CLI 全部通过；新旧浏览器交互 smoke 通过。
- 当前源码验收：不修改 `.st`，改变 RTL 后检查从 passed 变为 failed；修改当前期望或数据后重新执行变回 passed。临时目录没有 manifest/resolved-task/inputs，重启不加载会话结果。可选缓存源/include 变化失效，seed 变化仍重新运行。
- 独立审查修复并复核通过：FIXED 最多 16 拍、合法 WRAP 起点与 4 KiB 边界、I2C STOP 忽略 SCL 低时 SDA 释放；新增各角色手写参考端。CLI 嵌套 hybrid include 报告覆盖保护、GUI/CLI 显式模块来源绑定一致。
- 本次未打包、改版本或发布。全量包测试仍有既有 Windows 命令/换行/路径预期及波形启动器清理问题，本次通过的是受影响功能测试与构建，不代表完整发布检查已通过。使用实际 Icarus WASM 验证（VKS 不可用）。
