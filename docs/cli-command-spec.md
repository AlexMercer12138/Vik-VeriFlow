# VeriFlow CLI 命令规范（1.5.2）

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
