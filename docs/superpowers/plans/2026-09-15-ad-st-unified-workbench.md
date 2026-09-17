# AD / ST Unified Workbench Implementation Plan

> 历史方案，已由 2026-09-16 的 AD/ST 核心统一方案取代；文中的用例矩阵、验证环境、拖放和独立编辑页面不代表当前功能。当前使用说明见 [Simulation Task](../../simulation-tasks.md)。

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task after user approval. Steps use checkbox (`- [ ]`) syntax for tracking. Do not start implementation while this document is awaiting design review.

**Goal:** 将文件浏览、AD 设计、ST 仿真统一为三个职责清晰的侧栏，并让 ST 复用 AD 编辑器及原生 HDL 激励编辑。

**Architecture:** 保留 AD/ST 独立文档模型，以公共图形协议和领域适配器共用 `schematic-webview`。直接修订尚未发布的 ST 首版格式，增加组件引用、内嵌源码和验证结算；VS Code/CLI 共用输入准备，工具设置由宿主注入。完整验证模板展开成可独立编辑的普通 HDL 组件。

**Tech Stack:** TypeScript、VS Code TreeDataProvider/CustomTextEditorProvider/WorkspaceEdit/FileSystemProvider、现有 schematic-webview、flow-core、hdl-runtime、Icarus WASM、Node test runner。

**Spec:** [AD / ST 统一工作台设计](../specs/2026-09-15-ad-st-unified-workbench-design.md)

## Global Constraints

- 状态：用户已批准，进入实施。最新约定：菜单为“插入 HDL 模板”，所有局部模板只插入光标处，不识别、校验或调整语法位置。
- Node.js >=24.14.1；本轮不改版本、不发布、不生成发行包。
- 自定义激励默认内嵌 `.st`，支持另存为 `.v/.sv`。
- 仿真器、波形器只提供 `builtin` / `custom`，在设置里选择和配置；ST 不保存或编辑工具选择和命令。
- 保留现有 `.ad` 文件格式及用户已完成的 AD 修复。
- 不增加工程内运行归档、输入快照或长期结果历史。
- 删除被安全策略阻止时按根 AGENTS.md 移入 `.trash` 并保留相对路径。
- 当前工作区有大量未提交改动。禁止 reset/覆盖基线；只提交本轮实际实现范围，禁止 `git add -A` 混入已有工作。
- 本计划选择同一会话逐任务执行；不默认启动子代理。
- ST 尚未发布，不实现旧 ST 读入/升级、设置搬迁、旧 workspaceState 任务迁移或双版本适配器。保留首版 schemaVersion=1，仓库示例/测试直接修订。
- 右键添加必须可用；优先使用原生拖放，逐路径实测后启用，不支持的宿主路径仅保留右键。
- 空白 ST 不强制生成 monitor/scoreboard；完整验证环境为可选组合模板，成员均能编辑 HDL。
- Simulation Task 栏保留独立运行传统 `.v/.sv` Testbench，无须创建 `.st`、wrapper 或图形环境；共用执行工具设置与运行互斥，保留手写 TB 自己的结束及文件 I/O 语义。
- 保留完整传统 TB 生成和局部模板插入，移除独立 TB 生成页面；HDL 右键仅一个 VeriFlow 子菜单，模板通过可搜索 Quick Pick 与 VS Code 命令进入。

## 0. 开始前及检查规则

- [ ] 阅读 spec、根 AGENTS.md 和当时工作区的实际代码，记录 `git status --short`、`git diff --stat`、Node 版本、当前分支与 HEAD。
- [ ] 使用 using-git-worktrees 技能检查隔离需求；工作起点必须包含当前未提交 ST/AD 成果，不能从裸 HEAD 创建工作树后丢失它们。
- [ ] 检查锁文件和依赖状态，必要时 `npm ci`；运行相关现有测试，记录既有失败，不将其误称为本轮回归。
- [ ] 功能任务先写行为失败测试、确认失败原因，再实现；无须给纯文案/静态布局增加镜像测试。
- [ ] 每任务在定向测试通过后检查 diff，并形成可独立审查的提交。提交文件名单从当次 diff 确认，只 stage 本轮 hunk。

现有脚本约定：

```powershell
# flow-core / schematic-core 定向测试：从仓库根运行
npm exec -- tsc -p packages/flow-core/tsconfig.test.json
node --test packages/flow-core/dist-test/test/simulationTask.test.js

# VS Code 测试不是全部使用 node --test；沿用仓库现有可执行 test 文件方式
npm run compile:ts --workspace veriflow-vscode
node veriflow-vscode/out/test/archDesignCreation.test.js

# 共享图形类型检查
npm run typecheck --workspace @veriflow/schematic-webview
```

新增 VS Code 测试参考 `archDesignCreation.test.ts`、`simulationTaskEditor.test.ts` 的 harness；新增 core 测试参考现有 `node:test`/assert 风格。涉及包导出改变时先 `npm run build:shared` 再编译消费者。

## 1. 文件责任图

以下“新增”文件是本计划确定的目标位置；已有文件均以当前工作区为准。

| 单元 | 文件 | 责任 |
|---|---|---|
| ST 文档 | `packages/flow-core/src/simulationTask/document.ts`（新增） | 首版目标文件模型与序列化 |
| 组件 | `packages/flow-core/src/simulationTask/components.ts`（新增） | 稳定引用、组件数据、编译模型降低 |
| 结束条件 | `packages/flow-core/src/simulationTask/completion.ts`（新增） | 三种结束策略与 HDL 发射 |
| 激励模板 | `packages/flow-core/src/simulationTask/stimulusTemplates.ts`（新增） | 模板源码生成及元数据 |
| 验证组件 | `packages/flow-core/src/simulationTask/verificationTemplates.ts`（新增） | monitor/model/scoreboard/checker/coverage HDL 生成 |
| 验证报告 | `packages/flow-core/src/simulationTask/verificationReports.ts`（新增） | 动态检查报告、摘要与终态校验 |
| 验证组合 | `packages/flow-core/src/simulationTask/verificationEnvironment.ts`（新增） | 模板成员、端口映射、预连线与原子插入草稿 |
| 运行设置 | `packages/flow-core/src/simulationTask/executionSettings.ts`（新增） | 两种后端的规范化执行配置 |
| 输入准备 | `packages/hdl-runtime/src/simulationTaskInputs.ts`（新增） | HDL/AD/内嵌源码准备与来源映射 |
| 创建文件 | `veriflow-vscode/src/documentCreation.ts`（新增） | AD/ST 保存对话框和命名规则 |
| 工作台导航 | `veriflow-vscode/src/workbench/`（新增） | 文件浏览、目标文档、添加模块命令 |
| 原生拖放 | `veriflow-vscode/src/workbench/moduleDragAndDrop.ts`（新增） | 树拖放与同一模块插入服务衔接 |
| 公共编辑协议 | `veriflow-vscode/src/schematic/editorProtocol.ts`（新增） | 公共动作、能力和宿主校验 |
| 共享前端 | `packages/schematic-webview/src/editor/`（新增） | 原 index.ts 按职责提取的交互/工具栏/属性接缝 |
| ST 属性与抽屉 | `packages/schematic-webview/src/simulation/`（新增） | 用例、结果、ST 属性 |
| ST 适配 | `veriflow-vscode/src/simulationTask/taskGraphAdapter.ts`（新增） | 图形投影与语义写回 |
| 内嵌编辑 | `veriflow-vscode/src/simulationTask/embeddedSourceProvider.ts`（新增） | 虚拟文件编辑与父文档保存 |
| 激励命令 | `veriflow-vscode/src/simulationTask/stimulusCommands.ts`（新增） | 创建草稿、另存与引用切换 |
| ST 树 | `veriflow-vscode/src/simulationTask/taskTreeProvider.ts`（新增） | 从 controller 提取任务/结果树 |
| 传统 TB | `veriflow-vscode/src/simulationTask/traditionalTestbenchController.ts`（新增） | 独立 HDL 顶层选择、运行和结果，不创建 ST 文件 |
| 共用运行槽 | `veriflow-vscode/src/simulationTask/runCoordinator.ts`（新增） | 图形 ST/传统 TB 互斥、取消及目标身份 |
| TB 文本模板 | `packages/flow-core/src/testbenchTemplates.ts`（新增） | 完整骨架和局部 HDL 片段的共用纯生成函数 |
| 编辑器模板入口 | `veriflow-vscode/src/testbench/templateCommands.ts`（新增） | Quick Pick、命令注册、snippet/原子文本编辑 |
| 插入上下文 | `veriflow-vscode/src/testbench/insertionContext.ts`（新增） | 捕获编辑器、光标、文档版本及 ST 管理上下文；不检测语法范围 |

不新增 UI 框架、画布依赖或另一套 webview 构建包。`web-dist/schematic/*` 必须由现有 `npm run build:web` 生成，不手改。

## Task 1: 直接修订首版 ST 文档契约

**Files:** 新增 `document.ts`；修改 `model.ts`、`validation.ts`、`index.ts`、`packages/flow-core/src/index.ts`、`veriflow-vscode/schemas/simulation-task.schema.json`。新增 `packages/flow-core/test/simulationTaskDocument.test.ts`，直接更新相关测试 fixture。

**Interfaces:** 文档模型使用 `SimulationTaskDocument`，内部编译输入另定义 `SimulationTaskCompileModel`；后者只服务编译，不支持读入历史文件。既有 compiler 算法可沿用，但输入类型不能继续携带任务内工具设置。

```ts
export type SourceRef =
  | { kind: 'hdl'; path: string; module: string }
  | { kind: 'ad'; path: string }
  | { kind: 'embedded'; assetId: string; module: string }
  | { kind: 'builtin'; templateId: string; version: number };
export type Completion =
  | { kind: 'duration' }
  | { kind: 'steps' }
  | { kind: 'signals'; signals: string[] };
export interface EmbeddedSource {
  id: string;
  filename: string;
  language: 'verilog' | 'systemverilog';
  text: string;
  template?: { id: string; version: number };
  readiness?: 'needs-implementation' | 'ready';
}
export interface ComponentInstance {
  id: string;
  reference: SourceRef;
  parameters: Record<string, string>;
  connections: Record<string, string>;
  role?: 'stimulus' | 'sequence' | 'driver' | 'monitor' | 'reference-model'
    | 'scoreboard' | 'checker' | 'coverage' | 'control' | 'module';
  channels?: TransactionChannel[]; // Task 11A 定义的可选事务端口契约
}
```

`SimulationTaskDocument` 保留 format/mode/hdlTop/sources/runtimeFiles/defaults/cases/probes/extensions/presentation，schemaVersion=1；environment={instances:ComponentInstance[], nets:TaskNet[]}；assets:EmbeddedSource[]；completion:Completion；verification?:TaskVerification（见 Task 11A）。移除 name，显示名由宿主 task URI/path 派生。defaults 去掉 backend/compileCommand/runCommand/parallelism/cache。时钟/复位 builtin 的周期等使用 parameters 的字符串值，由组件描述符解析校验。普通模块未指定 readiness 时不受模板骨架阻塞规则影响。

`SimulationTaskCompileModel` 显式包含宿主派生 name、mode/hdlTop、sources/runtimeFiles、已解析 HDL instances（id/module/source/parameters/connections）、nets/clocks/resets、时间/include/define defaults、cases/probes/extensions、completion/verification；不含 SourceRef、内嵌文档源码或任何 backend/工具命令。Task 7/9 将来源解析成该模型后才交给 compiler。

```ts
export function createTaskDocument(): SimulationTaskDocument;
export function readTaskDocument(text: string): SimulationTaskDocument;
export function serializeTaskDocument(task: SimulationTaskDocument): string;
```

- [ ] 写目标文档往返、builtin/embedded 引用、废弃字段诊断测试，不编写格式升级或转换器测试。
- [ ] 核心测试至少包含：

```ts
const task = createTaskDocument();
assert.equal(task.schemaVersion, 1);
assert.equal(task.completion.kind, 'duration');
assert.equal('backend' in task.defaults, false);
assert.equal('name' in task, false);
assert.deepEqual(readTaskDocument(serializeTaskDocument(task)), task);
assert.throws(() => readTaskDocument(JSON.stringify({
  ...task, defaults: { ...task.defaults, backend: 'custom' }
})), /defaults.backend/);
```

- [ ] 运行：`npm exec -- tsc -p packages/flow-core/tsconfig.test.json`，再 `node --test packages/flow-core/dist-test/test/simulationTaskDocument.test.js`；先因新 API 缺失失败，再实现并通过。
- [ ] 所有读写入口使用唯一目标格式，未知版本或废弃结构明确诊断；读取不改原文件。直接修订仓库维护的示例/测试，保留其功能用例，不批量改用户试验文件。
- [ ] 增加重复 asset/instance ID、缺失 embedded 引用、非法路径/模块标识、非法时间参数、未知宽度的负例。沿用 JSON 大小/深度防护；内嵌源码使用明确源码大小上限，不意外套用小字段限制。
- [ ] 内嵌资产源码上限每项 1 MiB（UTF-8），每任务合计 8 MiB；其他 JSON 字段沿用现有限制。空白任务 assets/reporter 为空，不自动加验证框架。
- [ ] 在 Task 11A 落地验证元数据之前，先定义相同类型契约并拒绝不完整绑定；增加源码待实现状态不伪造 ready 的测试。检查并提交 `refactor(st): define the first-release component document`。

## Task 2: 工具设置从任务移到宿主

**Files:** 新增 `executionSettings.ts`；修改 `veriflow-vscode/src/config.ts`、`extension.ts`、`taskController.ts`、`veriflow-vscode/package.json`、`packages/cli/src/main.ts`、`commands/task.ts`。新增 `packages/flow-core/test/simulationTaskSettings.test.ts`；扩展 `packages/cli/test/taskCommand.test.ts`、VS Code `simulationTaskController.test.ts`。

**Interfaces:**

```ts
export interface TaskExecutionSettings {
  simulator: 'builtin' | 'custom';
  compileCommand?: string;
  runCommand?: string;
  parallelism: number;
  compileCache: boolean;
}
export function validateTaskExecutionSettings(
  settings: TaskExecutionSettings
): TaskDiagnostic[];
```

- [ ] 先写测试：执行只读取资源/项目设置，ST 中废弃工具字段按格式错误拒绝；custom 缺少命令失败；不接受 native-iverilog/vcs/xsim 等独立选项。
- [ ] VS Code 按资源 URI 读取既有 `veriflow.*` 工具配置，新增 parallelism/cache 设置；仿真服务接口改为接收已解析 `TaskExecutionSettings`，run.backendId 记录实际值。
- [ ] compiler/runner 通过独立执行配置接收工具、jobs/cache，运行模型不得序列化回 `.st`，不保留任务设置适配层。
- [ ] CLI `task run/validate` 接收 `--project/-p`；使用已有 ProjectStore 读配置；未提供项目用 builtin；不从 cwd 猜一个项目。`--jobs/--cache` 合并在本次执行设置中。
- [ ] 保留波形器已有设置路径；任务页删除 backend 和 command 控件，尚未替换的旧页面也不继续暴露它们。
- [ ] 删除未发布 ST 的迁移命令、配置复制向导和隐藏设置读取；不为用户全局/工作区设置自动写入历史值。
- [ ] 运行 core settings 定向测试、CLI task 测试及 VS Code controller 测试；断言两种入口输入同一有效设置时解析结果一致。
- [ ] 检查并提交 `refactor(st): resolve execution tools from host settings`。

## Task 3: AD/ST 统一创建

**Files:** 新增 `veriflow-vscode/src/documentCreation.ts`；修改 `archDesign/archDesignCreation.ts`、`extension.ts`、`simulationTask/taskController.ts`。扩展 `src/test/archDesignCreation.test.ts`，新增 `src/test/documentCreation.test.ts`。

**Interfaces:**

```ts
export type DocumentKind = 'ad' | 'st';
export function moduleNameFromFilename(filename: string): string;
export interface DocumentCreationHost<Resource> {
  chooseTarget(kind: DocumentKind): Promise<Resource | undefined>;
  basename(target: Resource): string;
  exists(target: Resource): Promise<boolean>;
  writeNew(target: Resource, text: string): Promise<void>;
  open(target: Resource, kind: DocumentKind): Promise<void>;
}
export function createWorkbenchDocument<Resource>(
  kind: DocumentKind, host: DocumentCreationHost<Resource>
): Promise<Resource | undefined>;
```

- [ ] 写保存对话框调用次数、取消、冲突不覆盖测试；用存根 host 断言没有 requestModule，写后只打开对应编辑器。
- [ ] 命名测试：`soc.ad→soc`、`soc-top.ad→soc_top`、`123.ad→design_123`、`module.ad→module_design`、全非法字符回退 design。
- [ ] 使用现有 `createEmptyArchDesignText` 和 Task 1 的 `createTaskDocument` 创建内容。命名检查复用 Verilog 标识符/关键字规则，不自行维护不完整关键字表。
- [ ] 接入当前文件夹/文档目录/多根工作区默认路径；writeNew 防止选择后出现同名文件的竞争，不依赖单次 exists 检查。
- [ ] 文件重命名只改 UI 标签，现有 AD module 不自动变更；新 ST 不再显示独立 name 表单。
- [ ] 运行 documentCreation、archDesignCreation 测试；检查并提交 `feat(workbench): unify AD and ST file creation`。

## Task 4: 三栏导航与精确模块添加

**Files:** 新增 `src/workbench/fileBrowserProvider.ts`、`documentTargets.ts`、`moduleCommands.ts`、`moduleDragAndDrop.ts`、`simulationTask/taskTreeProvider.ts`；修改 `archDesign/archDesignTreeProvider.ts`、`workflowViews.ts`、`workflowController.ts`、`moduleTreeProvider.ts`、`extension.ts`、`package.json`。新增 `src/test/workbenchNavigation.test.ts`、`moduleTargets.test.ts`、`moduleDragAndDrop.test.ts`；扩展 archDesignTreeProvider 测试。

**Interfaces:**

```ts
export interface ModuleReference { sourceUri: string; module: string }
export interface DocumentTarget { uri: string; kind: 'ad' | 'st' }
export interface ModuleInsertionRequest {
  target: DocumentTarget;
  modules: ModuleReference[];
  position?: { x: number; y: number }; // 画布坐标，可选
}
export interface ModuleDragPayload {
  version: 1;
  modules: ModuleReference[];
}
```

目标选择依赖当前焦点的文档登记表，不依赖旧 top 或最后一个 activeTask；新增 `veriflow.addModuleToAD`、`veriflow.addModuleToST`，所有运行/结果命令携带目标 URI。

- [ ] 写行为测试：同名模块不同来源、两个目标编辑器、焦点在普通源码、无目标需新建、用户取消选择。插入只更新指定文档。
- [ ] 将 views 改为 `veriflow.files` / `veriflow.archDesigns` / `veriflow.simulationTasks`，同步 activation、menus、viewsWelcome；移除未发布 ST 的迁移命令，保留已发布功能仍有用途的入口。
- [ ] 文件视图按源目录/文件/模块组织；过滤生成产物、node_modules、.git、.trash；外部库单独标识。文件操作通过 VS Code WorkspaceEdit/标准命令，不实现隐式整个文件符号删除。
- [ ] AD 依赖树使用文档实例为根和当前 HDL 索引，按源码身份与实例路径分辨重复节点；不调用文件导出。查看 RTL 建只读虚拟文档，显式 export 保留。
- [ ] ST controller 的 tree rendering 提取出来，图形结果归属任务 URI；加入“传统 Testbench”分组，传统结果使用 Task 4A 的明确目标身份。撤掉独立 Results 视图。
- [ ] 从文件/AD 上下文完成添加；生成唯一实例 ID，新增实例的端口留空，未接状态不被误判为解析失败。
- [ ] 新增 `TreeDragAndDropController`：MIME=`application/vnd.veriflow.modules+json`，payload 为序列化 `ModuleDragPayload`；文件树发出，AD/ST 树在具体文档节点接收。取消不插入，多选插入为单个撤销事务，drop 始终表示复制模块引用。
- [ ] 先在真实 VS Code 最低支持版/开发版验证树→文档，再验证树→Webview（含 Shift）。以目标文档/画布决定插入目标；宿主重新解析 URI+module、校验版本和只读状态，拒绝过期索引和不完整 payload。
- [ ] 不把树对象内部句柄写成持久化协议，不用“最后拖动模块”全局变量补全丢失数据。树到 Webview 不支持时保留树到文档（若支持）及右键；所有原生路径均不支持时仅右键。
- [ ] 为支持路径记录宿主版本、普通拖动/Shift、取消、同名不同文件、多选、只读目标、跨目标误投的真实结果；拖放单元存根测试不能替代宿主实测。右键功能不依赖这些检测结果。
- [ ] 运行 navigation、moduleTargets、archDesignTreeProvider 及旧 workflow/extension 注册测试。人工确认无 Design top，AD/ST 可在不选 top 的情况下完成基本操作。
- [ ] 检查并提交 `feat(workbench): separate files designs and simulation tasks`。

## Task 4A: Simulation Task 栏独立运行传统 Testbench

**Files:** 新增 `src/simulationTask/traditionalTestbenchController.ts`、`runCoordinator.ts`；修改 taskTreeProvider、taskController、extension、package.json；按需要从现有 `workflowController.ts` / `extension.ts` 提取带明确 definitionKey 的依赖分析调用，复用 `src/core/simulationService.ts`，不重写仿真器。新增 `src/test/traditionalTestbenchController.test.ts`、`simulationRunCoordinator.test.ts`，扩展现有 HDL 执行回归。

**Prerequisites:** Task 2、4。该功能不依赖图形画布、激励模板或验证组件完成。

**Interfaces:**

```ts
export interface TraditionalTestbenchTarget {
  kind: 'testbench';
  sourceUri: string;
  module: string;
}
export type SimulationRunTarget =
  | { kind: 'st'; uri: string }
  | TraditionalTestbenchTarget;
export interface SimulationRunCoordinator {
  readonly active: SimulationRunTarget | undefined;
  run<T>(target: SimulationRunTarget,
    operation: (signal: AbortSignal) => Promise<T>): Promise<T>;
  cancel(target: SimulationRunTarget): void;
}
```

目标源码 URI+module 在每次运行重新解析为当前 definitionKey；不把可能失效的索引 key 当持久身份。新命令 `veriflow.runTraditionalTestbench` 接收可选 `TraditionalTestbenchTarget`，无参数时选择入口；`veriflow.selectTraditionalTestbench` 切换入口，`veriflow.stopTraditionalTestbench` 只取消该功能当前运行。artifact 操作明确携带 target+runId，不能从 active ST 猜测归属。

- [ ] 先写红测：工作区没有 `.st` 仍可选择顶层运行，保存/新建对话框不被调用，生成 wrapper 或修改 TB 的接口不被调用。已有 active ST 时点击传统命令仍只执行指定 TB。
- [ ] 选择器显示模块名与源码相对路径，支持浏览文件；多模块文件明确选顶层，同名不同来源精确解析。可按 TB 特征排序，不能用名字或端口数量硬过滤模块。
- [ ] Simulation Task 栏固定“传统 Testbench”分组，显示运行入口、最近选择、打开源码、运行/停止、会话日志与波形；不额外创建第四栏，不强制进入图形编辑器。
- [ ] 复用现有依赖解析与 `SimulationService.run`，传 `SimulationServiceRunInput` 的明确 topModule/files/libDirs/defines 和资源作用域 builtin/custom 配置；保存真实输入，取消选择/保存失败不运行旧内容。
- [ ] 保留手写 TB 的 `$finish`、运行数据、include 和 dump 设置；不套用生成 ST 的 `VFST_DONE`、reporter、completion、finalize。正常退出且无自动检查协议时标为 completed-unverified，不能从 PASS 文本推断通过。
- [ ] 独立运行结果使用 target+runId；编译失败、执行失败、真实时间超时、取消、无波形和本次未更新的旧波形分别正确显示。波形沿用既有实际产物判定，不能仅按路径存在就复用残留文件。
- [ ] 把图形 ST 和传统 TB 接入同一 coordinator：忙时第二次运行明确提示等待/停止，不并行启动、不静默替换。运行结束/失败在 finally 释放；取消校验目标，仅选中另一个文件不会终止原运行。
- [ ] 从旧 `veriflow.simulate` 命令移除“只要 hasActiveTask 就运行 ST”的隐式抢占；菜单/按钮传明确目标，命令面板无上下文时明确选择图形任务或传统 TB。不恢复全局 AD/文件 top，不导入旧 workspaceState 任务。
- [ ] 行为测试覆盖两种运行目标竞争/取消、源码重命名或删除、同名模块、当前 ST 切换、不同结果 artifact 归属。参考现有 core simulationService 测试注入 backend，不用 mock 结果冒充实际 HDL 仿真。
- [ ] 真实 builtin 回归：带子模块/include/数据文件的独立 TB 正常 `$finish`、输出 VCD；另测无 dump TB、无限运行超时和语法错误。运行前后确认未创建 `.st`/wrapper、未修改 HDL；`mode=hdl` 文件任务仍可运行，但不作为直接执行的必经步骤。
- [ ] 运行 traditionalTestbenchController、simulationRunCoordinator 和既有 builtin simulation 测试；检查并提交 `feat(simulation): retain direct traditional testbench execution`。

## Task 4B: 在 HDL 文本编辑器生成 TB 骨架及局部模板

**Files:** 新增 `packages/flow-core/src/testbenchTemplates.ts` 并更新 package/index 导出；新增 `veriflow-vscode/src/testbench/templateCommands.ts`、`insertionContext.ts`。修改 `core/testbenchGenerator.ts`、`extension.ts`、`workflowController.ts`、`simulationTask/taskTreeProvider.ts`、`veriflow-vscode/package.json`。完成调用替换后移除 `testbenchPanel.ts`，将仍有价值的测试转入新测试而非原样保留无效 Webview harness。

**Tests:** 新增 `packages/flow-core/test/testbenchTemplates.test.ts`、`veriflow-vscode/src/test/testbenchTemplateCommands.test.ts`、`testbenchInsertionContext.test.ts`；扩展 `moduleInstantiationLifecycle.test.ts` 和传统 TB 实际仿真测试。更新仍直接执行 testbenchPanel.test 的 npm 脚本及 provider 注册断言。

**Prerequisites:** Task 2、4、4A。ST 内嵌源码的适用模板过滤在 Task 10 接入后追加验证。保持原生文本生成闭环独立于图形 ST 的实现进度。

**Interfaces:**

```ts
export type TestbenchTemplateId = 'skeleton' | 'clock' | 'reset'
  | 'timeout' | 'waveform' | 'initial' | 'wait-cycles' | 'finish' | 'timescale';
export type TemplateScope = 'file' | 'module' | 'procedural' | 'new-document';
export interface TemplateParameter {
  name: string;
  value: string;
}
export interface TestbenchTemplateContext {
  moduleName?: string;
  scope: TemplateScope;
  managedBySimulationTask: boolean;
  timeUnit?: string;
  timePrecision?: string;
  existingSignals: Array<{ name: string; width: string; writable: boolean }>;
}
export interface TestbenchTemplateRender {
  text: string;
  scope: TemplateScope;
  declarations: string[];
  diagnostics: Array<{ code: string; message: string }>;
}
export function renderTestbenchTemplate(
  id: TestbenchTemplateId,
  parameters: readonly TemplateParameter[],
  context: TestbenchTemplateContext
): TestbenchTemplateRender;
```

该函数只生成目标片段和声明需求，不写文件、不推断整个 DUT 算法、不执行仿真。完整骨架组合这些基础片段，并通过已有 `formatModuleInstantiation` 和 HDL 索引生成 DUT 实例；不复制一套例化格式化逻辑。ST 组件模板能复用不涉及独立 TB 结束/转储的底层片段，但不能直接把整个传统模板塞入 ST 模块。

- [ ] **先写生成红测**：clock 在 1ns/1ps/1us 下对应同一物理周期；无法表示的半周期诊断；reset 两种极性、周期/时间释放；waveform 字符串和目标模块正确；timeout 明确仿真时间；已有信号复用不重复声明。运行 `npm exec -- tsc -p packages/flow-core/tsconfig.test.json` 和 `node --test packages/flow-core/dist-test/test/testbenchTemplates.test.js`，确认预期失败后实现。
- [ ] 提取旧 TestbenchGenerator 的时钟、复位、dump、timeout 和完整骨架生成逻辑为纯 render；保留多 DUT 参数/端口生成，改为原生编辑器缓冲区写入。若已有非 UI 调用需要 generate 文件 API，保留薄封装；新编辑器命令不调用覆盖磁盘的 generate 方法。
- [ ] 完整骨架的 DUT 参数/位宽优先保留合法 HDL 表达式，需求值时复用已有受限参数求值；不能继承旧 evalExpr 失败时回退 1 位的行为。多 DUT 同名信号不自动合并，明确来源与连接，使用唯一局部信号名。
- [ ] **菜单收敛**：新增 `veriflow.hdlEditor` submenu，editor/context 中仅该一项；子项为现有 instantiateModule、insertTestbenchTemplate、formatHdl、runTraditionalTestbench，最多五项。原有 command ID 保留，不重复注册、不重复根菜单。
- [ ] 新增通用命令 `veriflow.insertTestbenchTemplate`；常用直达命令 `veriflow.insertTbClock`、`veriflow.insertTbReset`、`veriflow.insertTbTimeout`、`veriflow.insertTbWaveform` 全部调用同一 handler 并预选 template ID。commandPalette 按 HDL 编辑上下文显示，用户可自行绑定快捷键，默认不新增键位占用。
- [ ] Quick Pick 使用一个可搜索列表和分隔标签，label/description 支持中英文关键词；不多级分类，不为模板建 Webview。选定后少量需校验参数用原生输入收集，适合就地编辑的参数转成 snippet 占位和镜像引用。
- [ ] **上下文规划**：读取当次 HDL 索引/文档文本确定包含光标的 module/过程/文件级位置，复用源码 span；未保存变更使用对应文档版本解析。解析不确定时允许预览/复制，但不能按旧索引猜位置写入。
- [ ] 时钟/复位/timeout/initial/waveform 是模块级块，wait-cycles/finish 是过程语句，timescale 是文件级指令。位置不合法时明确选择模块级合法点或取消；用户选择不被模板默认整体替换。结构模板多光标明确拒绝，不影响既有例化命令自己的行为。
- [ ] 命令捕获 invocation editor/URI/version/selection，异步 picker/参数输入后验证未变；切换文档或改动目标时取消插入并提示重新调用，避免插到另一文件或覆盖新编辑。read-only/非 HDL/取消均零编辑。
- [ ] **编辑事务**：单位置且无需其他变动时用 TextEditor.insertSnippet，一次 undo；多位置声明/指令+块先完成配置，再用一条 TextEditor.edit（含多个 range）原子应用，一次 undo，不分两次编辑伪装原子性。保留缩进、EOL、未保存状态，不自动运行。
- [ ] SnippetString 使用 appendText/appendPlaceholder 构造，不将含 `$finish`、`$dumpfile`、反斜杠标识符或用户字符串的原始 HDL 直接当 snippet 语法；测试插入后文本保留这些字面值和预期占位跳转。
- [ ] 检测可靠识别的重复信号驱动、已存在 dump 或同类超时块，提供定位/取消；合法复用已声明信号不再声明。宏/include 上下文未知时不猜 timescale/驱动，给预览和明确提示。
- [ ] `veriflow.generateTestbench` 改为“新建传统 Testbench…”：选择可选 DUT（支持多选）及基础模板，生成到新未保存 HDL 文档；只有当前空白 HDL 文档可直接填入。最终由 VS Code Save As 命名，不先强制新建 `.st`，不要求全局 Design top。
- [ ] Simulation Task 的传统 TB 分组连接同一新建命令；原“生成并运行”页面回调改为显式文本生成后用户运行，不残留 `openGenerator`/`tbPanelProvider` 刷新、可见性和销毁调用。删除 Webview HTML 和 provider 后同步调整依赖测试及脚本。
- [ ] ST 管理的内嵌文档通过 owner/context 标记，隐藏并在 handler 拒绝 skeleton/timeout-finish/finish/全局 waveform/timescale 等破坏 runner 管理的操作；普通传统 `.v/.sv` 保持可用，不能仅凭扩展名判断是否是 ST 管理的文档。
- [ ] 内嵌 HDL 上隐藏“运行当前传统 Testbench”，handler 拒绝把虚拟组件文档作为独立 TB 运行；其正常执行仍走所属 ST，避免创建第二条脱离 ST 的执行路径。
- [ ] **行为测试**：右键根项数量不随模板数变化、常用直达命令与 picker 结果一致、现有例化/格式化仍正常；单次撤销恢复原文、取消/焦点变化不写入、模块/过程位置区别、CRLF/tab/空文档/多模块文件、同名信号、不同 timescale、未解析文档、只读编辑器均覆盖。
- [ ] 用真实 builtin 仿真验证“完整骨架→编辑参数→局部模板→直接运行传统 TB”，确认时钟/复位物理时间、timeout 和 VCD 正确；新旧面板无双注册，没有新 ST 文件。检查并提交 `feat(testbench): generate templates directly in HDL editors`。

## Task 5: 从 AD 提取共享图形能力

**Files:** 新增 `src/schematic/editorProtocol.ts`；修改 `protocol.ts`、`webviewSupport.ts`、`archDesign/editorSupport.ts`、`archDesignEditorProvider.ts`；从 `packages/schematic-webview/src/index.ts` 提取 `editor/capabilities.ts`、`editor/toolbar.ts`、`editor/inspector.ts`。扩展 schematicProtocol、schematicWebviewSupport、archDesignEditorProvider 测试。

**Interfaces:**

```ts
export interface EditorCapabilities {
  editInstances: boolean;
  editConnections: boolean;
  addPorts: boolean;
  addLogic: boolean;
  addStimulus: boolean;
  exportRtl: boolean;
  runSimulation: boolean;
}
export interface GraphEndpoint { nodeId: string; pinId: string }
export type GraphEditCommand =
  | { kind: 'connect'; from: GraphEndpoint; to: GraphEndpoint }
  | { kind: 'disconnect'; networkId: string; endpoint: GraphEndpoint }
  | { kind: 'delete'; objectIds: string[] };
export interface GraphEditMessage {
  type: 'editGraph';
  revision: string;
  edit: GraphEditCommand;
}
```

初始化事件增加 documentKind=`hdl|arch-design|simulation-task` 和 capabilities。图形结构继续用现有 SchematicGraph / layout，布局保存单独命令；属性更新仍由领域专用消息校验，避免任意 JSON patch 越过校验。

- [ ] 写协议失败测试：ST 的 exportRtl=false 时宿主拒绝导出；过期 revision 不写文件；节点 ID+端口 ID 共同定位端点。
- [ ] 先让 AD 走公共 toolbar/selection/connection 分发，内部再转换为现有 ArchDesignEdit；保持 AD edit/RTL 核心语义原样。
- [ ] 将硬编码 `documentKind === 'arch-design'` 的 UI 能力判断改为显式能力；导出快捷键仅在对应能力注册，不留隐形动作。
- [ ] 只提取需要共用的接缝，不顺手重构全部 index.ts。保持现有 DOM ID、CSS 和交互顺序，便于 AD 回归。
- [ ] `npm run typecheck --workspace @veriflow/schematic-webview`；运行 AD/provider/protocol/support 测试以及 `npm run test:schematic-integration --workspace veriflow-vscode`。
- [ ] 人工回归 AD 逻辑工具、接口分组、direct inout、布局/重连/撤销/搜索；检查并提交 `refactor(editor): expose shared graph editing capabilities`。

## Task 6: ST 使用同一个画布与文档协议

**Files:** 新增 `src/simulationTask/taskGraphAdapter.ts`；修改 taskEditorProvider、taskCanvas、公共协议与 schematic-webview index；新增 `packages/schematic-webview/src/simulation/taskInspector.ts`。扩展 `src/test/simulationTaskCanvas.test.ts`、simulationTaskEditor 测试。

**Interfaces:**

```ts
export function projectTaskGraph(
  task: SimulationTaskDocument,
  modules: readonly TaskModuleDefinition[],
  taskUri: string,
  caseId: string
): SchematicGraph;
export function applyTaskGraphEdit(
  task: SimulationTaskDocument,
  modules: readonly TaskModuleDefinition[],
  edit: GraphEditCommand,
  caseId: string
): SimulationTaskDocument;
```

- [ ] 写多用例投影测试、连接合并测试与删除/撤销测试；已有 connectTaskPorts 驱动/位宽/并发检查作为回归用例，不绕过它们。
- [ ] taskEditorProvider 改为加载 `buildSchematicWebviewHtml` 和同一构建资产，publish 通用图事件与 ST 专用属性数据。
- [ ] 接入 Task 4 已实测支持的 Webview drop：DOM 坐标按当前平移/缩放转换成画布坐标，发送 `ModuleInsertionRequest`；使用原生 Shift 行为提示。未支持路径不展示误导性落点预览。
- [ ] adapter 提供稳定 node/pin/network ID；未知位宽不得回退为 1。合并/拆线更新实例、所有 case、扫描轴、probe 引用；失败保持原文档。
- [ ] 支持未连接端口首次连接时创建网络，不能延续“必须先在表单建 net 才能连线”的限制。
- [ ] 接入 WorkspaceEdit 版本队列，保存与原生 Undo/Redo 统一；图形局部操作不整页重置视角。
- [ ] 完成新入口后移除 `taskCanvasClient.ts` 与旧 taskEditorHtml 画布渲染部分；无引用后再删除，策略阻止删除时执行 .trash fallback。
- [ ] 运行 canvas/editor 定向测试、shared webview 类型检查；人工 AD/ST 并排检查节点、端口、连线和属性一致。
- [ ] **视觉评审点：** 提交可审查的实际 AD/ST 截图及操作记录，确认共用效果。检查并提交 `feat(st): use the shared schematic editor`。

## Task 7: 组件目录、时钟复位和逻辑工具

**Files:** 新增 core `components.ts`；修改 compiler、validation、index；新增 `src/simulationTask/componentCatalog.ts`、前端 `simulation/componentPalette.ts`；参考 `packages/schematic-core/src/archDesign/logic.ts` 复用逻辑定义。新增 core `simulationTaskComponents.test.ts`，扩展 canvas 测试。

**Interfaces:**

```ts
export interface ComponentDescriptor {
  id: string;
  version: number;
  label: string;
  ports: TaskModuleDefinition['ports'];
  parameterDefaults: Record<string, string>;
}
export interface LoweredTaskComponents {
  task: SimulationTaskCompileModel; // 独立编译输入，不写回磁盘
  generatedSources: Array<{ id: string; filename: string; text: string }>;
}
export function lowerTaskComponents(
  task: SimulationTaskDocument,
  descriptors: readonly ComponentDescriptor[]
): LoweredTaskComponents;
```

时钟固定端口 `out`，parameters=`period`,`initial`；复位固定端口 `out`，parameters=`active`,`releaseAfter`。AD 逻辑工具保持原操作的端口/参数名；其 HDL 生成通过 hdl-runtime/schematic-core 桥接，不能让 flow-core 反向依赖 UI 或引入循环包依赖。

- [ ] 写“时钟块与 DUT 相连后降为同一 net 时钟”、复制组件 ID 不冲突、删除 clock 后 cycles 引用失效诊断测试。
- [ ] 实现 builtin 描述符、添加对话框与属性编辑；输出未连可以保存草稿，运行前给可定位诊断。
- [ ] 时钟/复位直接建立可编辑 builtin 实例；拓展后端 clock initial 支持并保持已有默认值。删去仅展示只读 marker 的代码，不做旧布局转换。
- [ ] 对组合逻辑复用现有 AD 逻辑代码生成及校验，临时生成模块/连线，不将不可综合 ST 模块回流 AD。
- [ ] 保持 driver、inout、open-drain、并行步骤冲突统一；普通 custom inout 多驱动不能因挂了 builtin 标签而跳过检查。
- [ ] 定向运行 components、既有 protocol/graph 连接测试，并用真实 Icarus 断言周期、初值、复位释放时刻。
- [ ] 检查并提交 `feat(st): add editable simulation and logic components`。

## Task 8: 明确结束策略和稳定结果分类

**Files:** 新增 core `completion.ts`；修改 compiler、runner、results、validation；扩展 `simulationTaskRunner.test.ts`，新增 simulator `test/simulationTaskCompletion.integration.test.ts`。

**Interfaces:** `Completion` 来自 Task 1，传入生成 TB 的执行选项；保持 `classifyTaskExecution` 对缺失完成标记和四态检查的区分。

- [ ] 在真实后端写红测：空 steps + 时钟 + duration 必须跑满指定时长，不能在初始化时完成；选择 signals 时等待输出变为 1。
- [ ] 核心用例：完成信号一直为 x/z、永不完成、多个信号、边界 tick、预定检查尚未执行、HDL 提前 `$finish`、取消与真实时间超时。
- [ ] compiler 把“步骤完成”和“任务正常完成”分开记录；duration/signals 均要求步骤完成，steps 模式保持现有行为。
- [ ] watchdog 与正常完成使用确定时序：先稳定采样再判断截止，只有一个终态。错误或超时不能再发正常完成标记。
- [ ] 任意自定义组件正常结束且无检查，仍返回 completed-unverified。模板检查按既有结构化记录统计，不依据普通日志推断。
- [ ] 定向运行 runner 和真实 backend completion 测试，包含按新格式修订的 joint/hybrid/manual；为 Task 11A 预留“停止激励后结算 reporter”的阶段边界，不能提前写最终 DONE。检查并提交 `feat(st): support duration and signal completion policies`。

## Task 9: 共享输入准备与临时 AD/HDL 生成

**Files:** 新增 `packages/hdl-runtime/src/simulationTaskInputs.ts` 并更新包导出；修改 `packages/cli/src/runtime/simulationTaskWorkspace.ts`、`veriflow-vscode/src/simulationTask/taskController.ts`、`extension.ts`、core runner/cache 接缝。新增 hdl-runtime `test/simulationTaskInputs.test.ts`；扩展 CLI task、simulator cache integration 测试。

**Interfaces:**

```ts
export interface GeneratedInput {
  filename: string;
  text: string;
  origin: { uri: string; assetId?: string };
}
export interface TaskInputPreparation {
  task: SimulationTaskCompileModel; // resolved compile model
  modules: TaskModuleDefinition[];
  files: string[];
  generated: GeneratedInput[];
  inputFiles: string[];
  runtimeFiles: string[];
}
```

`prepareTaskInputs(document, taskUri, host)` 由 hdl-runtime 提供。host 明确提供读取当前文本、解析模块、解析依赖和可用 AD 接口目录；返回以上结构。runner 的运行目录先创建，generated 写入该目录并返回来源映射，再进入已有 compile/execute。UI 不把虚拟 URI 当磁盘路径交给 backend。

- [ ] 写 AD 输入无磁盘副作用测试：运行前后工程 `.v/.sv` 文件集合和内容不变；AD 更改后下一次运行实际逻辑改变。
- [ ] 使用 `exportArchDesignRtl` 生成内容，移除 ST 链路对 `exportArchDesignToFile` / publishGeneratedFileAtomic 的调用；显式 AD 导出不受影响。
- [ ] 临时输入去重：同一 embedded asset/AD 多实例仅生成一次定义；不同来源同名 module 明确诊断，禁止碰巧依赖编译顺序。
- [ ] include/数据文件闭包按 spec 规则解析；错误映射回 `.ad`、内嵌 editor 或外部 HDL。
- [ ] cache key 加入生成源码、原始 AD/embedded 内容和模板版本；移位/临时目录随机名不破坏内容缓存。
- [ ] 测试嵌套 include、../、外部数据、AD 依赖更新、重复实例、取消准备、并行 case 隔离；CLI/VS Code 调用同一准备入口。
- [ ] 运行 hdl-runtime inputs、CLI task、cache integration；检查并提交 `refactor(st): prepare generated inputs in temporary workspaces`。

## Task 10: 内嵌源码的原生编辑与保存事务

**Files:** 新增 `embeddedSourceProvider.ts`、`stimulusCommands.ts`；修改 taskEditorProvider、controller、extension；新增 `src/test/embeddedStimulus.test.ts`。

**Interfaces:**

```ts
export interface EmbeddedEditIdentity {
  taskUri: string;
  assetId: string;
  baseText: string;
}
export interface EmbeddedSaveRequest extends EmbeddedEditIdentity {
  text: string;
  createInstance?: ComponentInstance;
}
```

可写 FileSystemProvider 承载 `veriflow-st-source:`；draft state 与父 `.st` 分离，读原始源码，写入调用一条带冲突检查的父文档编辑。不要使用只读 TextDocumentContentProvider 冒充可编辑文档。

- [ ] 写创建草稿取消无 asset/instance、首存一次插入、二次保存更新多实例、父写失败保留 dirty、JSON 同 asset 冲突不覆盖测试。
- [ ] 实现 open/edit/save 的身份映射；稳定 task+asset URI，关闭/重开不丢已保存内容；内嵌源码不注册为全局工作区普通模块污染 AD 候选。
- [ ] 接入 Task 4B 的模板上下文标记，验证内嵌源的原生菜单可用且由 ST 管理的 finish/dump/完整 TB 操作被过滤，直达命令同样无法绕过。
- [ ] 首次保存把 asset+instance 作为同一 WorkspaceEdit；解析失败可存源码并显示无效实例，禁止执行。成功解析后从真实源码更新端口/参数。
- [ ] 源码变化后保留失效连接；断线修复走显式图操作；新增端口不自动接线。
- [ ] Undo/Redo、外部 JSON reload、不同 editor view、父文件移动/另存与删除有同步行为。脏草稿遇父删除保留为可另存文档，不丢用户输入。
- [ ] 实现“导出副本”与“另存并切换引用”两个独立动作；文件写入成功后才改 sourceRef，失败则保持原引用。无引用 asset 清理独立动作。
- [ ] 运行 embeddedStimulus/provider 测试；人工在原生编辑器验证高亮、保存、撤销、重开和错误定位。
- [ ] 检查并提交 `feat(st): edit embedded HDL stimulus in native documents`。

## Task 11: 模板到可编辑 HDL 的创建闭环

**Files:** 新增 core `stimulusTemplates.ts`；修改 `protocols.ts` 及相应协议导出接缝；修改 stimulusCommands、componentPalette；新增 core `test/stimulusTemplates.test.ts` 和 simulator `test/stimulusTemplates.integration.test.ts`。

**Interfaces:**

```ts
export interface StimulusPort {
  name: string;
  direction: 'input' | 'output' | 'inout';
  width: string;
}
export interface StimulusDraft {
  module: string;
  ports: StimulusPort[];
  source: string;
  language: 'verilog' | 'systemverilog';
  completionPort?: string;
}
export function createBlankStimulus(
  module: string, ports: StimulusPort[]
): StimulusDraft;
export function createTemplateStimulus(
  module: string, templateId: string, parameters: Record<string, string>
): StimulusDraft;
```

- [ ] 写模板编译测试：空端口/自定义位宽/保留字拒绝；脉冲、序列模板输出可运行完整 module，驱动端口方向正确，不包含主动结束全任务的 `$finish`。
- [ ] “选择模板 / 自定义端口”只生成一次草稿，调用 Task 10 编辑器；普通保存不再调用生成器。
- [ ] 基础模板先实现空模块、脉冲、计数/数据序列；时钟复位直接组件与“生成可编辑副本”区分明确。
- [ ] 为现有协议编译逻辑增加 module 包装和输出适配：信号引用转为端口、seed 局部化、完成/错误反馈交给任务；保留角色、超时、开漏和 response 检查语义。已有 case protocol steps 不改成 HDL。
- [ ] 模板元数据记录版本；生成后用户源码不自动升级。完成输出仅作结束候选，加入任务时显式配置，不强迫所有自定义模块使用控制端口。
- [ ] 真实仿真器测试沿用已有独立参考端：UART、SPI、APB、AXI-Stream、I2C、AXI4 Full/Lite、RGB888 对应已支持角色均有测试覆盖；不能只让生成器两端互测。
- [ ] **功能评审点：** 添加模板 → 改 HDL → 保存 → 连线 → 执行 → 波形完整闭环。检查并提交 `feat(st): create editable HDL stimulus from templates`。

## Task 11A: 可编辑验证组件、事务检查和结算报告

**Files:** 新增 core `verificationTemplates.ts`、`verificationReports.ts`；修改 `document.ts`、compiler、completion、runner、results、validation；新增 `packages/flow-core/test/verificationReports.test.ts`、`verificationTemplates.test.ts` 和 `packages/simulator-iverilog-wasm/test/verificationComponents.integration.test.ts`。新增前端 `simulation/verificationProperties.ts`。

**Prerequisites:** Task 1/7/8/9/10/11。本任务是验证组件的独立行为闭环；Task 11B 只负责将它们组装成环境。

**Interfaces:** 定义在 `verificationTemplates.ts` 和 `document.ts`，生成器只使用普通模块、数组、参数与 task/function，不新增 UVM 或 SystemVerilog class 依赖。

```ts
export type VerificationRole = 'sequence' | 'driver' | 'monitor'
  | 'reference-model' | 'scoreboard' | 'checker' | 'coverage' | 'control';
export interface TransactionField {
  name: string;
  width: number;
  signed: boolean;
}
export interface TransactionChannel {
  id: string;
  kind: 'handshake' | 'observation';
  clockNet: string;
  resetNet?: string;
  fields: TransactionField[];
  validPort: string;
  dataPort: string;
  readyPort?: string; // 仅主动 handshake 通道允许
}
export interface ReporterBinding {
  instanceId: string;
  role: VerificationRole;
  reportId: string;
  reportIdParameter: string;
  finalizePort: string;
  finalizedPort: string;
  minimumChecks?: number;
}
export interface TaskVerification {
  reporters: ReporterBinding[];
  controls: Array<{
    instanceId: string;
    clockNet: string;
    reportIds: string[];
    settleCycles: number;
  }>;
}
export interface VerificationTemplateRequest {
  module: string;
  role: VerificationRole;
  fields: TransactionField[];
  clockNet: string;
  parameters: Record<string, string>;
}
export interface VerificationDraft extends StimulusDraft {
  role: VerificationRole;
  channels: TransactionChannel[];
  readiness: 'needs-implementation' | 'ready';
  reporting?: {
    reportIdParameter: string;
    finalizePort: string;
    finalizedPort: string;
  };
}
export function createVerificationTemplate(
  request: VerificationTemplateRequest
): VerificationDraft;
```

`TaskVerification` 可选且只在用户添加需要报告的组件后出现。controls 的 instanceId 指向可编辑结算控制模块，reportIds 明确其负责的 reporter，clockNet 决定 settleCycles 的计量时钟；每个 reporter 只属于一个控制器。控制模块通过参数/端口记录完成条件、尾部观察周期及 idle 信号；finalize/finalized 绑定在文档中显式保存并在图中可展开。添加单个 checker 时自动提供最小结算控制组件，不要求用户手工搭完整验证框架。追加第二组环境时合并注册列表，不能覆盖第一组；任务等待所有控制组结算。

report ID 在同一任务内唯一，生成模块的同一源码多个实例通过参数分别赋 ID。普通 HDL 若没有报告绑定，则不参加 reporter 摘要计数；修改或删除已绑定参数/端口须产生诊断，不能悄悄退出检查体系。

```ts
export type VerificationEvent =
  | { kind: 'check'; reportId: string; sequence: number; time: string;
      passed: boolean; expected: string; actual: string; label: string }
  | { kind: 'summary'; reportId: string; sequence: number; time: string;
      checks: number; failures: number; observed: number; missing: number;
      extra: number; aborted: number; covered: number; totalBins: number }
  | { kind: 'error'; reportId: string; sequence: number; time: string;
      code: string };
export interface VerificationReportResult {
  events: VerificationEvent[];
  summaries: Extract<VerificationEvent, { kind: 'summary' }>[];
  diagnostics: TaskDiagnostic[];
}
export function parseVerificationReports(
  stdout: string, reporters: readonly ReporterBinding[]
): VerificationReportResult;
```

报告线格式 `VFST_EVENT|1|reportId|sequence|time|kind|...`：序号从 0 连续递增；ID/code/label 只用生成器允许的无分隔符标识，数据以二进制含 x/z 输出，时间为十进制字符串。check 后接 passed/expected/actual/label；summary 后接 checks/failures/observed/missing/extra/aborted/covered/totalBins；error 后接 code。字段数与类型严格校验。同一 reporter 的 helper 保证序号连续，多 reporter 交错无全局顺序要求。无需从普通日志中解析自由文本字段。

missing/extra 也各发一条 failed check，用 label 区分“缺失/多余”与普通位失配；缺少的一侧用对应宽度 x 占位，仅用于展示，不执行值比较。summary.failures 与 failed check 数一致，missing/extra 是失败子类统计。这样不会出现缺数据却因为比较次数为零而显示未验证的结果。

固定 case steps 的 `VFST_CHECK` 与组件 `VFST_EVENT` 分别验证：前者保持编译期数量检查，后者按每个注册 reporter 的最终摘要核对实际收到的 check 数和 failures 数，禁止把两者混成一个 `expectedChecks`。

- [ ] **红测：动态报告不能误判。** 新建 reporter 记录 fixtures：两次运行动态比较数不同都正确；缺 summary、重复 summary、不连续序号、未知 ID、损坏字段、摘要计数不符均有诊断。先运行 `node --test packages/flow-core/dist-test/test/verificationReports.test.js` 确认失败。
- [ ] 核心报告测试示例（编译测试文件后执行）：

```ts
const binding: ReporterBinding = {
  instanceId: 'sb', role: 'scoreboard', reportId: 'sb_1',
  reportIdParameter: 'VF_REPORT_ID', finalizePort: 'finalize',
  finalizedPort: 'finalized'
};
const stdout = [
  'VFST_EVENT|1|sb_1|0|10|check|1|0011|0011|transaction_0',
  'VFST_EVENT|1|sb_1|1|20|summary|1|0|1|0|0|0|0|0'
].join('\n');
const result = parseVerificationReports(stdout, [binding]);
assert.equal(result.diagnostics.length, 0);
assert.equal(result.summaries[0].checks, 1);
assert.notEqual(parseVerificationReports(
  stdout.split('\n')[0], [binding]
).diagnostics.length, 0);
```

- [ ] **Monitor**：同步握手在协议边沿读取采样前值，观测通道只输出 valid/data，无驱动 DUT 的 ready。测试 monitor 接入前后 DUT 输入/输出 trace 相同；锁存最后事务后下一调度阶段完整传递，不卡同周期多条隐含事件。
- [ ] **参考模型**：提供可编辑函数/状态机骨架，状态 `needs-implementation` 阻止执行；不给未知 DUT 生成 pass-through 期望。用户编写并标记 ready 后方可用于运行；标记不代表工具已验证算法。演示工程可提供明确、独立实现的简单变换模型。
- [ ] **Scoreboard**：生成两路独立 FIFO（各深度默认 256）、四态/mask 比较、缺失/多余结算、最少/准确交易数参数；不提供已实现的通用乱序模式。溢出报告 error，零比较未设目标则 unverified；设置 minimumChecks 后不足则 failed。
- [ ] **Checker/Coverage**：checker 提供等值、握手稳定和有限响应期限模板；coverage 只统计显式 bins，默认不影响通过。需要 coverage 达标时必须显式创建目标检查。报告与实例 ID 可追踪。
- [ ] **Reset**：各阶段同步清理未完成队列、增加 aborted，累计检查/失败保留；可选择 reset-abort 视为失败。测试 reset 不导致伪 EOF、不丢已记录失配，也不跨 epoch 配对。
- [ ] **Seed**：sequence/自定义激励的实例 seed 从任务 seed、case ID、实例 ID 的稳定哈希派生；不依赖数组顺序或其他实例的调用次数。重复运行一致，新增无关组件不改变既有激励流；每个用例独立初始化模型和队列。
- [ ] **结算**：driver done 停止新事务；控制组件继续保留时钟/monitor，按明确 idle 或指定尾部周期等待；截止后传播最后锁存事件，再依次 finalize model、scoreboard/reporters；所有 finalized 及摘要收到才由 runner 结束。每步有界，timeout/cancel 优先保留对应状态及已得检查详情。
- [ ] duration 到达作为停止条件而非立即 `$finish`；settleCycles 默认 8（1–1024）为验证链传播/结算预算，模板按链深检查不足时诊断。等待 DUT 尾部的 drain 周期由用户给定，不用 settleCycles 猜测 DUT 延迟。
- [ ] 在 `classifyTaskExecution` 中加入已核验的 reporter 结果：基础检查或组件检查失败→failed，无检查且仅观测→unverified；非法报告/不完整摘要→error；超时/取消不改为 error。错误、失败、超时详情均保留。
- [ ] **真实后端独立参考测试**：对 scoreboard 输入分别由测试 HDL 人工生成预期和实际，覆盖 expected 先到/actual 先到/同周期/多周期滞后、x/z、mask、缺失、多余、溢出、零次交易、复位中断和尾部截止。不能用被测模板生成器同时生成对照判定。
- [ ] 运行 core verificationReports/verificationTemplates 与 simulator verificationComponents integration，再跑已有固定 steps、parallel、协议结果分类回归。检查并提交 `feat(st): add editable verification components and final reports`。

## Task 11B: 可选完整验证环境模板

**Files:** 新增 core `verificationEnvironment.ts`；新增 `src/simulationTask/verificationCommands.ts`、前端 `simulation/verificationEnvironmentDialog.ts`；修改 componentPalette、document/edit 接口；新增 core `test/verificationEnvironment.test.ts`、VS Code `src/test/verificationEnvironment.test.ts` 和 simulator `test/verificationEnvironment.integration.test.ts`。

**Interfaces:** 环境模板只产出可审查草稿，提交时校验 revision，然后在一条 WorkspaceEdit 内添加；不在生成器里写磁盘或操作 VS Code。

```ts
export interface VerificationEnvironmentRequest {
  dutInstanceId: string;
  preset: 'direct-stimulus' | 'in-order-stream' | 'request-response';
  roles: VerificationRole[];
  clockNet: string;
  resetNet?: string;
  dutPorts: Record<string, string>; // 已由用户确认的角色到 DUT 端口映射
  fields: TransactionField[];
  expected: 'reference-model' | 'data-sequence' | 'unconfigured';
  drain: { kind: 'cycles'; cycles: number }
    | { kind: 'signal'; signal: string; timeoutCycles: number };
}
export interface VerificationEnvironmentDraft {
  assets: EmbeddedSource[];
  instances: ComponentInstance[];
  nets: TaskNet[];
  connections: Array<{ instanceId: string; port: string; net: string }>;
  verification?: TaskVerification;
  needsImplementation: string[];
}
export function createVerificationEnvironmentDraft(
  task: SimulationTaskDocument,
  request: VerificationEnvironmentRequest
): VerificationEnvironmentDraft;
```

direct-stimulus 预设无验证报告时不设置 draft.verification，不能偷偷生成 scoreboard/control。生成器为选择的 roles 验证依赖并显示缺少来源，不静默勾回用户取消的参考模型。该检查属于生成预览，不在正常新建 ST 时弹出向导。

- [ ] 写可选组件测试：空 ST assets/instances 都为空；仅激励 preset 不含 scoreboard；期望数据源可代替参考模型；无 expected 来源不能产生一个默认为实际值的模型。
- [ ] 实现模板向导：选 DUT → 选组件清单 → 确认时钟/复位/事务字段/协议映射/结束与 drain → 预览 → 插入；复用现有添加弹窗样式，不额外命名文件。
- [ ] 生成实际被 DUT 接受请求的 input monitor→model→expected 链，DUT→output monitor→actual 链。不能从 sequence 计划发送、但 DUT 尚未接受的事务直接生成期望。
- [ ] 接入 active handshake 与 passive observation 两种端口契约；跨时钟域连线阻止并给明确诊断。外部协议不使用统一 data 模板猜测，需要用户确认映射。
- [ ] 创建动作一次加入所有资产、实例、控制绑定和连线；取消不落盘、撤销整组撤回。默认复用既有时钟/driver 必须显式选择并校验，避免多驱动；独立新实例自动编号。
- [ ] 组合模板加入后可分别编辑源码/移除组件/重接，不形成黑盒环境。分组仅保存 presentation；所有源码默认内嵌，单模块或组内模块仍可另存外部文件。
- [ ] 修改接口源码后端口/事务/报告绑定诊断同步；生成模板元信息不覆盖用户编辑；需要实现的模型在画布和运行诊断显示来源，优先打开其原生文本编辑器。
- [ ] 保存范例 `examples/simulation-task/verification-stream.st`：已知简单变换 DUT + 独立参考模型，正常通过，故意更改 DUT 算法后 scoreboard 失败；再修改模型应影响下一次实际运行。新建面向任意 DUT 的骨架不得声称已验证。
- [ ] 测试单组件添加/删除、复用实例、两套环境同一 ST report ID 唯一、组撤销/保存冲突、切换用例参数、简单任务升级成完整环境，确保无第二种文件模型。
- [ ] 运行 core/VS Code environment 测试及真实仿真 integration。**用户评审点：** 展示轻量 ST 和完整验证 ST，分别修改 monitor/model/scoreboard HDL 后执行。检查并提交 `feat(st): compose optional verification environment templates`。

## Task 12: 用例、检查和结果融入共享编辑器

**Files:** 新增 `packages/schematic-webview/src/simulation/casesPanel.ts`、`resultsPanel.ts`、`taskControls.ts`；修改共享 index.html/index.css/index.ts、taskEditorProvider/taskTreeProvider。旧 `taskEditorHtml.ts` 完全无引用后删除；扩展 simulationTaskEditor/Phase3 测试。

**Interfaces:** 专用 ST 消息始终携带 revision 或 runId/caseId；run/cancel/artifact/compare 不直接写任务，case edits 通过版本化 WorkspaceEdit。当前 caseId 存 editor view state，不写成全局 active case。

- [ ] 写“运行当前/全部范围准确”“A 运行 B 打开不串结果”“切换 case 投影变化但布局不变”“旧结果输入变更标记”测试。
- [ ] 把现有 steps/expect/waitUntil/parallel/protocol、参数扫描预览、seed、检查、日志、失败重跑与比较移入可收起抽屉；保留已有能力和错误文案含义。
- [ ] 工具栏增加 ST 用例选择和运行控制；未选中对象时显示任务时间/结束策略，选中时切换实例属性。
- [ ] hdl 模式显示已有 TB 来源和运行结果，不伪造可编辑生成环境；保留可选“从现有 TB 创建 ST”。Task 4A 的独立传统执行入口始终存在，不能被该模式替代；不保留旧任务迁移。
- [ ] 结果中实际 backend 只读；正常未检查显示“完成，未验证”；生成 TB 仅在结果调试操作中只读打开。
- [ ] 接入 Task 11A 报告结果，按组件显示观察数、比较/失败/缺失/多余/aborted、coverage bins；点击失败定位画布实例/HDL，存在波形位置映射时跳对应时间。monitor 计数和 coverage 命中不能计为检查通过。
- [ ] 保持键盘可达、主题变量、高对比度、窄窗口属性区折叠；沿用 AD 图标/尺寸/按钮状态。
- [ ] 运行 editor/Phase3/controller 定向测试和 webview 类型检查；人工深浅色主题及窄窗口验收。
- [ ] 检查并提交 `feat(st): integrate cases and results into the graph workspace`。

## Task 13: 全链路验收、清理与文档

**Files:** 修改 `docs/simulation-tasks.md`、`README.md`、`veriflow-vscode/README.md`、`README_zh-CN.md`、`packages/cli/README.md`；增加 `examples/simulation-task/embedded-stimulus.st`、`external-stimulus.st` 与 `verification-stream.st`；按需要更新 `tests/cli_contract/cases.json`、资产测试和 generated web-dist。

- [ ] 对照 spec 的 22 条验收场景记录实际结果；每条必须对应自动测试或明确手工操作记录。
- [ ] joint/hybrid/manual 及协议示例直接修订到首版目标格式，新增 embedded/外部/AD 输入和完整验证环境示例。不新增旧格式升级、历史读入或设置迁移测试。
- [ ] 检查未注册的旧 views/menus、旧 top 回退、新 ST 中 backend 字段、旧 taskCanvasClient 引用；确认实际执行路径也移除，不能只搜索 UI 文案。
- [ ] 更新用户文档：一次命名、三栏职责、右键/已验证原生拖放路径、内嵌编辑、另存副本/切引用、轻量与完整验证模板、monitor/scoreboard/参考模型责任、结束与结算、只在设置选择工具、CLI --project；单列“直接运行传统 Testbench”，说明无需 `.st` 且保留 HDL 自己的结束/波形行为。
- [ ] 文档增加原生 TB 模板操作：VeriFlow 子菜单、可搜索选择器、直达命令、模块级/过程级插入、完整骨架生成；移除旧独立生成页截图和入口说明。
- [ ] 从源码生成 web-dist，运行以下检查；先前任务已经运行过且源码未再变的定向检查不重复。

```powershell
npm run build:web
npm run typecheck:shared
npm run typecheck --workspace @veriflow/schematic-webview
npm run test:shared
npm run test:cli
npm test --workspace veriflow-vscode
npm run verify:generated
git diff --check
```

- [ ] 测试调用仓库既有脚本可能内部构建或检查测试包；本轮不执行 release、pack:node、vsce package 或 publish，不替换已有试用 VSIX。
- [ ] 报告通过项、失败项及原因；需要自定义外部工具的集成验证仅在工具已配置时实测，未配时报告“未实测”，不得使用 mock 冒充真实工具成功。
- [ ] 保存实际 AD/ST 并排截图、自定义激励编辑截图和执行结果记录供用户审阅；不要声称仅单元测试即完成视觉验收。
- [ ] 检查并提交 `docs(workbench): document unified design and simulation flows`。

## 依赖和交付检查点

```text
Task 1 ─┬─ Task 2（宿主设置）
        ├─ Task 3 → Task 4（统一新建与侧栏）
        └─ Task 7 → Task 8（组件与完成语义）
Task 2 + 4 → Task 4A（独立传统 TB 与共用运行槽）
Task 2 + 4 + 4A → Task 4B（原生 TB 模板与紧凑菜单）
Task 5 → Task 6（共享画布，视觉检查点）
Task 1 + 2 + 7 + 8 → Task 9（共同输入准备）
Task 4B + 6 + 9 → Task 10 → Task 11（激励闭环检查点）
Task 8 + 9 + 10 + 11 → Task 11A（验证组件与报告）
Task 11A → Task 11B（可选完整环境检查点）
Task 4A + 6 + 8 + 11B → Task 12 → Task 13
```

表中描述逻辑依赖，默认仍逐项执行，不意味着自动并行派发。任务 4 的 ST 插入先依赖首版目标文档编辑，之后由 Task 6 画布接管显示；中间提交保持类型检查和定向测试通过。

## 计划自审映射

| 设计要求 | 实施任务 |
|---|---|
| 三侧栏、移除全局 top、明确操作目标 | 3、4 |
| 独立传统 TB、无需 ST、保留 HDL 行为 | 4A、12、13 |
| 传统 TB/图形 ST 运行互斥及结果归属 | 4A |
| 保留 TB 生成、移除独立页面、编辑器局部模板 | 4B |
| 单一右键子菜单、搜索模板与常用命令 | 4B |
| 光标处原样插入/撤销/时间单位/内嵌上下文（用户后续确认不检测语法位置） | 4B、10、13 |
| 右键添加与原生拖放逐路径验证/降级 | 4、6、13 |
| 一次命名、保留 AD module 语义 | 3 |
| AD 依赖树 / RTL 预览 | 4 |
| 完整复用 AD 画布、ST 不导出 RTL | 5、6、12 |
| 时钟复位逻辑块、真实连线与校验 | 7、8 |
| 模板/自定义端口 → HDL 编辑 → 保存上图 | 10、11 |
| 可选 monitor/model/scoreboard/checker/coverage | 11A、12 |
| 完整环境一次生成、普通组件独立编辑 | 11B |
| 动态检查报告、尾部响应、结算和零比较语义 | 8、11A、11B |
| 内嵌默认、外部引用、端口变化/保存冲突 | 1、9、10 |
| 执行设置只有 builtin/custom | 2 |
| ST 运行、结束条件、检查/波形/结果 | 8、9、12 |
| 开发期格式直接整理、协议/CLI 功能保留 | 1、2、9、11、13 |
| 保留已有 AD 修复及当前 ST 成果 | 0、5、13 |

本计划已获用户批准并已实施下列工作；上面的历史任务拆分与未勾选框保留作为验收清单，不代表尚未开始，也不代表所有条目已经完成。实际文件合并方式以下方实施记录为准。


## 2026-09-15 实施记录（按实际落盘，不替代验收）

用户已批准核心设计并授权实施。后续确认优先于早期 Task 4B 的位置规划要求：菜单为“插入 HDL 模板”，局部模板只插入当前光标，不做语法位置识别、校验或自动挪动。当前工作区保留原有大量未提交修改；本轮没有创建提交、没有发布、没有运行旧 ST 迁移。历史任务中的逐任务 commit 勾选不作已完成处理。

### 核心需求与实现位置

| 已落盘范围 | 实际文件/接缝 | 已有证据与边界 |
|---|---|---|
| 首版 ST 文档、source reference、内嵌 assets、completion、显式 verification；删除顶层 name 和宿主工具字段 | `packages/flow-core/src/simulationTask/model.ts`、validation、schema、5 个 `.st` 示例 | 示例全部通过实际 parse 和 JSON Schema 校验；未增加新旧版本兼容层 |
| 三侧栏、文件模块操作、AD 树、统一新建与工具配置 | `veriflow-vscode/src/workbench/fileBrowserProvider.ts`、`archDesign/archDesignTreeProvider.ts`、extension/package 配置 | 已落盘；真实 Extension Host 与最低支持 VS Code 的操作验收仍另记，不能仅凭贡献点宣称通过 |
| AD/ST 共用 Webview 和图形投影；用例、结果接入 | `simulationTask/taskEditorProvider.ts`、`taskProjection.ts`、`taskAuthoring.ts`、`schematic-webview` 公共资产 | projection 测试覆盖缺失源节点保留、未知位宽、用例参数覆盖、失效连接保留；无独立第二套 ST SVG 交互 |
| 独立传统 TB 与原生 HDL 模板 | `workbench/traditionalTestbenchController.ts`、`packages/flow-core/src/hdlTemplates.ts`、`core/testbenchGenerator.ts`、extension 命令 | 有 traditionalTestbenchController、testbenchTemplateCommands、testbenchGeneratorNative 定向测试文件；桌面焦点/撤销实测不能由测试文件存在代替 |
| CLI/VS Code 共享当前输入准备，AD/内嵌 HDL 临时展开 | `packages/hdl-runtime/src/simulationTaskWorkspace.ts`、双方 controller/CLI 接缝 | 实际合并在 simulationTaskWorkspace，不是计划中的 simulationTaskInputs.ts；项目工具设置由宿主注入 |
| 原生内嵌 Save、冲突与源码拥有关系 | `simulationTask/embeddedSourceProvider.ts`、`taskAuthoring.ts` | focused test 已运行通过：dirty buffer 的 stat/read 不改冲突基线、旧连接保留、新端口不自动连线、非法源码可保存、readiness 保留、父保存失败可重试；增加 async callback 后的文档版本检查 |
| 时钟/复位/自定义模块、sequence/driver/monitor/model/scoreboard/checker/coverage/control | `packages/flow-core/src/simulationTask/componentTemplates.ts` | 合并计划 stimulusTemplates/verificationTemplates；普通 Verilog-2005，8 种 verification role 在真实 WASM 编译通过；checker 有 equal/stable/deadline |
| 现有协议算法的可编辑 module 包装 | 同文件 `createProtocolStimulus`，复用 `compileProtocolStep` | 所有现有协议角色的生成模块通过真实 Verilog-2005 编译；UART receiver 对独立手写串行源的成功及超时测试已通过；未把“所有角色编译”表述为“所有角色独立端到端执行” |
| 连续 VFST_EVENT、严格最终摘要、FIFO 与结算 | `verificationResults.ts`、componentTemplates、compiler/runner/results 接缝 | 7 个 core verification 测试已通过；真实 WASM 验证 expected/actual 先后/同时、mask、x/z 区别、缺失/多余、零交易、reset aborted、overflow、checker 规则 |
| 完整可选环境、无虚假参考模型、显式 Mark ready、普通资产可编辑 | `verificationEnvironment.ts`、taskAuthoring | 完整组装真实 WASM 测试通过：独立 +3 DUT/模型，16 笔实际接受请求和尾部结算；默认模型/未配置 expected 阻止运行；不是通用算法推断 |
| 首版示例与使用文档 | schema、`examples/simulation-task/*.st`、`docs/simulation-tasks.md`、README 相应段落 | joint/hybrid 真实集成测试通过；协议示例保留当前允许的自动时钟表示以保持原行为，不冒充全部改成图形时钟组件 |

以上测试结果是已执行的定向证据，不等同于整仓全量测试、所有 host 操作或最低 VS Code 验收通过。并行实施期间父代理正在完成 Extension Host 集成与更广回归；最终结果应另附实际命令、返回值和截图。

### 最终实施记录与验证范围

- 文件身份、三栏导航、共享 AD/ST 画布、组件 HDL 编辑、独立传统 TB、光标处 HDL 模板已接通。局部模板不做语法位置判断；上下文菜单保持四项，模板用 Quick Pick 展开。
- ST 工具栏精简为运行、用例、结果、任务设置、添加组件和验证环境；取消仅运行时出现，编辑 HDL 仅选中实例时出现。JSON 入口移入任务设置。
- 随机/文件 sequence 已实现。VF_INSTANCE_SEED 由任务/用例 seed 与实例身份稳定派生，仅对标记为 sequence 且声明专用参数的组件提供默认值；显式用户覆盖保留。反压时数据稳定，缺失/短/格式错误数据报告 error。
- 新增 examples/simulation-tasks/verification-stream.st 与独立 DUT。真实运行基线通过、修改 DUT 后失败、修改独立参考模型后下一次运行通过。
- 内嵌源码跟随父 ST/目录重命名。父 ST 删除时保留 dirty 源及后续输入，普通 Save 提示另存 .v/.sv，read/stat 仍可用，禁止旧缓冲区复活已删父文件。
- 带实际子模块及 portable definition key 的 AD 通过临时展开和 Icarus 仿真；准备/预览/依赖树统一 definition catalog，并注入宿主自定义协议目录及工作区根。
- 新增显式事务通道的位宽、时钟、复位与直接跨域检查，仅在编译前运行，保存期间允许中间断线。未声明通道的任意用户 HDL 不作自动 CDC 推断。
- ST 结果命令绑定原任务 URI；切换任务不改变旧链接的归属。运行被拒或编辑无效时恢复可编辑状态。用例切换更新图形参数投影。

已执行验证：完整 VS Code 本地构建、共享前端类型检查、55 个当前扩展普通测试文件、86 项 ST/core/共享输入/CLI/真实 WASM 测试。真实隔离 VS Code Host 验证语言注册、模板精确光标插入和单次撤销、ST 打开与内置仿真实际完成；浏览器检查真实 DUT+clock 连线及深色/浅色/窄屏布局。未执行发布、发行打包或版本变更。

验证边界：

- 最低支持 VS Code 上的原生树拖放、原生 Save As 对话框尚未手测；保留右键添加。只接通 TreeView→TreeView，未启用未经验证的树→Webview 拖放。
- 所有协议组件经过真实编译；UART 接收器及验证组件有独立源的执行测试。未将这些证据扩称为每种协议包装均完成独立参考端到端验收。
- 自定义任意链深的结算预算需用户配置，程序执行有界超时；不声称能从任意 Verilog 自动证明结算周期充分。
- 整仓较广回归有先前已记录的 Windows 路径/命令退出码兼容测试失败；本节通过数只针对上列范围。未将既有失败当作本轮新功能回归，也未宣称整仓全绿。
- 所有改动保留在当前脏工作区，没有提交、推送、发布或旧 ST 迁移。旧计划中的逐任务提交与拟定文件拆分由实际责任映射替代，未批量勾选不适用步骤。
