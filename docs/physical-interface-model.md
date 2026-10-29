# 板卡与子卡约束模型 V1

Schema 的 `$id` 保持 `urn:veriflow:physical-model:v1`。板卡约束尚未发布，因此直接重构 V1；既有 AD 文档版本不变。版本调整遵循根目录 AGENTS.md 和 changelog。

## 板卡/子卡

```json
{
  "kind": "board",
  "extension": ".xdc",
  "constraints": "set_property PACKAGE_PIN A1 [get_ports tx]\nset_property PACKAGE_PIN A2 [get_ports rx]\n",
  "interfaces": [
    {
      "id": "UART0",
      "signals": [
        { "id": "tx", "direction": "output", "pins": ["A1"] },
        { "id": "rx", "direction": "input", "pins": ["A2"] }
      ]
    }
  ]
}
```

只有四个模型字段：`kind` 为 `board` 或 `daughtercard`，`extension` 保留约束后缀，`constraints` 保存完整原文，`interfaces` 保存本板的接口。引脚从原文索引，无需另外录入封装脚表。用户库只在模型外增加 `id`、`name`，即 `{id, name, model}`，JSON 导入同时接受包装结构和裸模型。

每个接口只有 `id` 和 `signals`。信号只有 `id`、`direction`、`pins`。`pins` 的长度就是位宽，按从高位到低位的顺序列出匹配引脚；不会重复保存 width。方向相对于 FPGA 顶层端口。编辑器可暂存空引脚以便修改，保存时必须全部匹配。不同接口可描述相同引脚的不同用途，同一接口内部不允许重复占脚。

子卡的 `pins` 使用连接器/逻辑引脚，例如 `P1`、`P2`。不再存在独立接口模型、角色、分组、差分规则、Bank、供电轨、器件型号、厂商或 IO 标准选择字段。

## 工程绑定和子卡安装

```json
{
  "board": "user:carrier",
  "cards": [
    {
      "id": "serial0",
      "board": "user:serial-card",
      "connections": [
        { "cardPin": "P1", "boardPin": "A3" },
        { "cardPin": "P2", "boardPin": "A4" }
      ]
    }
  ],
  "bindings": [
    {
      "source": { "card": "serial0", "interface": "UART0", "member": "tx" },
      "port": { "name": "uart_tx" }
    }
  ]
}
```

该对象直接存入 AD 的 `physical`，或 RTL 的 `.pins.json`；不新增装配文件。`cards`、绑定来源的 `card` 均可省略。主板和子卡引用支持 `user:<id>` 或相对于所属配置文件的 JSON 路径。

标量 `member` 使用信号 ID。多位信号按引脚顺序展开为 `data.N-1` 到 `data.0`，`port.bit` 保存 HDL 的实际位索引。总线绑定以 HDL 声明顺序对应，允许非零、升序和负数 HDL 索引。

安装子卡时，直接保存逻辑引脚到载板物理引脚的映射；无需额外的槽位模型。挂载表中已映射的物理引脚不能再直接作为主板信号使用。子卡自身的约束负责输出，不叠加主板同一脚的其他电气属性；文件扩展名必须一致。

## 原文处理与输出保护

XDC 静态识别 PACKAGE_PIN/LOC、字典式属性和 get_ports 字面量。根据最终绑定筛选目标并替换端口名，子卡同时替换引脚。注释、命令顺序、未改写文本和换行保留。Tcl 不执行；动态目标、通配符或歧义会报告错误，用户可编辑原文。

其他格式通过 `{{PORT:A1}}` 和 `{{PIN:A1}}` 明确标出需要替换的位置。原始后缀直接用于输出，不进行格式转换。公共文本保留，未绑定引脚的约束命令不输出。

生成文件旁保存 `.veriflow.json` 归属记录，以内容摘要检查人工编辑，避免向原约束插入格式相关的标记。AD 输出路径为 `export.constraintsOutput`。

## 校验与示例

[Schema](../packages/schematic-core/schemas/physical-interface-model.schema.json) 检查模型形状；共享 TypeScript 核心检查 ID、接口内引脚唯一性、绑定、方向、位宽、端口索引、子卡映射、占用冲突和格式一致性。

示例为 [载板](../data/physical-models/examples/carrier.board.json)、[UART 子卡](../data/physical-models/examples/uart.daughtercard.json) 和 [AD 装配](../data/physical-models/examples/top.ad)。示例引脚仅用于演示。运行 `npm run verify:models` 和核心测试检查契约与行为。
