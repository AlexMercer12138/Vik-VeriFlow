# 物理接口、板卡与子卡模型 V1

状态：2026-10-15。板卡硬件契约已确定；插件已接入板卡/接口读取、AD 持久绑定、RTL 临时绑定和 XDC 导出。子卡安装与 `assembly` 仍为模型定义，尚未接入操作面板。使用方式见 [引脚绑定与 XDC](physical-pin-bindings.md)。

## 1. 字段取舍

字段至少满足以下一项才保留：能输出约束、影响约束生成、参与引脚复用或电平检查、承担跨模型映射。能够从其他字段确定的信息不重复记录，省略的可选集合按空集合处理。

| 取舍 | 内容与原因 |
| --- | --- |
| 删除 | 文档级 `id`、`revision`、`name`、`description`、`format`、`schemaVersion`、`$schema`；文件路径已经定位定义，说明移到本文 |
| 删除 | 信号与实例显示名称、差分对 ID、跳线的物理类型、自由文本 `capabilities`；没有独立的生成或校验用途 |
| 简化 | `signals` 直接列 ID 字符串；引用写相对路径或内置接口路径；接线直接写 `pin`；来源有 `mount` 即表示子卡，无需重复来源类型 |
| 简化 | 完整器件型号写在 `device` 一个字段；电压直接写整数或允许值数组，不再额外写 fixed/selectable/unknown |
| 分离 | 主板只记录硬件事实；删除 `ioStandards`、`allowedIoStandards`、`fpgaElectrical` 和绑定中的 `ioStandard`。厂商约束与标准选择归生成器管理 |
| 保留 | 分组与选择、角色方向、实际引脚和差分配对、Bank 与供电轨、复用条件、子卡安装和信号映射、AD/HDL 端口绑定、输出格式与路径 |

物理模型只用一个 `kind` 区分五类文件：`fixed`、`expansion`、`board`、`daughtercard`、`assembly`。Schema 拒绝未知属性。Schema 文件本身的 `$schema` 等是验证器元数据，不属于物理数据。

## 2. 引用和 ID

一份文件只定义一个模型，文件名承担定义名称。用户模型使用相对包含该引用的文件的路径，例如 `"definition": "spi.fixed.json"`、`"board": "carrier.board.json"`。接口的 `definition` 也可使用 `library:interfaces/<文件名>.json` 引用插件内置接口；不接受绝对路径、其他 URI 或库路径中的子目录。加载时规范化路径并检查被引用模型的 `kind`，不按相似文件名自动替换。若要同时维护不同硬件版本，使用不同文件路径。

VSIX 内置 `uart.fixed.json`、`i2c.fixed.json`、`spi.fixed.json`、`rgb.fixed.json`、`hdmi.fixed.json` 和 `header40.expansion.json`，来源为仓库的 `docs/examples/physical-interfaces`。板卡、子卡、装配模型及板卡专用接口留在用户工程或仓库示例中，不随插件打包。子卡/装配对接口的库引用属于数据契约，安装面板仍待接入。

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
| `bus` | 数值位宽展开物理成员，或用有序成员数组组成拖放总线；用于批量绑定与位宽校验 |

`groups`、`differentialPairs`、`bus` 可省略。每个方向表恰好覆盖 `signals`，方向始终相对 FPGA 顶层端口。同一功能差分对在每个角色下 P/N 方向一致。未定义位宽的信号表示一根标量线。

`"bus": {"pdata": 24}` 要求 `signals` 含 `pdata`，路由/子卡映射使用展开后的 `pdata.23` 至 `pdata.0`。方向仍由 `function[角色].pdata` 定义。差分对可以引用两个等宽逻辑总线，逐位展开配对。

`"bus": {"data_p": ["data2_p", "data1_p", "data0_p"]}` 将已有标量组成别名，数组成员必须存在且不重复，别名不得覆盖 `signals`。板卡原有路由无需改写。数组顺序对应 RTL 声明从左到右：绑定 `[2:0] tmds_data_p` 时 `data2_p → [2]`；绑定 `[4:6]` 时第一个成员对应 `[4]`。固定差分信号会一起绑定同名 `_p`/`_n` 端口，要求两侧索引一致。缺少对应端口、位宽不一致或 P/N 反接会提示错误。

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

只列可连接的信号 ID 和差分能力配对，按需添加 `groups`、`bus`。省略电源、地、未连接位置和连接器机械资料。

扩展口的 `differentialPairs` 表示能力，允许单端信号绑定 P 或 N 任一脚；不自动补齐或占用另一脚。两脚可承载两个独立单端信号，方向可以不同。只有实际按差分使用时才要求同时占用两脚，校验扩展配对、封装配对和极性。分组勾选本身不指定差分用途。

实际使用性质由映射的固定接口定义确定，不能因为扩展口标有 P/N 就输出差分约束。直接绑定原始扩展脚时按独立单端使用；要作为差分接口使用，应先映射到带功能差分对的固定接口。生成器再检查器件是否支持该用途。

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

主板描述实际焊接和接线关系，不指定 XDC、QSF 等输出命令，也不保存 I/O 标准、驱动电流、转换速率、内部上下拉等生成选项。

| 字段 | 用途 |
| --- | --- |
| `vendor` | 厂商键，例如 `amd`、`intel`、`lattice`，用于选择生成器和器件规则 |
| `device` | 包含封装的完整器件型号，用于选器件规则和工具的器件设置 |
| `fpgaPins[].id`、`bank` | 输出封装脚约束，定位共享资源和所属 Bank；未知 Bank 可省略 |
| `fpgaPins[].reservation` | `warn` 提示预留用途，`forbid` 阻止生成；省略表示无预留策略 |
| `differentialPairs` | 封装真实 P/N 配对，检查功能和扩展映射；可用电气模式仍由器件规则判断 |
| `banks[].id`、`supplyRail` | 将多个引脚连接到同一 VCCO 资源；供电未知或属于没有普通 VCCO 的收发器 Bank 时省略 `supplyRail` |
| `rails[].id`、`millivolts` | 整数表示固定电压，数组表示允许的可选电压，省略电压表示未知；多个 Bank 可共用一条轨 |
| `interfaces` | 本板固定接口与扩展接口实例，供接线和工程选择引用 |
| `selectors[].id`、`values` | 定义合法复用设置，供条件接线与工程设置引用 |
| `routes` | 接口成员到实际引脚的接线，以及使接线成立的硬件条件 |
| `clocks[].interface`、`member`、`frequencyHz` | 板载振荡器接到哪个输入以及其实际频率；生成器据此计算周期，差分时钟只引用正端 |

`kind`、`vendor`、`device`、`fpgaPins`、`interfaces`、`routes` 必填，其余集合按需填写。厂商键使用小写，器件型号保留完整封装、速度等级等信息；不能只从型号前缀猜厂商。`clocks` 只写实际已知的板载时钟，不猜测外部输入或设计内部产生的时钟频率。

接线片段：

```json
{
  "interface": "J1",
  "member": "io0",
  "pin": "A9",
  "when": [{ "selector": "JP1", "value": "header" }]
}
```

`interface`、`member`、`pin` 分别定位来源和约束目标；`when` 的全部条件满足才启用此接线。省略 `when` 表示无条件；未设置相关跳线时不能猜测通路。同一成员在一个实际设置下最多一条活动接线；没有接线表示无法导出，不再创建 NC 目标对象。

生成器沿 `route.pin → fpgaPins[].bank → banks[].supplyRail → rails[].millivolts` 取得实际供电，再结合 `vendor`、`device`、接口角色、单端/差分用途和端口方向选择厂商约束。比如同一根扩展脚映射为 UART 时按单端生成，映射为差分接口时再按成对用途判断；主板文件不为它预设一种标准。

电压统一用整数毫伏。可选供电轨由装配选择实物当前电压，所有引用该轨的 Bank 一同生效；允许值数组不暗示出厂跳线位置，装配设置也不会改变实物跳线。固定功能或原始 GPIO 最终落到同一脚时报告冲突。`when` 表示真实开关/跳线；始终相连的接口即使共享引脚也不能虚构互斥条件。

Bank 电压不是完整电气规则：同电压下 GPIO、DDR4、MIPI 和专用 GT 的配置不同，差分配对也不保证支持任意差分标准。器件的引脚类型、输入/输出能力与接口使用方案由生成器的器件/接口规则提供，不在每块板里重复抄写。缺少规则、未知 Bank 或未知 VCCO 时不能猜约束；没有普通 VCCO 的 GT 应交给专用规则。板外负载、连接器兼容性和 IP 时序约束也不能仅凭 Bank 电压判为通过。以后需要手动生成选项时放在独立生成配置中，不回填到主板和端口绑定。

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

1. 引用路径和目标类型正确，实例、信号与分组 ID 唯一；所有被引用的成员、Bank、供电轨、选择器和角色存在。
2. 每个角色完整覆盖固定信号；多角色实例显式选择，单角色实例使用唯一角色；扩展实例禁止填写角色。
3. 配对不重叠且 P/N 不同；固定功能成对选择，扩展配对可拆为单端；差分用途与方向、极性和真实封装配对一致，生成器再检查器件支持的电气模式。
4. 子卡功能映射完整、安装映射匹配、已占用线不能另作 GPIO；不同来源争用同一封装脚或同一端口位时报错。
5. 活动接线唯一且指向可用引脚，复用设置有效，预留策略得到执行；未知跳线和缺失通路阻止相关约束生成。
6. 可选轨的设置合法，共享轨保持一致；生成器独立检查最终标准是否满足器件能力、用途和当前供电，电气资料不足时报告未验证。板载时钟必须映射到输入，差分时钟只定义一次。
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
| [carrier.board.json](examples/physical-interfaces/carrier.board.json) | 引脚、Bank、供电和 UART/排针复用 |
| [demo.assembly.json](examples/physical-interfaces/demo.assembly.json) | 子卡安装、TMDS 选择和顶层端口绑定 |
| [top.ad](examples/physical-interfaces/top.ad) | 使用现有 AD V2 格式的顶层端口 |

以上演示目录中的器件型号、引脚、Bank 与电气值不能用于实物。真实板卡见 [ATK AU15P 核心板 + 底板 V1.0](boards/atk-au15p/README.md)。已有未发布草案直接修订，不增加兼容层；AD V2 增加可选 `physical` 和 `export.xdcOutput`，已有文件不需要迁移。

运行 `node scripts/verify-physical-models.cjs` 校验全部模型的 Schema、引用、角色、总线展开、接线完整性、差分极性、Bank 与电源引用。插件也会校验所加载板卡与绑定；首版器件规则支持 AU15P，DDR/MIPI 数据线需要 IP 电气规则，当前会阻止导出。离线校验和导出校验均不代替实物及厂商工具验证。
