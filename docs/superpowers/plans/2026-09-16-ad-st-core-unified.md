# AD/ST 基础功能与统一交互实施计划

状态：用户已于 2026-09-17 批准实施。以下最新修订优先于正文中 2026-09-16 的原始描述：

- Architecture Design 与 Simulation Task 均使用当前 AD 的 circuit-board 图标，按文件展开依赖树和实际导出文件；未生成的输出必须明确标记。
- 模块右键合并为“添加到画布”，只允许添加到当前活动标签页的 AD/ST 自定义编辑器。其他编辑器活动时禁用；命令执行再次检查，不记忆旧目标、不弹目标选择器。
- Module Browser 只有模块名和来源路径行，标题只有刷新/新建图标；移除扩展过滤弹窗、目录/文件层级和跨视图 DnD。
- AD/ST 标题均只有相同加号，空状态创建按钮样式一致。其余范围仍按精简 ST、共享 AD 交互和单 TB 生成/运行执行。


> **For agentic workers:** 本计划已获批准，按任务逐项实施；使用上方最新修订和当前用户指示。步骤用复选框记录实际完成情况。不要执行 2026-09-15 的旧功能计划。

**Goal:** 恢复纯模块浏览，使 ST 以 AD 的同一套操作承载基础 Testbench 生成、仿真与波形。

**Architecture:** AD/ST 共用前端操作组件和文档编辑协议；ST 独立精简文档保存普通模块、预设与连线。一个纯生成器同时提供 `.v` 导出和临时仿真输入，复用通用运行与波形服务。

**Tech Stack:** TypeScript、VS Code TreeView/CustomTextEditor/WorkspaceEdit、现有 X6 schematic-webview、flow-core/hdl-runtime、Verilog-2005、Icarus WASM。

**Spec:** [统一交互设计](../specs/2026-09-16-ad-st-core-unified-design.md)。以此设计为验收依据，尤其是 §3–7 的交互和删减范围。

## 全局约束

- 已批准实施；不自动改版本、提交或发布。打包遵循当前会话的用户授权。
- 保留当前大量未提交代码与已有 AD 修复，不 reset、不从裸 HEAD 恢复整个文件。
- 新 ST 首版直接修订，无迁移；明确拒绝旧试用字段，不能静默丢弃。
- Module Browser / Architecture Design / Simulation Task 固定名称，不带括号缩写。
- 标题操作仅图标；AD/ST 标题仅同一个 add 图标。两栏共用欢迎按钮和创建流程。
- 不增加侧栏 Webview，不实现顶部输入过滤，不注册跨侧栏/编辑区拖放。
- 公共操作只允许同一个前端流程；ST 专用差异是预设、根属性、生成 TB、运行、查看波形。
- ST 没有源码编辑器、用例、验证环境、抽屉或新仿真器类型。内部/自定义工具仍来自设置。
- 生成和运行使用相同源码生成函数；预设只通过右侧属性配置。
- Node >=24.14.1；依赖新增默认不需要。删除被策略阻止时移到根 `.trash` 同相对路径并保持忽略，不清空 `.trash`。

## 文件责任与接口

| 责任 | 文件 |
|---|---|
| 纯模块列表 | 新增 `veriflow-vscode/src/workbench/moduleBrowserProvider.ts`，替换 `fileBrowserProvider.ts` |
| AD/ST 相同文件列表、新建 | 保留 `archDesign/archDesignTreeProvider.ts`；新增 `workbench/documentCreation.ts`、`simulationTask/taskTreeProvider.ts`；extension 接线 |
| 目标选择与添加 | 保留收敛后的 `workbench/moduleTargets.ts`；删除 `moduleDragAndDrop.ts` 和注册 |
| 公共工具栏/添加对话框 | 现有 `packages/schematic-webview/src/index.{ts,html,css}`；新增 `authoring/toolbar.ts`、`authoring/instanceDialog.ts`，只提取有共用需求的逻辑 |
| 预设与属性投影 | 新增 `packages/hdl-runtime/src/simulationTask/presets.ts`、`veriflow-vscode/src/simulationTask/taskInspector.ts`；修改 `taskProjection.ts` |
| 文档和生成 | 新增 `packages/hdl-runtime/src/simulationTask/model.ts`、`validation.ts`、`testbench.ts`；替换旧 flow-core case 编译 API |
| 输入与执行 | 精简 `packages/hdl-runtime/src/simulationTaskWorkspace.ts`、`simulationTask/taskController.ts`、CLI `commands/task.ts`；共用现有 simulator/wave 服务 |
| 编辑宿主 | 收敛 `taskEditorProvider.ts`、`taskAuthoring.ts` 与 `schematic/protocol.ts` |
| 彻底清理 | 删除 ST 独占高级源码、抽屉、虚拟源编辑、协议/验证实现与配套失效测试；按实际引用保留通用部分 |

核心接口（计划目标，不是已落盘 API）：

```ts
import type { ArchDesign } from '@veriflow/schematic-core/arch-design';
type TimeScale = '1s' | '10s' | '100s' | '1ms' | '10ms' | '100ms'
               | '1us' | '10us' | '100us' | '1ns' | '10ns' | '100ns'
               | '1ps' | '10ps' | '100ps' | '1fs' | '10fs' | '100fs';
type StSource = { kind: 'hdl'; path: string; module: string }
              | { kind: 'ad'; path: string };
type SimulationPreset =
  | { kind: 'clock'; frequencyMHz: number; initial: 0 | 1 }
  | { kind: 'reset'; active: 0 | 1; duration: number }
  | { kind: 'stimulus'; width: number; initial: string;
      transitions: { at: number; value: string }[] };
type StInstance =
  | { id: string; source: StSource; parameters: Record<string, string> }
  | { id: string; preset: SimulationPreset };
interface SimulationTaskDocument {
  format: 'veriflow-simulation-task'; schemaVersion: 1;
  settings: {
    timeUnit: TimeScale; timePrecision: TimeScale; duration: number;
    waveform: { enabled: boolean; filename: string };
  };
  instances: StInstance[];
  connections: ArchDesign['connections']; // 仅实例/logic端点，拒绝外部port端点
  logic: ArchDesign['logic'];
  interfaceConnections: ArchDesign['interfaceConnections'];
  interfaceOverrides: ArchDesign['interfaceOverrides'];
  presentation: ArchDesign['presentation'];
}
interface GeneratedTestbench {
  moduleName: string;
  text: string; // 顶层、预设辅助模块、已展开AD包装；不含临时绝对路径
  diagnostics: TaskDiagnostic[];
}
// definitions 沿用当前 TaskModuleDefinition 的模块、端口、参数结构。
// 准备AD来源时可带generatedText，生成器将AD包装放进同一输出文件。
interface TestbenchModuleDefinition extends TaskModuleDefinition {
  generatedText?: string;
}
generateTestbench(task: SimulationTaskDocument, moduleName: string,
                  definitions: readonly TestbenchModuleDefinition[]): GeneratedTestbench;
describePreset(preset: SimulationPreset): TaskModuleDefinition;
```

已核实 `packages/schematic-core/src/archDesign/model.ts` 的字段为 `logic`，直接使用该类型，不重新发明网络端点。精简 ST 模型、预设和纯生成器统一放在 `hdl-runtime/src/simulationTask/`，该包已依赖 flow-core 和 schematic-core，不新增反向包依赖。前端仅消费宿主投影与类型，不把 hdl-runtime 的 Node 文件系统代码引入浏览器包。TaskModuleDefinition、TaskDiagnostic 的精简定义一并移到该目录的 model.ts，并从 hdl-runtime 的 simulationTask 子路径公开。接口连线沿用 AD 已有的成组端口连接能力，预备阶段展开为显式端口，不恢复协议事务激励。精度不得粗于单位，所有绝对时间按 precision 的整数 tick 校验；内部仿真器不能支持的范围必须在生成/运行前报错而非近似。运行超时属于宿主设置，不再次落入 ST。

## Task 1：锁定精简文档及删除清单

**Files:** 新增 `packages/hdl-runtime/src/simulationTask/model.ts`、`validation.ts`、`index.ts`，增加 package.json 子路径导出；扩展 `schemas/simulation-task.schema.json`；新增 `packages/hdl-runtime/test/simulationTaskDocument.test.ts`。

- [ ] 记录工作树起点、已跟踪/未跟踪文件与原始 diff；读取新 spec，并把旧计划标注为被替代。
- [ ] 使用已核实的 `ArchDesign['connections'|'logic'|'interfaceConnections'|'interfaceOverrides'|'presentation']` 定义精简图模型，拒绝连接到外部 port；保留接口端口成组连线但没有外部接口端口声明。
- [ ] 写行为测试并确认旧实现失败：空任务序列化、3 种预设、相对 HDL/AD 引用、严格拒绝旧 cases/assets/verification/backend 字段。

```ts
const task = createSimulationTask();
assert.equal(task.format, 'veriflow-simulation-task');
assert.deepEqual(task.instances, []);
assert.equal(task.settings.duration, 1000000);
assert.throws(() => parseSimulationTask(JSON.stringify({ ...task, cases: [] })));
assert.throws(() => parseSimulationTask(JSON.stringify({ ...task, assets: [] })));
```

- [ ] 实现结构校验及 preset 值校验；编辑中允许未连线，生成前另做连通/驱动检查。schema 与解析器使用同样的未知字段政策。
- [ ] 用 `rg` 列出高级功能文件和所有调用方，清理表标明“ST 独占删除 / 通用保留 / 核心重写”，避免仅隐藏按钮。
- [ ] 运行 `npm exec -- tsc -p packages/hdl-runtime/tsconfig.test.json` 与定向 document 测试；阶段记录实际通过项，不要求删除功能的旧测试继续通过。

## Task 2：先统一侧栏与新建

**Files:** `moduleBrowserProvider.ts`、`taskTreeProvider.ts`、`documentCreation.ts`、`moduleTargets.ts`、AD creation/tree、extension、package.json；新增 `moduleBrowserProvider.test.ts`、`workbenchConsistency.test.ts`。

- [ ] 测试三视图名称、标题 command icon、AD/ST 唯一 add 动作、同构 viewsWelcome；模块 provider 对“同一文件两模块”和“同名不同路径”生成准确模块行。

```ts
assert.deepEqual(moduleItems.map(item => item.label), ['a', 'b']);
assert.ok(moduleItems.every(item => item.contextValue === 'hdlModule'));
assert.equal(adCreate.icon, '$(add)');
assert.equal(stCreate.icon, '$(add)');
assert.deepEqual(stTitleActions.map(item => item.command), ['veriflow.newSimulationTask']);
```

- [ ] 用纯定义索引生成模块列表，路径作为 description，不枚举空 HDL 文件或制造目录层。
- [ ] 删除 filter command/state、标题文字按钮、ST 功能树项及 DnD controller 接线；AD refresh 退出标题，文件 watcher 自动刷新。
- [ ] AD/ST 共用目标路径/后缀/覆盖保护流程；同样取消行为、同样打开自定义编辑器。新建 HDL 文件保留标题加号，保存解析前不造假模块。
- [ ] 保留右键添加并共享目标选择策略。外部选中文件需要先解析为模块再加入，不能以文件作为节点。
- [ ] 运行 `npm run compile:ts --workspace veriflow` 和本任务两个测试；真实宿主检查三栏空/非空状态。先提交界面证据，不用“manifest 断言通过”代替实测。

## Task 3：消除 AD/ST 公共交互分叉

**Files:** schematic-webview `index.ts/index.html/index.css`、`authoring/toolbar.ts`、`authoring/instanceDialog.ts`；`schematic/protocol.ts`、`taskEditorProvider.ts`、`taskAuthoring.ts`；既有 schematic protocol/editor tests。

- [ ] 为相同 Add instance 动作编写宿主/浏览器契约：AD 和 ST 都打开 `#add-instance-dialog`；键盘 A 和按钮同路由；输入过滤、自动实例名与取消行为一致。
- [ ] 删除 ST 对 `showAddInstanceDialog` 的 QuickPick 分支；抽取共用候选和提交逻辑。ST 将返回的来源 key 解析为 HDL/AD 引用，保持 source identity。
- [ ] 将 ST 导出/运行/波形能力注入现有工具栏；所有按钮复用 `icon-button`、图标槽和禁用规则。删除 `simulationTaskDrawer.ts` 引入与第二行 CSS/布局行。

```ts
// 同一动作描述，宿主按文档类型解释来源；不在Webview选择两种dialog。
post({ type: 'addModuleInstance', revision, definitionKey, instanceName });
// ST专属动作范围仅保留：
type StAction = 'addPreset' | 'updatePreset' | 'updateTaskSettings'
              | 'generateTestbench' | 'run' | 'cancel' | 'openWave';
```

- [ ] 公共 rename/parameter/connect/disconnect/delete/layout 动作继续使用 AD 编辑队列、revision 检查与撤销；ST 不另设一组本地状态变更。
- [ ] 运行前端 typecheck 和 schematicProtocol / taskEditor 定向测试；在真实 AD/ST 对照窗口验证共用对话框和按钮。保持 AD 既有逻辑工具/接口连线不回归。

## Task 4：预设节点与右侧配置

**Files:** `packages/hdl-runtime/src/simulationTask/presets.ts`、`taskInspector.ts`、`taskProjection.ts`、`taskAuthoring.ts`、前端 preset 对话框与既有 inspector renderer；新增 `simulationPresets.test.ts`、更新 projection/authoring tests。

- [ ] 测试 Clock/Reset/Stimulus 的端口定义与表单默认值；修改时不产生源码资产，不调用 `openTextDocument` 来编辑预设。

```ts
assert.deepEqual(describePreset({ kind: 'clock', frequencyMHz: 100, initial: 0 }).ports,
  [{ name: 'clk', direction: 'output', width: 1 }]);
assert.equal(describePreset({ kind: 'stimulus', width: 8, initial: "8'h00", transitions: [] }).ports[0].width, 8);
```

- [ ] 添加 Simulation Utility 画布内对话框，复用 Logic Utility 的结构和样式，只选类型、实例名；添加后选中节点并展示右栏。
- [ ] 用同一 inspector 字段渲染器增加类型化字段/时间值表，不复制 ST Settings 表单。失焦/回车提交和取消采用 AD 的既有规则。
- [ ] 空白选择展示根任务属性。TB 名按文件名派生并只读；更新宽度导致旧连线冲突时保留可见错误，不静默删边。
- [ ] 不自动连接 clock/reset；所有关联由画布建立。节点删除和撤销恢复配置及连线；保存重开恢复同样节点与布局。
- [ ] 运行 preset/projection/authoring 测试；真机验证添加三个节点没有顶部弹窗或文本编辑器，右栏字段与撤销有效。

## Task 5：单一 Testbench 生成器

**Files:** hdl-runtime `simulationTask/testbench.ts`、`presets.ts`、`validation.ts` 与 `simulationTaskWorkspace.ts`；扩展 `core/testbenchGenerator.ts` 调用关系；新增 `packages/hdl-runtime/test/simulationTestbench.test.ts` 及 WASM 集成测试。

- [ ] 以 1.4.5 的能力清单写行为测试：2 个不同频率时钟、两种复位、8 bit 时间序列、2 个 DUT/参数覆盖、显式连线、timeUnit/precision、波形、结束时间。
- [ ] 生成测试先失败再实现：100 MHz 在 `1ns` 单位半周期为 5，在 `1ps` 单位为 5000；不能继续硬编码 ns。时间不可表示、重复激励时刻、未驱动输入与多驱动都有具体节点诊断。
- [ ] 预设辅助模块和 AD 包装随 TB 写入同一 `.v`；内部模块名冲突检查，sources 保留 DUT 依赖，指定正确 top。inout 使用单独三态驱动和 z 释放，不能生成 reg 多驱动。
- [ ] 共用安全参数表达式解析与来源 key catalog；没有未知位宽回退、任意 JS eval 或跨目录临时绝对路径写进导出源码。
- [ ] 用真实 Icarus 编译/执行输出 TB，核对 5/10/100 等边沿时刻、序列值、VCD、参数例化及结束时刻。不能只用字符串快照断言生成器正确。
- [ ] 删除完整旧 TB 表单生成路径；HDL snippets 不依赖这个清理，继续保留光标插入行为。

## Task 6：生成/运行/波形接入

**Files:** `taskController.ts`、`taskEditorProvider.ts`、`core/simulationService.ts` 接缝、运行 coordinator、CLI task/main；新增或更新 controller/runtime/CLI tests。

- [ ] 测试导出和运行都调用 `generateTestbench`，编译输入中生成源码一致；运行不覆盖项目里已导出 `.v`。
- [ ] 输出文件使用保存对话框，原文件覆盖遵循 VS Code 原生确认；明确取消则不写入。打开生成文件，后续运行仍以 `.st` 为来源。
- [ ] 单次运行绑定 URI，仿真器配置在开始时快照；运行中 play→stop，取消显式指向本次运行。保留通用并发互斥，但没有 case scheduler。
- [ ] 复用既有 OutputChannel、诊断和 waveform opener；最新波形记录只在内存，源变化使其过期；完成表示进程完成而不是验证通过。
- [ ] 编辑器传统 TB 运行保留，移除 Simulation Task 栏内对应控制器/树项；既有 generate TB 命令导向 ST。
- [ ] CLI `task validate/run` 对同一精简文档执行一次，去除高级参数，保留 project 设置来源；不误改 `sim`、`wave`、`ad` 命令。
- [ ] 定向 controller/runtime/CLI 测试后，真实 Extension Host 从 ST 运行并查看波形，再导出同一 TB 单独编译对照。

## Task 7：删除废弃实现和更新示例

**Files:** core `simulationTask/`、shared drawer、扩展虚拟源/旧 taskCanvasClient/taskEditorHtml、CLI options、schema、docs、examples、相关 tests。

- [ ] 按 Task 1 清理表删除 ST 专用 cases/scenarios/scheduler/cache/results/verification/protocols/componentTemplates 与虚拟源码编辑；通用 backend cache 等有其他消费者的部分不盲删。
- [ ] 删除已下线命令、消息种类、设置项、上下文菜单和未使用打包资产，避免隐藏功能从命令面板/JSON 重新出现。
- [ ] 清理旧首版示例，提供一个易懂的 `examples/simulation-task/basic.st`、一个参数化 DUT；没有虚拟文件、准备状态、参考模型或嵌入源。
- [ ] 文档只描述 Module Browser、AD/ST 共同行为、3 种预设、生成和运行；旧设计/计划标为历史，不继续列为可用产品能力。
- [ ] 用 `rg` 检查退休入口引用，以“导入者为零/不再出现在构建输入”为清理证据。替换过时测试，不用降低断言来保留失效产品逻辑。

## Task 8：以一致性为发布前验收门槛

- [ ] 构建：`npm run vscode:prepublish --workspace veriflow`；前端 `npm run typecheck --workspace @veriflow/schematic-webview`。
- [ ] 执行更新后的 flow-core、hdl-runtime、CLI task 与扩展测试；真实 WASM 的 TB 生成/运行对照通过。记录既有平台失败，不把整仓未绿写成全绿。
- [ ] 真机截图：三栏空/非空、AD/ST 同一个添加模块对话框、Clock/Reset/Stimulus 选中属性、同一条工具栏、波形。深浅主题和窄窗口各检查一次。
- [ ] 按 spec §9 逐项检查：禁止用新的文本按钮/QuickPick 差异/抽屉完成公共动作。确认没有跨编辑区 DnD 注册，画布内部拖动与连线仍工作。
- [ ] `git diff --check`；只在用户授权打包时生成试用 VSIX，检查 schema/前端/worker/仿真器资产存在。保留原有未提交修改，不自动发布、推送或替用户做认证发布。

## 执行顺序与审查节点

`Task 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8`。每项以定向测试和差异审查结束，不为提交粒度把当前脏工作区整体 stage。先完成侧栏和共同操作的可见对照，再扩展三个预设；不先恢复高级后端，再给它安排 UI。

交付内容是确认后的精简产品，不是原 ST 高级功能重命名。开发开始前由用户确认本设计与计划；无需再次询问采用哪种执行模式。
