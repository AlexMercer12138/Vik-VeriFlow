# VeriFlow CLI 重设计草案

状态：供评审，以下新命令尚未实现，不属于 1.5.2 已完成功能。本文末尾保留当前命令契约供迁移核对。

## 设计原则与选择

CLI 按工作区模块管理、AD 管理、ST 管理组织。命令负责从终端进入工作流；已经能在 webview 内完成的操作，进入界面后完成，不再增加相应子命令。判断依据是用户操作是否依赖宿主入口，而非代码里是否注册了 VS Code command：画布按钮调用的内部 command 也不需要 CLI 副本。

建议采用“独立工作台 + 少量入口命令”。相较继续扩展纯命令行的验证、导出、运行子命令，这符合当前图形化工作流；相较调用 `code` 打开扩展，它也能在未安装 VS Code 时使用。代价是需要为现有 webview 补齐独立宿主，这部分明显超过简单命令改名的工作量。

工作台包含 Module Browser、AD/ST 文件列表、编辑区、日志区与设置入口。打开某个文件时进入同一工作台并定位该文档，不能只打开一个没有模块浏览器、无法添加模块的孤立画布。

## 建议命令树

```text
veriflow
  workspace open [DIR]
  module new FILE
  module open FILE [--module NAME]
  module run FILE [--module NAME]
  module format FILE [--check]
  module template NAME
  module instantiate FILE [--module NAME]
  ad new FILE [--module NAME] [--no-open]
  ad open FILE
  st new FILE [--no-open]
  st open FILE
  wave open FILE
```

保留无参数显示帮助以及 `--help` / `--version`，不悄悄改变现有脚本行为。`workspace open` 默认目录为当前目录；其余工作区相关叶命令支持 `--workspace DIR`，默认也为当前目录。显式工作区只决定扫描和设置范围，不改变命令行相对路径的解析基准。暂不增加根级 `open`、`ui`、`gui` 等同义入口。

| 命令 | 对应 VS Code 入口 | 约定 |
| --- | --- | --- |
| `workspace open [DIR]` | VeriFlow 侧栏和工作区 | 启动独立工作台，扫描模块并列出 AD/ST；不要求先创建 project JSON |
| `module new FILE` | New HDL File | 创建空 `.v` / `.sv` 文件，行为与现有扩展一致，输出绝对路径；不擅自选择代码编辑器 |
| `module open FILE` | Open Schematic | 在工作台打开 HDL 原理图；文件含多个模块时由界面选择，`--module` 可精确指定 |
| `module run FILE` | 编辑器右键 Run Current Testbench / 选择 Testbench | 运行已有 HDL testbench，终端显示日志，成功生成波形后打开查看器；与 ST 画布运行区分 |
| `module format FILE` | HDL 文本格式化 | 原地格式化，复用语法树等价保护；`--check` 只检查，不写文件 |
| `module template NAME` | HDL 文本插入模板 | 输出模板文本至 stdout，名称由 `--help` 列出并复用现有模板集合；不控制其他编辑器的光标 |
| `module instantiate FILE` | HDL 文本例化模块 | 输出例化文本至 stdout，复用模块索引；不修改源文件、不自动剪贴板粘贴 |
| `ad new FILE` | Create Architecture Design | 创建合法空 AD，默认模块名从文件名规范化得到，允许 `--module` 覆盖；随后打开工作台 |
| `ad open FILE` | AD 树/资源管理器打开文件 | 打开 AD 画布，保留模块浏览器、Inspector 和工具栏 |
| `st new FILE` | Create Simulation Task | 创建与扩展相同的合法空 ST 并打开工作台，DUT、时钟、复位等在画布配置 |
| `st open FILE` | ST 树/资源管理器打开文件 | 打开 ST 画布，可继续编辑、导出 TB、仿真和查看波形 |
| `wave open FILE` | Open VCD / 资源管理器打开 VCD | 直接接受 `.vcd` 文件，沿用已有波形宿主，无需为查看波形建立 project JSON |

`module template/instantiate/format` 是文本编辑器入口的等价能力，不属于画布编辑命令。它们放在帮助的“HDL 文本工具”次级分区；日常主流程突出工作区、AD、ST。`module run/instantiate` 在文件有多个候选模块且未指定 `--module` 时失败并列出候选，不使用全局 top 隐式猜选。模块身份始终包含源文件与模块名，索引内部保留 definition key。

新建 AD/ST 默认创建并打开，`--no-open` 只落盘，适合无图形环境。新建文件必须匹配声明后缀，允许创建缺失父目录；拒绝覆盖现有文件，不提供通用 `--force`。先完成写入再启动界面，启动失败应返回失败并明确文件已创建，不能删除用户已经得到的文档。`module run` 提供 `--no-open` 以跳过自动波形窗口。

## 留在界面里的动作

| 操作 | 承载位置；不新增的命令 |
| --- | --- |
| 模块扫描、刷新、搜索、排序、库目录管理 | 工作台模块浏览器/设置；不增加 `module scan/list/search` 或新 `lib` 命令 |
| 将模块加入画布、复制例化、打开定义源码 | 模块浏览器菜单；不增加 `ad add-module`、`st add-dut`；文本例化输出复用上表已有工具 |
| AD 实例、端口、连线、接口、参数、布局 | AD webview；不增加 `ad add/connect/set/layout` |
| AD 验证、RTL 预览和导出 | AD 工具栏；不扩展现有 `ad validate/export` 参数集合 |
| ST 激励、时序、断言、DUT 参数、导出 TB | ST webview；不增加 `st stimulus/clock/reset/export` |
| ST 运行、停止、打开结果波形 | ST 工具栏；不新增 `st run/stop/wave` |
| 日志、设置、保存、另存、撤销重做 | 工作台宿主界面；不增加 `logs/save/undo` 命令 |
| AD/ST 文件列表刷新 | 文件监听与工作台刷新；不增加 `ad list/refresh`、`st list/refresh` |

VS Code 的原生菜单动作必须在独立工作台内有实际可用的按钮/菜单。例如 Module Browser 当前右键“Add to Canvas”由 VS Code 贡献，不是 HTML 自带能力；移植时必须补上。源码导航由宿主的“用外部编辑器打开”适配器承担，编辑器可在工作台设置中配置可执行文件及参数列表；不依赖 `code`。未配置时显示可复制的文件路径和行号，不能把导航成功伪装成已经打开源码。

## 工作区、文件及运行约定

- 工作区是目录，文件仍可直接在其他编辑器中修改，不建立额外的模块数据库真相来源。默认扫描工作区，外部模块来自显式配置的库目录。第一阶段支持单根目录；多根支持单独扩展，不能默默合并路径身份。
- 默认配置采用 builtin 仿真器和波形器。工作区配置拟使用可选 `.veriflow/workspace.json`（带版本字段），只保存共享的库目录、宏/include 路径、工具配置；首次打开目录不写入文件。界面设置显式保存时才创建；窗口布局、运行缓存等不混入该文件。VS Code 与独立宿主使用同一配置模型，VS Code 专属 UI 设置继续留在 VS Code。
- 解析优先级拟为显式本次参数 > 工作区共享配置 > 用户级配置 > 内置默认值。已有 VS Code 设置和旧 project JSON 经显式导入迁移，不静默覆盖；在兼容旧命令时继续走原来的配置解析逻辑。新入口不要求设置全局 `top`，仿真入口由 HDL testbench 或 ST 自身确定。
- 命令行路径相对于执行目录；文档内部引用相对于文档目录；工作区配置中的路径相对于配置所属工作区。新建 ST 复用扩展默认值与序列化，不能手写另一份 JSON 模板。TB 默认仍导出到 ST 同目录，沿用已有文件保护。
- 新图形命令在窗口完成加载、目标文档被宿主确认接收后返回 `0`；不能只因 spawn 成功就报告打开成功。运行期错误由窗口显示。`module run` 等终端动作在执行结束后退出；Ctrl+C 取消子进程并清理临时目录，失败保留诊断信息。
- 退出码延续 `0` 成功、`1` 操作失败、`2` 参数错误。`module format --check` 有格式差异返回 `1`。模板/例化的 stdout 只含生成内容，诊断走 stderr；不为所有命令预先增加 `--json`。
- 工作台按规范化后的工作区路径复用窗口/会话；重复打开同一文档聚焦已有页签。必须处理未保存修改、磁盘外部修改冲突和关闭提示；避免两个宿主静默互相覆盖。

示例（提案语法，当前版本不能直接执行）：

```bash
veriflow workspace open .
veriflow module new rtl/uart.v
veriflow module open rtl/uart.v --module uart
veriflow ad new design/soc.ad --module soc
veriflow st new sim/soc.st
veriflow st open sim/soc.st
veriflow module run sim/uart_tb.v --module uart_tb
veriflow wave open sim/result.vcd
```

## 宿主实现边界

当前 `packages/waveform-desktop` 只提供波形窗口，并没有可直接启动的 AD/ST 宿主。`veriflow-vscode/src/archDesign/archDesignEditorProvider.ts`、`src/simulationTask/taskEditorProvider.ts` 与 `src/workbench/moduleBrowserProvider.ts` 仍依赖 VS Code。仅在 CLI 注册 `open` 并加载 HTML 无法实现本方案。

建议增加独立工作台宿主包，沿用已有 Electron 启动和窗口管理经验，复用 schematic/waveform web 产物，不复制画布实现。将 AD/ST 文档操作、模块索引、接口协议加载、文件生成和运行控制抽成无 `vscode` 依赖的应用服务；扩展与独立宿主各自适配文档、文件监听、对话框、日志、进程和波形打开。浏览器端保持已有业务消息协议，只有宿主层负责本地文件与工具访问。

需要特别补齐 VS Code 当前隐式提供的文档状态、撤销重做、保存冲突处理、菜单/快捷键、剪贴板、主题，以及 Module Browser 向当前 AD/ST 画布添加模块的会话路由。原生 AD/ST 文件树要实现为工作台界面，不能假设现有 webview 已包含它们。设置页使用共享配置模型，不把 `vscode.workspace.getConfiguration` 搬进 CLI。

## 兼容与实施顺序

1. **先做共享创建服务与 ST 创建入口。** `st new FILE --no-open` 先形成可测试的文件能力；普通 `st new` 的创建并打开行为在宿主可用后再对外宣称完整支持。抽取创建服务时保持扩展的默认文档内容。
2. **独立工作台与模块浏览。** 实现工作区索引、模块浏览器、AD/ST 列表、配置和通用文档生命周期，再接入 HDL 原理图及文本工具入口。
3. **接入 AD/ST 全流程。** 完成打开、保存、撤销、模块添加、验证、导出、运行和波形跳转；然后开放 `ad open`、`st open` 及默认创建后打开。
4. **迁移 CLI 表面。** 主帮助转为新对象结构；旧 `project/lib/top/analyze/sim/wave/task` 与 `ad validate/export` 保留兼容路径，集中列在兼容帮助，不再扩大功能面。后续主版本才考虑移除，先给出迁移说明和使用方验证。

现有 `ad new MODULE --output FILE` 与提案 `ad new FILE [--module NAME]` 同名但语义不同，不能靠后缀猜测意图或直接替换解析器。1.x 保留 `ad new` 的完整原语义；新 `ad open`、`st new/open` 可增量落地。文件路径形式的 `ad new` 留到下一主版本切换，届时保留显式旧 `--output` 形式的兼容分支，并为裸位置参数提供迁移说明（例如旧 `ad new soc` 改为 `ad new soc.ad --no-open`）。`wave --project FILE` 与 `wave open FILE` 可按子命令分流；旧 `task run` 保留无界面自动化，不机械新增 `st run` 别名。

验收重点：未安装 VS Code 仍能完成创建 ST → 选择 DUT → 保存 → 仿真 → 打开波形；AD 创建 → 加模块 → 连线 → 验证 → 导出可运行；相同文档跨宿主读写兼容；空格/中文路径、同名模块、无图形环境 `--no-open`、外部修改冲突、窗口关闭及仿真取消均有明确结果。旧 CLI 契约测试必须继续通过。新命令帮助只展示实际落地的功能。

---

# 现有 CLI 命令契约（1.5.2，迁移基线）

本规范以 `packages/cli/src/main.ts` 的命令注册表和 `tests/cli_contract/cases.json` 为当前契约。补丁版本保持现有命令、参数和退出码兼容；新增命令必须同时更新帮助、契约测试和本文。

## 命令结构与参数

采用 `veriflow <对象> <动作> [选项] [位置参数]`，保留现有顶层快捷命令 `analyze`、`sim`、`wave`。命令、长选项使用小写；未来多词名称使用连字符。文档和自动化脚本使用完整长选项，避免依赖可缩写的参数前缀。

| 命令 | 必需参数 | 可选参数与作用 |
| --- | --- | --- |
| `project new` | `--name NAME` | `--root ROOT --top TOP --lib DIRS --sim builtin\|custom --wave builtin\|custom --output FILE`；默认写入当前目录的 `NAME.json` |
| `project open` | `--project FILE` | 打开并显示项目基本配置，不启动编辑器 |
| `project show` | `--project FILE` | 显示项目详情 |
| `lib add` / `lib remove` | `--lib DIR` | 增删一个全局库目录 |
| `lib list` | 无 | 列出全局库目录 |
| `top set` | `--project FILE --top MODULE` | 持久化顶层设置 |
| `top get` | `--project FILE` | 显示顶层 |
| `analyze` | `--project FILE` 或 `--top MODULE` | `--root ROOT --lib DIRS --sim builtin\|custom --wave builtin\|custom`；解析依赖 |
| `sim` | `--project FILE` | `--top MODULE --lib DIRS --sim builtin\|custom --wave builtin\|custom`；编译和运行 |
| `wave` | `--project FILE` | 按项目配置打开波形 |
| `ad new MODULE` | 位置参数 `MODULE` | `--output FILE`；创建 `.ad` |
| `ad validate DESIGN` | 位置参数 `.ad` 路径 | `--project FILE --lib DIR` |
| `ad export DESIGN` | 位置参数 `.ad` 路径 | `--project FILE --lib DIR --output FILE --language verilog\|systemverilog` |
| `task validate TASK` | 位置参数 `.st` 路径 | `--project FILE`；验证任务、源文件与生成的 testbench |
| `task run TASK` | 位置参数 `.st` 路径 | `--project FILE`；执行任务，输出日志和生成波形的路径 |

公共别名：`-h/--help`、根级 `-v/--version`、`-p/--project`、`-n/--name`、`-r/--root`、`-t/--top`、`-L/--lib`、`-s/--sim`、`-w/--wave`、`-o/--output`。这些别名仅在上表声明支持该参数的命令中有效，不能把根级参数任意前置到子命令之前。

现有解析器支持 `--option=value`、短选项紧接值，以及唯一长选项前缀；重复选项取最后一个值。因此多库目录在 `project new`、`analyze`、`sim` 中使用逗号分隔，不能用重复 `--lib` 累加。`ad` 命令的 `--lib` 表示单个附加目录。当前不提供 `--` 分隔符或 `--json` 输出。

## 路径、状态与输出

- 命令行输入文件与输出路径相对于执行命令的当前目录解析，带空格的路径必须加引号。`.st` 中的 HDL、AD、运行时数据路径相对于 `.st` 所在目录解析。
- `project new`、`top set`、`lib add/remove` 会写配置；`analyze` 和 `sim` 的显式项目覆盖参数会保存，不能当作一次性覆盖使用。`task` 不带 `--project` 时使用内置仿真器；带项目时复用工具与依赖配置。
- 帮助、查询结果和正常进度写入 stdout；参数解析错误及捕获的执行异常写入 stderr。`task run` 分别转发仿真器 stdout/stderr；兼容旧行为的 `sim` 在失败时把仿真器 stderr 作为诊断文本写入 stdout，成功时不转发 stderr。依赖分析的部分诊断也在 stdout。当前为面向人的文本输出，脚本以退出码判断成功，不能仅以 stderr 是否为空或某条成功日志作判断。
- 退出码 `0` 表示成功（包括帮助、版本、无参数帮助）；`1` 表示执行、验证、依赖、仿真失败或任务取消；`2` 表示命令行语法错误，例如未知命令、缺少必需参数、非法枚举值。
- 生成文件遵循各命令的覆盖保护；文档示例不能假设任意现有文件可被覆盖。CLI 仿真与 VS Code 任务共用生成器和后端，不另外维护一套 HDL 语义。

## 常用流程

```bash
veriflow project new --name demo --root . --top tb_top --output demo.json
veriflow analyze --project demo.json
veriflow sim --project demo.json
veriflow wave --project demo.json

veriflow ad new demo_top --output demo.ad
veriflow ad validate demo.ad
veriflow ad export demo.ad --output demo.v --language verilog

veriflow task validate simulation.st
veriflow task run simulation.st
veriflow task run simulation.st --project demo.json
```

## 新增或修改命令的检查清单

1. 注册在现有 `LEAF_COMMANDS` / `TOP_LEVEL_COMMANDS` 中，参数校验留在解析层，业务实现放入 `commands/`。
2. 提供根级、分组级、叶级帮助，明确必需参数、默认值、路径基准和写文件副作用。
3. 不重分配现有短选项，不在补丁版本删除参数或改变成功/失败退出码。
4. 增加成功、缺参、未知参数、空格路径、失败退出码契约；执行 `npm run test:cli` 和 `npm run test:release`。
5. 需要机器可读输出、破坏性动作或新覆盖策略时另作设计，不以改写现有文本输出的方式隐式引入。
