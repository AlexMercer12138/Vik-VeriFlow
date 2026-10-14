# 物理接口、板卡与子卡模型 V1

状态：2026-10-14 数据契约草案。JSON Schema 和示例已同步；插件尚未读取这些文件，AD 集成、冲突检查和约束导出尚未实现。

## 1. 字段取舍

字段至少满足以下一项才保留：能输出约束、影响约束生成、参与引脚复用或电平检查、承担跨模型映射。能够从其他字段确定的信息不重复记录，省略的可选集合按空集合处理。

| 取舍 | 内容与原因 |
| --- | --- |
| 删除 | 文档级 `id`、`revision`、`name`、`description`、`format`、`schemaVersion`、`$schema`；文件路径已经定位定义，说明移到本文 |
| 删除 | 信号与实例显示名称、差分对 ID、跳线的物理类型、自由文本 `capabilities`；没有独立的生成或校验用途 |
| 简化 | `signals` 直接列 ID 字符串；引用直接写相对路径；接线直接写 `pin`；来源有 `mount` 即表示子卡，无需重复来源类型 |
| 简化 | 完整器件型号写在 `device` 一个字段；电压直接写整数或允许值数组，不再额外写 fixed/selectable/unknown |
| 去重 | I/O 标准的电压和差分要求集中放在 `ioStandards`，每条接线不再重复填写 `vccoMv`；绑定只在改用其他标准时填写 `ioStandard` |
| 保留 | 分组与选择、角色方向、实际引脚和差分配对、Bank 与供电轨、复用条件、子卡安装和信号映射、AD/HDL 端口绑定、输出格式与路径 |

物理模型只用一个 `kind` 区分五类文件：`fixed`、`expansion`、`board`、`daughtercard`、`assembly`。Schema 拒绝未知属性。Schema 文件本身的 `$schema` 等是验证器元数据，不属于物理数据。

## 2. 引用和 ID

一份文件只定义一个模型，文件名承担定义名称。所有引用都是相对包含该引用的文件的路径，例如 `"definition": "spi.fixed.json"`、`"board": "carrier.board.json"`。加载时规范化路径并检查被引用模型的 `kind`，不按相似文件名自动替换。若要同时维护不同硬件版本，使用不同文件路径。

只给实际被引用的对象保留 ID：接口实例、分组、扩展实例、子卡挂载、封装脚、Bank、供电轨和复用选择器。信号直接使用字符串 ID。ID 区分大小写；对象 ID 匹配 `[A-Za-z_][A-Za-z0-9_.-]*`，信号、封装脚和 Bank ID 允许数字开头。

## 3. 固定接口

```json
{
  "kind": "fixed",
  "signals": ["sck", "cs_n", "mosi", "miso"],
  "function": {
    "spi-master": { "sck": "output", "cs_n": "output", "mosi": "output", "miso": "input" },
    "spi-slave": { "sck": "input", "cs_n": "input", "mosi": "input", "miso": "output" }
  },
  "groups": [
    { "id": "data", "members": ["sck", "cs_n", "mosi", "miso"] }
  ]
}
```

| 字段 | 用途 |
| --- | --- |
| `signals` | 功能信号 ID，供映射、勾选与端口绑定使用 |
| `function` | 角色到完整方向表，用于 AD 端口建议和方向校验；放在 `signals` 后面 |
| `groups[].id`、`members` | 通过组选择本次参与约束生成的信号 |
| `groups[].selection` | 省略即 `individual`，可部分选用；`together` 表示任一成员启用都必须补齐全组 |
| `differentialPairs[].positive`、`negative` | 实际功能差分对，用于成对选择、极性检查和资源占用 |

`groups`、`differentialPairs` 可省略。每个方向表恰好覆盖 `signals`，方向始终相对 FPGA 顶层端口。同一功能差分对在每个角色下 P/N 方向一致。一个信号表示一根标量线，向量展开为多个 ID 再绑定端口位。

| 接口 | function | 方向规则 |
| --- | --- | --- |
| UART | `uart` | TX 输出，RX 输入 |
| I2C | `i2c` | SCL/SDA 均为 inout，主从共用一个角色 |
| SPI | `spi-master`、`spi-slave` | SCK/CS/MOSI 与 MISO 按角色确定方向 |
| HDMI | `hdmi-source`、`hdmi-sink` | TMDS、HPD 随角色改变方向，DDC/CEC 均为 inout |

推挽/开漏和总线释放由 RTL 实现。`function` 不直接输出 XDC，但参与 AD/HDL 映射。角色选择不会改变板卡实际电路或改写 HDL。

固定接口实例保存 `{ "id": "SPI0", "definition": "spi.fixed.json", "function": "spi-slave" }`。定义只有一个角色时省略实例的 `function`，使用唯一角色；有多个角色时必须显式选择。扩展接口实例不填写 `function`。

选择展开时合并显式成员与组成员，反复补齐 `together` 分组和固定功能差分对，直到不再变化，再去重。取消勾选同样遵守分组与功能成对规则；不按协议名称自动加入其他可选功能。

## 4. 扩展接口

```json
{
  "kind": "expansion",
  "signals": ["io0", "io1", "dp0_p", "dp0_n"],
  "differentialPairs": [
    { "positive": "dp0_p", "negative": "dp0_n" }
  ]
}
```

只列可连接的信号 ID 和差分能力配对，按需添加 `groups`。省略电源、地、未连接位置和连接器机械资料。

扩展口的 `differentialPairs` 表示能力，允许单端信号绑定 P 或 N 任一脚；不自动补齐或占用另一脚。两脚可承载两个独立单端信号，方向可以不同。只有实际按差分使用时才要求同时占用两脚，校验扩展配对、封装配对和极性。分组勾选本身不指定差分用途。

实际使用性质由固定接口功能差分对与选用的 I/O 标准确定。单端使用要选择允许的单端标准；原始扩展信号选择差分标准时，两脚必须均选中并绑定，方向、标准和配对一致。

## 5. 子卡

```json
{
  "kind": "daughtercard",
  "expansions": [
    { "id": "EXT0", "definition": "header40.expansion.json" }
  ],
  "interfaces": [
    { "id": "UART0", "definition": "uart.fixed.json" }
  ],
  "mappings": [
    { "interface": "UART0", "expansion": "EXT0", "signals": { "tx": "dp0_p", "rx": "dp0_n" } }
  ]
}
```

| 字段 | 用途 |
| --- | --- |
| `expansions[].id`、`definition` | 标识子卡使用的扩展接口，供主板安装映射和配对校验使用 |
| `interfaces[].id`、`definition`、`function` | 引用功能信号和角色方向，供勾选与 AD 绑定使用 |
| `mappings[].interface`、`expansion`、`signals` | 功能信号 ID → 扩展信号 ID → 主板封装脚 |

每根功能信号必须映射一次，不同功能不能映射到同一根扩展信号。一个功能跨多个扩展口时可拆为多张映射表。固定功能差分对要映射到同一个扩展差分对，P/N 极性一致。

上例的 TX/RX 是两个独立单端信号。也可将 RX 改映射为 `io0`，此时未使用的 `dp0_n` 仍可作为原始 GPIO。没有额外的子卡触点、电源或地映射。

## 6. 主板

| 字段 | 用途 |
| --- | --- |
| `device` | 包含封装的完整器件型号，用于选器件规则和工具的器件设置 |
| `ioStandards` | 标准名 → 电气要求；`vccoMv` 检查 Bank 电压，`differential: true` 检查实际差分用途，省略则为单端 |
| `fpgaPins[].id`、`bank` | 输出封装脚约束，定位共享资源和所属 Bank；未知 Bank 可省略 |
| `fpgaPins[].allowedIoStandards` | 限定实际引脚允许的标准；省略表示能力未验证 |
| `fpgaPins[].reservation` | `warn` 提示预留用途，`forbid` 阻止生成；省略表示无预留策略 |
| `differentialPairs` | 器件真实 P/N 配对，检查功能和扩展映射 |
| `banks[].id`、`supplyRail` | 将多个引脚连接到同一 VCCO 资源；供电未知时可省略 `supplyRail` |
| `rails[].id`、`millivolts` | 整数表示固定电压，数组表示允许的可选电压，省略电压表示未知；多个 Bank 可共用一条轨 |
| `interfaces` | 本板固定接口与扩展接口实例，供接线和工程选择引用 |
| `selectors[].id`、`values` | 定义合法复用设置，供条件接线与工程设置引用 |
| `routes` | 接口成员到实际引脚的映射，以及生成条件和默认约束 |

`kind`、`device`、`ioStandards`、`fpgaPins`、`interfaces`、`routes` 必填，其余集合按需填写。`ioStandards` 使用完整、已核实的器件电气要求；本文示例只演示已知的 VCCO 和差分规则，不从标准名推测电气条件。缺少器件规则或方向相关电气要求尚未核实时，结果必须标为未验证。

接线片段：

```json
{
  "interface": "J1",
  "member": "io0",
  "pin": "A9",
  "when": [{ "selector": "JP1", "value": "header" }],
  "fpgaElectrical": { "ioStandard": "LVCMOS33" }
}
```

`interface`、`member`、`pin` 分别定位来源和约束目标；`when` 的全部条件满足才启用此接线。省略 `when` 表示无条件；未设置相关跳线时不能猜测通路。同一成员在一个实际设置下最多一条活动接线；没有接线表示无法导出，不再创建 NC 目标对象。

`fpgaElectrical` 按需包含 `ioStandard`、`driveMa`、`slew`、`pull`，分别用于 I/O 标准、驱动电流、转换速率和上下拉约束。它们都有实际约束用途；空对象省略。绑定的 `ioStandard` 优先于接线默认值，最终标准仍须在引脚允许范围内并满足 Bank 条件。

VCCO 要求只在 `ioStandards` 记录一次。电压统一用整数毫伏。可选供电轨由装配选择实际电压，所有引用该轨的 Bank 一同生效；未知电压不能当作通过。固定功能或原始 GPIO 最终落到同一脚时报告冲突。

## 7. 工程装配和约束输出

| 字段 | 用途 |
| --- | --- |
| `design.kind`、`path`、`module` | 定位 AD 或 HDL 顶层端口；HDL 需要 `module`，AD 从文件读取 |
| `board` | 定位主板定义 |
| `mounts[].id`、`card`、`connections` | 将子卡扩展实例连接到主板扩展实例；映射字段为 `boardInterface` 和 `cardExpansion` |
| `mounts[].installed` | 省略即已安装；`false` 保留配置但停止其活动约束和资源占用 |
| `boardSettings[].selector`、`value` | 确定活动复用接线 |
| `railVoltages[].rail`、`millivolts` | 为可选轨选择允许的实际电压；固定轨无需重复填写 |
| `selections[].interface`、`groups`、`members` | 确定此次生成的接口和成员，至少选择组或成员之一 |
| `bindings[].source`、`port` | 物理信号 → 顶层端口，端口向量位单独写 `bit` |
| `bindings[].ioStandard` | 覆盖接线的默认标准；相同则省略 |
| `export.format`、`path` | 选择 XDC/QSF/LPF/PCF 输出格式和文件路径；具体导出器后续实现 |

只要求 `kind`、`design`、`board`。未安装子卡、未勾选信号的绑定可以保留；活动成员必须有且只有一个有效绑定。

```json
{
  "source": { "mount": "video0", "interface": "HDMI0", "member": "data0_p" },
  "port": { "name": "hdmi_data_p", "bit": 0 }
}
```

`source` 和选择中的接口定位，有 `mount` 时查对应子卡实例，没有则查主板实例。无需再写 board/daughtercard 类型。标量端口省略 `bit`；向量按实际声明索引检查，例如 `[15:8]` 的有效索引为 8–15，允许合法负索引，参数未解析时标为未验证。

主板插槽与子卡扩展定义的规范化文件路径必须一致，且被引用定义为 `expansion`。同一主板扩展口只安装一张子卡，子卡全部扩展实例必须完成安装映射。已安装子卡的全部映射线均保留占用，包括未选用功能的线；剩余未映射线可作为 GPIO。仅取消勾选不会改变真实接线。

## 8. 必须保留的校验

JSON Schema 只检查形状；后续解析器还需检查：

1. 引用路径和目标类型正确，实例、信号与分组 ID 唯一；所有被引用的成员、Bank、供电轨、标准、选择器和角色存在。
2. 每个角色完整覆盖固定信号；多角色实例显式选择，单角色实例使用唯一角色；扩展实例禁止填写角色。
3. 配对不重叠且 P/N 不同；固定功能成对选择，扩展配对可拆为单端；差分用途与标准、方向、极性和真实封装配对一致。
4. 子卡功能映射完整、安装映射匹配、已占用线不能另作 GPIO；不同来源争用同一封装脚或同一端口位时报错。
5. 活动接线唯一且指向可用引脚，复用设置有效，预留策略得到执行；未知跳线和缺失通路阻止相关约束生成。
6. 最终 I/O 标准满足引脚能力及当前供电条件；可选轨的设置合法，共享轨保持一致；电气资料不足时报告未验证。
7. 顶层绑定存在且方向和位索引正确；分组重复选择只生成一次约束；拔卡保留配置、释放活动资源。

## 9. 示例

[JSON Schema](schemas/physical-interface-model.schema.json) 与以下文件采用同一精简形状：

| 文件 | 用途 |
| --- | --- |
| [uart.fixed.json](examples/physical-interfaces/uart.fixed.json) | UART 单角色 |
| [i2c.fixed.json](examples/physical-interfaces/i2c.fixed.json) | I2C 单角色，SCL/SDA 均为 inout |
| [spi.fixed.json](examples/physical-interfaces/spi.fixed.json) | SPI master/slave |
| [hdmi.fixed.json](examples/physical-interfaces/hdmi.fixed.json) | HDMI source/sink，TMDS/DDC/HPD/CEC 部分选用 |
| [header40.expansion.json](examples/physical-interfaces/header40.expansion.json) | 四个可拆为单端的差分能力对，另有四根单端信号 |
| [hdmi.daughtercard.json](examples/physical-interfaces/hdmi.daughtercard.json) | 功能信号直接映射扩展信号 |
| [carrier.board.json](examples/physical-interfaces/carrier.board.json) | 引脚、Bank、I/O 规则和 UART/排针复用 |
| [demo.assembly.json](examples/physical-interfaces/demo.assembly.json) | 子卡安装与 TMDS 选择，绑定继承主板默认标准 |
| [top.ad](examples/physical-interfaces/top.ad) | 使用现有 AD V2 格式的顶层端口 |

所有器件型号、引脚、Bank 与电气值都是演示数据，不能用于实物。已有未发布草案直接修订，不增加兼容层；现有 AD 格式保持原样。
