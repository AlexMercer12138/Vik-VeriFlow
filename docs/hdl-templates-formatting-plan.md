# HDL Templates and Five-column Formatting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** 完成开发计划 1.5.x 第 2、3 项：可配置 HDL 模板，以及可配置五列的显式 HDL 格式化。

**Architecture:** 模板配置在 VS Code 文档作用域读取，纯函数解析后交给现有插入命令。格式化保留 Tree-sitter 原始 token 和指纹校验，在打印阶段按 CST 语义标记对齐位置；VS Code 负责读取设置，运行时不依赖编辑器 API。

**Tech Stack:** TypeScript、VS Code API、现有 Tree-sitter SystemVerilog parser、Node 测试工具。

**Spec:** [HDL 模板与五列格式化方案](hdl-templates-formatting-design.md)。状态：2026-09-21 已完成实现与自动化回归，含补充的 parameter/localparam 对齐。

## Global Constraints

- 保留命令 ID；不修改 CLI 命令，不增加外部格式化器依赖，不自动格式化 AD/ST 导出，不改变仿真生成链路。
- 模板只解释现有 `{{数字:默认值}}` / `{{数字}}`；其余文本按字面插入。
- 固定列默认 `[4, 12, 20, 44, 56]`，从 0 计数；第一项控制每级缩进。
- 格式化仅改空白，保留语法树指纹验证、取消和文档版本保护。
- 不执行发布。保持工作区已有用户改动；按文件检查差异，避免把此前 AD/ST 工作混入本功能提交。

## Task 1: 模板配置解析

**Files:**
- Create: `veriflow-vscode/src/testbench/templateConfiguration.ts`
- Create: `veriflow-vscode/src/test/templateConfiguration.test.ts`
- Modify: `veriflow-vscode/package.json`
- Read: `packages/flow-core/src/hdlTemplates.ts`（保留现有内置内容和核心 API）

**Interfaces:**

```ts
export interface ResolvedHdlTemplate {
  id: string;
  label: string;
  description: string;
  body: string;
  languages: readonly ('verilog' | 'systemverilog')[];
}
export interface TemplateConfigurationResult {
  templates: readonly ResolvedHdlTemplate[];
  issues: readonly { path: string; message: string }[];
}
export function resolveHdlTemplates(value: unknown): TemplateConfigurationResult;
```

- [x] 添加测试：默认项、覆盖 clock、新增项排序、禁用优先、非法项隔离、正文数组、空正文、语言过滤数据、非法 ID/字段。测试先运行并确认缺少解析器而失败。

```ts
const result = resolveHdlTemplates({
  clock: { body: ['always #5 clk = ~clk;'] },
  timeout: { enabled: false },
  custom: { body: '$finish;' },
});
assert.equal(result.templates.find(t => t.id === 'clock')?.body, 'always #5 clk = ~clk;');
assert.equal(result.templates.some(t => t.id === 'timeout'), false);
assert.equal(result.templates.find(t => t.id === 'custom')?.body, '$finish;');
```

- [x] 实现纯函数：先将内置 `snippet ?? text` 转为统一 body，再验证覆盖项；禁用项最先处理，错误使用完整 `veriflow.hdlTemplates.<id>.<field>` 路径；数组以 LF 拼接。禁止修改内置数组。
- [x] 清单注册对象设置、每项字段 schema 和描述，默认 `{}`，资源作用域；新增项不在 schema 层强制 body，以允许只禁用/修改内置项，运行时区分是否内置再验证。
- [x] 运行 `npm run compile --workspace veriflow`，再运行 `node --test veriflow-vscode/out/test/templateConfiguration.test.js`，确认通过。
- [x] 检查这部分独立差异，可单独交付模板解析与清单，不提交其他工作区改动。

## Task 2: 接入模板命令并完成模板验收

**Files:**
- Modify: `veriflow-vscode/src/testbench/templateCommands.ts`
- Modify: `veriflow-vscode/src/test/testbenchTemplateCommands.test.ts`
- Modify: `docs/vscode-command-surface.md`
- Modify: `README.md`, `README_zh-CN.md`, `veriflow-vscode/README.md`, `veriflow-vscode/README_zh-CN.md`

**Interfaces:** 消费 Task 1 的 `resolveHdlTemplates(value)`；保持已有注册函数和命令 ID。

- [x] 扩展命令测试的 VS Code mock，让 `getConfiguration('veriflow', editor.document.uri)` 返回随文档切换的设置。验证覆盖 clock 会影响旧子命令、禁用时不插入、两个项目读到不同内容、坏配置汇总一次警告。
- [x] 保留并扩展现有插入测试：`$display` 字面文本、重复占位镜像、CRLF 正文转 CRLF 不重复回车、空正文不产生撤销记录、取消和编辑器状态变化保护。先运行 `npm run compile --workspace veriflow` 及 `node --test veriflow-vscode/out/test/testbenchTemplateCommands.test.js` 确认新增场景失败。
- [x] 每次调用解析当前设置，按语言过滤列表；旧子命令从同一列表按 ID 查找。只要有 issue 就汇总一条配置警告，打开设置操作定位 `veriflow.hdlTemplates`。

```ts
const configuration = vscode.workspace.getConfiguration('veriflow', editor.document.uri);
const resolved = resolveHdlTemplates(configuration.get('hdlTemplates'));
const templates = resolved.templates.filter(t => t.languages.includes(
  editor.document.languageId as 'verilog' | 'systemverilog'
));
const source = template.body.replace(/\r\n|\r/g, '\n').replace(/\n/g, eol);
```

- [x] 复用当前 `SnippetString.appendText/appendPlaceholder` 及显式 `${N}` 镜像 逻辑，不直接把整个 body 传给原生 snippet 构造器。空 source 直接返回。
- [x] 更新中英文 README 和命令说明，给出与方案相同的新增、覆盖、禁用示例以及占位语法限制。
- [x] 运行上述两组测试及 `npm test --workspace veriflow`；通过命令集成测试模拟两个文件夹分别设置同名模板，验证下一次插入立即更新。此处形成第 2 项的独立验收点。

## Task 3: 格式化配置契约与列计算

**Files:**
- Create: `packages/hdl-runtime/src/formatterColumns.ts`
- Create: `packages/hdl-runtime/test/formatterColumns.test.ts`
- Modify: `packages/hdl-runtime/src/formatter.ts`
- Modify: `packages/hdl-runtime/src/index.ts`（导出列配置校验和类型供 VS Code 复用）
- Modify: `packages/hdl-runtime/test/formatter.test.ts`

**Interfaces:**

```ts
export type HdlAlignmentColumns = readonly [number, number, number, number, number];
export function validateAlignmentColumns(value: unknown): HdlAlignmentColumns;
// currentLength 是当前行已有字符数；minimum 是词法上必须的分隔空格数。
export function paddingToColumn(currentLength: number, target: number, minimum: number): string;
// HdlFormatOptions 新增 alignmentColumns?: HdlAlignmentColumns。
// 存在 alignmentColumns 时其 C1 决定有效 indentSize；两者显式冲突时报错。
```

- [x] 先添加边界测试：五个递增整数、C1 为 1–8、C5 不超过 240、重复/缺失/小数拒绝；短内容补齐，已到或越过目标时只补 minimum。

```ts
assert.equal(paddingToColumn(10, 12, 1), '  ');
assert.equal(paddingToColumn(12, 12, 1), ' ');
assert.equal(paddingToColumn(60, 56, 0), '');
assert.deepEqual(validateAlignmentColumns([4, 12, 20, 44, 56]), [4, 12, 20, 44, 56]);
assert.throws(() => validateAlignmentColumns([4, 12, 12, 44, 56]));
```

- [x] 用 `npm test --workspace @veriflow/hdl-runtime` 确认新测试失败，再实现校验和 `return ' '.repeat(Math.max(minimum, target - currentLength))`。
- [x] 扩展 `HdlFormatOptions`；无 alignmentColumns 时保留原 indentSize 行为。把已验证选项传给 printer，仍保留打印后二次解析和指纹验证。从运行时根入口导出 `validateAlignmentColumns` 和 `HdlAlignmentColumns`，VS Code 不跨包引用源码文件。
- [x] 再运行运行时测试，确认旧默认 API 输出保持原样，新配置错误只在打印前拒绝。

## Task 4: 按语法节点实施五列打印

**Files:**
- Modify: `packages/hdl-runtime/src/formatterPrinter.ts`
- Modify: `packages/hdl-runtime/src/formatterColumns.ts`
- Create: `packages/hdl-runtime/src/formatterAlignment.ts`（CST token 列标记，不解析渲染后的文本）
- Test: `packages/hdl-runtime/test/formatterColumns.test.ts`，同时回归现有 `formatter.test.ts`
- Create: `packages/hdl-runtime/test/fixtures/formatter-columns-input.v`
- Create: `packages/hdl-runtime/test/fixtures/formatter-columns-expected.v`

**Interfaces:** `printHdlTree(source, root, indentSize, alignmentColumns?)` 消费 Task 3 已验证的列；保持未传列时走原动态对齐。

- [x] 将开发计划中的 parameter/localparam（字符串 NAME、无位宽 ADDR_WIDTH、带位宽 CONFIG_WIDTH 和 BAUD_RATE）、端口、wire/reg/signed/数组、assign、嵌套 initial/always/generate、带参数例化组合为合法 fixture；补齐逗号、信号定义和条件。按方案表手写期望输出，先通过参数/声明/例化列位置测试验证缺失功能，再加入完整 fixture 对照。

```ts
const options = { alignmentColumns: [4, 12, 20, 44, 56] as const };
const formatted = await formatHdl(input, options);
assert.equal(formatted, expected);
assert.equal(await formatHdl(formatted, options), formatted);
const port = formatted.split('\n').find(line => /input.*clk/.test(line))!;
assert.equal(port.indexOf('input'), 4);
assert.equal(port.indexOf('clk'), 44);
assert.equal(port.indexOf(','), 56);
```

- [x] 在已有 CST 遍历中为支持的参数声明/信号声明/连续赋值/例化 token 标记语义列和外部结构深度；参数名到 C4，赋值等号到 C5，初值与逗号/分号紧随其后；省略的关键字保持省略。让对齐层只处理 token 间空白，不用正则重新猜测字符串、宏、注释中的标点。
- [x] 依据设计表计算目标：声明层按外部深度平移；例化连接沿用实例头的 C4/C5。支持列表最后一行紧凑闭合，避免 list close 的强制换行抵消新输出。
- [x] 添加长名称、长表达式、signed、多维数组、转义标识符、行尾注释、宏续行、CRLF 和自定义列 fixtures。用 `indexOf` 检查位置，用完整输出比较确认溢出时没有拖动其他行；每个 fixture 检查第二次输出不变。
- [x] 不支持的复杂声明走现有 token 打印，禁用固定模式下旧正则对齐对这些行的二次加工。保留全部原始词法 token 和指纹验证。
- [x] 运行 `npm test --workspace @veriflow/hdl-runtime`；新固定模式与旧动态模式全部通过后结束此任务。

## Task 5: VS Code 设置接入和最终验收

**Files:**
- Modify: `veriflow-vscode/package.json`
- Modify: `veriflow-vscode/src/hdlFormatting.ts`
- Modify: `veriflow-vscode/src/test/hdlFormatting.test.ts`
- Modify: `README.md`, `README_zh-CN.md`, `veriflow-vscode/README.md`, `veriflow-vscode/README_zh-CN.md`, `docs/develop_plan.md`

**Interfaces:** 每次格式化读取当前文档的 `veriflow.formatting` 设置；`columns` 模式传 `alignmentColumns`，`adaptive` 只传 `indentSize = columns[0]`。运行时传入的 WASM 路径保持原有逻辑。

- [x] 先扩展 provider/命令 mock 测试：相同文档两个入口收到同一列设置；语言覆盖、两个资源作用域、非法列回退、配置修改后下次调用生效；保留取消/文档版本变化测试。
- [x] 注册 `alignment` 枚举与五元素 columns 设置，默认分别为 `columns` 和 `[4,12,20,44,56]`；设置描述解释从 0 计数、空格缩进和溢出规则。
- [x] 在 `edits()` 内读取设置并校验。列无效时本次使用整组默认列并保留有效的 alignment 模式，只发一条警告；正式格式化错误仍走原有 catch。
- [x] 运行 `npm run compile --workspace veriflow` 和 `node --test veriflow-vscode/out/test/hdlFormatting.test.js`，确认新旧场景通过。
- [x] 更新 README 中设置示例、前后格式对比和例化插入边界；开发计划只在两项验收结束后记为完成。
- [x] 最终运行 `npm test --workspace @veriflow/hdl-runtime`、`npm test --workspace veriflow`、`git diff --check`。核对固定模式、自定义模式和旧 adaptive 模式的实际输出；确认自动导出和 CLI 没有接入新设置。

## 执行边界

用户已于 2026-09-21 确认执行。保留原开发计划示例及此前 ST 工作区改动；实现留在当前工作区的新分支，不自动提交、合并或发布。

## 执行记录

- 计划审查：Task 1→2 的解析结果与命令一致；Task 3→4 的列计算和打印接口一致；Task 3→5 通过运行时根入口导出校验函数；Task 1/5 都编辑清单，按设置键分开合并；Task 2/5 文档更新由主线程统一完成。
- 范围修正：按 2026-09-21 新需求将 parameter/localparam 纳入固定列打印，等号为 C5，初值后标点不补齐。原计划将参数排除已纠正。
- 工作区决策：延续用户正在使用且有前序未提交改动的工作区，建立 `codex/hdl-templates-formatting` 分支，不复制或暂存用户改动。


## 完成与验证（2026-09-21）

- Task 1–2 完成：模板解析、设置、旧命令接入、13 个配置/命令测试；含数值紧随占位符时的镜像保护和非法索引按原文保留。
- Task 3–4 完成：五列语义对齐、参数声明、嵌套 generate、例化紧凑闭合、多实例分行；8 个新格式化测试加 9 个原有测试通过。
- Task 5 完成：命令与 provider 文档作用域一致、语言覆盖作用域、动态模式回退、中英文说明、开发计划记录。
- `npm test --workspace @veriflow/hdl-runtime`：119 项通过。
- `npm test --workspace veriflow`：60 个测试文件通过，包含 VSIX 打包检查。构建仅有原有 require.resolve 资源警告。
- 两轮只读审查完成；已修复多实例换行、adaptive 非法列回退、镜像后数字三项问题，各有回归测试。
- `git diff --check` 通过。未提交、合并或发布；没有真实 VS Code 手动点击验收，编辑器边界通过命令/provider 集成测试验证。
- 本项是 TypeScript 格式化工具开发；`.v` 文件为语法/格式 fixture，采用重新解析与 CST 指纹校验，不声称 fixture 已执行电路仿真。

### 空行补全与测试包

- 参数声明独立成组，与变量声明、连续赋值组之间补一空行；补齐 initial/final/generate/function/task 的块间空行，每条模块例化语句之间同样分隔。同组连续声明或赋值保持紧凑。
- 新增两项回归测试，覆盖两种对齐模式、注释归属、幂等和 CRLF；完整运行时测试为 121 项通过，格式化命令/provider 集成测试通过。
- 执行 `npm run package --workspace veriflow -- --out veriflow-1.5.2-formatting-test.vsix`，生成本地测试包，版本保持 1.5.2，未发布。已检查归档 CRC、设置以及包内 bundle/资源与当前构建一致。
