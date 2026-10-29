# 架构与模型维护索引

## 入口和依赖方向

VS Code 扩展提供完整产品交互，CLI 提供脚本和单文件快捷操作；两者调用同一套 TypeScript 业务实现。

```mermaid
flowchart TD
    CLI[CLI 参数与终端] --> Runtime[hdl-runtime 用例与文件编排]
    VSCode[VS Code 文档、菜单、生命周期] --> Runtime
    VSCode --> Webview[schematic-webview AD/ST 画布与消息契约]
    Webview --> Domain[schematic-core AD、接口、物理模型]
    Runtime --> Domain
    Runtime --> HDL[hdl-core HDL 解析契约]
    Runtime --> Flow[flow-core 工程、模板、仿真契约]
```

| 位置 | 维护内容 |
| --- | --- |
| `packages/schematic-core/src/archDesign` | AD 解析、编辑、解析后的图和 RTL 生成 |
| `packages/schematic-core/src/physical*.ts` | 板卡/子卡原文约束、本板接口、绑定与渲染纯算法 |
| `packages/hdl-runtime/src/archDesign` | HDL 定义身份、脚本编辑批次、RTL/约束构建计划 |
| `packages/hdl-runtime/src/artifacts` | 输入快照、输出冲突、生成归属、文件发布 |
| `packages/hdl-runtime/src/physical` | 板卡文件、用户库、装配、输出归属和 RTL 端口解析 |
| `packages/hdl-runtime/src/interfaces` | 工程逻辑协议文件加载与诊断 |
| `packages/hdl-runtime/src/simulationTask*` | ST 模型、编辑、预设、TB 和工作区来源解析 |
| `packages/hdl-runtime/src/hdl` | 例化、快捷 TB 的纯文本生成 |
| `packages/schematic-webview/src` | AD/ST 共用画布；`shared` 提供消息、布局和 UI 辅助 |
| `packages/cli/src/commands` | 参数适配、终端输出和退出码 |
| `veriflow-vscode/src` | 原生编辑器事务、菜单、索引生命周期、Webview 宿主 |

可自动化的能力先写共享 TS API，再接 CLI 和扩展。共享包不能导入扩展源码或 `vscode`。扩展旧模块中的转导出保留调用兼容，业务实现只在共享包维护。画布测试归 `schematic-webview`，独立波形宿主测试归 `waveform-desktop`。

## JSON 模型在哪里

| 模型 | 唯一维护源 | 消费方式 |
| --- | --- | --- |
| AD 文档 v2 | 用户工程的 `.ad`；解析器在 `schematic-core/src/archDesign` | 画布与 `arch`；`physical` 是该设计引脚配置的持久化来源 |
| ST 文档 v1 | 用户工程的 `.st`；模型在 `hdl-runtime/src/simulationTask` | 画布与 `task`；引用 HDL/AD，保存预设、连线与运行设置 |
| AXI4、AXIS、APB、AHB-Lite 逻辑协议 | `packages/schematic-core/src/interfaces/builtins/*.json` | 随共享包编译发布；工程可通过 `project.json` 的 `interfaceProtocolFiles` 扩充 |
| 板卡与子卡 | 用户原始约束及 JSON profile | 完整原文、后缀、板卡内接口；不维护独立接口模型 |
| 用户板卡/子卡库 | `~/.veriflow_config.json` 的 `boards` | 两入口共用；保存保留其他设置，检测配置变化 |
| RTL 引脚绑定 | 用户工程的 `*.pins.json` | 复用 `PhysicalConfiguration`；扩展显式加载/保存，CLI `pins --config` |
| 物理模型 Schema | `packages/schematic-core/schemas/physical-interface-model.schema.json` | 校验脚本和扩展构建消费副本 |
| ST Schema | `packages/hdl-runtime/schemas/simulation-task.schema.json` | npm 导出和扩展 JSON 编辑器消费副本 |
| 子卡和装配示例 | `data/physical-models/examples` | V1 模型与 AD 安装示例；引脚面板配置子卡物理引脚映射 |

`data/physical-models` 只承担硬件资源。AD/ST 是工程文档，逻辑协议定义信号关系；它们的所有权按领域划分。

构建时只复制编辑器 Schema 到 `veriflow-vscode/schemas`，不打包板卡或独立物理接口资源。板卡/子卡使用 `user:<id>` 或相对 JSON 路径；XDC 静态解析端口和引脚，其他格式用显式锚点保留原文与扩展名，不推导厂商电气规则。

## 构建与检查

```bash
npm ci
npm run build                         # 模型校验、共享 TS、Web UI、扩展
npm run build:cli                     # CLI 与独立波形宿主
npm run test:maintenance              # 构建、发布辅助和资源复制回归
npm run test:shared
npm run test:cli
npm test --workspace @veriflow/schematic-webview
npm run test:browser --workspace @veriflow/schematic-webview
```

Linux 的 Electron 测试需要显示服务，可用 `xvfb-run -a`。`build:parser` 单独维护 SEA 实验；普通产品构建不运行 SEA 探针。常规重构不需要版本更新或发布打包。

## CLI 命令与脚本构筑

正式名称统一为 **`veriflow arch` / `veriflow task`**；`ad` 作为 `arch` 的兼容别名，文档和新脚本使用全称。

```bash
veriflow arch new top -o top.ad
veriflow arch apply top.ad --ops arch-edits.json --in-place
veriflow arch build top.ad -o generated/top.v --constraints-output generated/top.xdc

veriflow task new -o sim.st
veriflow task apply sim.st --ops task-edits.json --in-place
veriflow task tb sim.st -o generated/sim_tb.v
veriflow task validate sim.st
veriflow task run sim.st

veriflow board import data/physical-models/examples/carrier.board.json --id demo
veriflow board list --json
veriflow board validate user:demo
veriflow board export user:demo -o demo-board.json
veriflow pins validate top.ad
veriflow pins export top.v --config top.pins.json -o generated/top.xdc

veriflow hdl format top.v --check
veriflow hdl format top.v --in-place
veriflow hdl instantiate top.v --module top
veriflow hdl template --list
veriflow hdl template --template clock
veriflow hdl tb top.v -o top_tb.v
veriflow hdl run top_tb.v --wave-output results/top.vcd
```

`arch build` 无 `physical` 时只生成 RTL，有 `physical` 时校验板卡/子卡绑定并生成 RTL 与原文约束。`--rtl-only` 跳过物理构建。`arch export` 只导出 RTL。约束路径优先级为 CLI `--constraints-output`、`export.constraintsOutput`、实际 RTL 的同名文件加板卡保存的扩展名。`.veriflow.json` 记录约束文件归属与摘要，人工修改会阻止覆盖。`board ui` 启动共享板卡编辑器。

### AD 操作文件

`arch-edits.json`：

```json
{
  "format": "veriflow-arch-edits",
  "schemaVersion": 1,
  "operations": [
    { "type": "addPort", "port": { "name": "led", "direction": "output" } },
    { "type": "setDefault", "endpoint": "led.value", "expression": "1'b0" }
  ]
}
```

图编辑复用 `ArchDesignEdit`，包括端口、连线、参数、逻辑、接口和 `setPhysical`。脚本加入 HDL 实例使用 `{ "type": "addSourceInstance", "id": "dut", "source": { "kind": "hdl", "path": "rtl/dut.v", "module": "dut" } }`，由运行时解析准确的定义身份。

### ST 操作文件

假定 `dut.v` 定义 `module dut(input clk); ... endmodule`，`task-edits.json`：

```json
{
  "format": "veriflow-task-edits",
  "schemaVersion": 1,
  "operations": [
    { "type": "addSourceInstance", "id": "dut", "source": { "kind": "hdl", "path": "dut.v", "module": "dut" } },
    { "type": "addPreset", "id": "clock", "preset": { "kind": "clock", "frequencyMHz": 100, "initial": 0 } },
    { "type": "connect", "source": { "kind": "instance", "instance": "clock", "port": "clk" }, "target": { "kind": "instance", "instance": "dut", "port": "clk" } },
    { "type": "updateTaskSettings", "settings": { "duration": 100 } }
  ]
}
```

ST 另支持 AD 来源 `{ "kind": "ad", "path": "top.ad" }`、reset/stimulus/protocol 预设、`updatePreset` 和共享图操作。源文件路径相对目标 AD/ST，操作文件路径只由 `--ops` 定位。整批在内存编辑，完成后校验语义；失败带操作序号且不写回源文件。

### 输出保护

编辑必须显式选 `--in-place` 或 `--output`。另存编辑文档暂限同目录，避免改变相对引用。新文件拒绝覆盖，已有生成产物只允许同一来源和类型替换。构建先检查全部输出及输入快照；已知冲突不发布任何产物。发布中途失败会报告已发布清单，跨文件发布不承诺事务回滚。

新增的构建、编辑、板卡、引脚和 HDL 命令提供 `--dry-run` / `--json`；JSON 信封为 `veriflow-result` v1。文本生成默认 stdout 输出正文，指定 `-o` 时写文件。退出码：0 成功、1 校验或执行失败、2 参数错误。仿真完成仅表示后端正常执行。

引脚面板操作见 [引脚绑定与约束](physical-pin-bindings.md)，硬件字段见 [物理模型](physical-interface-model.md)。
