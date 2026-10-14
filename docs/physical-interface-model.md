# 物理接口、板卡与子卡模型 V1

状态：2026-10-14 数据契约草案，供常用接口录入与评审。Schema 与示例已同步；插件尚未读取这些文件，也尚未实现 AD 集成、冲突检查与约束导出。

本次修订删除信号驱动方式、完整连接器触点表及子卡供电建模，保留实际参与引脚约束的信号。尚未发布的数据契约继续使用 V1，已有草案示例直接按新形状修订。

## 1. 数据分工

| 文档 | `format` | 记录内容 |
| --- | --- | --- |
| 固定接口 | `veriflow-physical-interface`，`kind: fixed` | 功能信号、角色方向、可选分组和差分对 |
| 扩展接口 | `veriflow-physical-interface`，`kind: expansion` | 可连接的单端信号和差分信号 |
| 主板 | `veriflow-board` | 接口实例、信号到封装脚的接线、Bank 电平及复用设置 |
| 子卡 | `veriflow-daughtercard` | 所用扩展接口、功能接口和两者之间的信号 ID 映射 |
| 工程装配 | `veriflow-board-assembly` | 安装位置、功能勾选与 AD/HDL 顶层端口绑定 |

固定接口与扩展接口只有两类。固定接口可以拥有多个角色，子卡通过这两类接口的映射组成。

```text
AD 顶层端口 ↔ 子卡功能信号 → 扩展接口信号 ID → 主板 FPGA 封装脚
AD 顶层端口 ↔ 主板固定接口信号 → 主板 FPGA 封装脚
```

接口定义只描述可用信号；主板保存具体封装脚；子卡保存信号对应关系。GPIO、接口分组和子卡功能最后都解析到同一份主板封装脚记录，便于检查复用与电平冲突。

## 2. 通用字段

所有文档包含 `format`、`schemaVersion: 1`、`id`、`revision`、`name`；可填写 `description`、编辑器用的 `$schema`。Schema 拒绝未知字段。

- 文档与实例 ID：`[A-Za-z_][A-Za-z0-9_.-]*`，区分大小写。
- 信号与封装脚 ID：允许数字开头，匹配 `[A-Za-z0-9_][A-Za-z0-9_.-]*`；ID 是映射键，显示名称可另填 `name`。
- `revision`：定义自身的版本，如 `1` 或硬件版本 `rev-a`。正式使用后改变信号、接线或电气条件应建立新 revision。
- 引用格式：`{ "path": "spi.fixed.json", "id": "fixed.spi.fpga", "revision": "1" }`。路径相对包含引用的文档解析，同时核对 ID 与 revision。
- 同一 ID/revision 的定义不能存在不同内容，不能按显示名称或相似接口自动替换。

## 3. 固定接口：信号共用，角色选择方向

`signals` 每项只记录 `id`，可附 `name`、`description`。删除 `drive` 与信号级的固定 `direction`，不记录推挽/开漏，也不由物理模型生成这种驱动行为。

`function` 放在 `signals` 后面，与其同级，表示“功能角色 → 信号方向表”。每个角色必须完整描述同一组信号，方向始终以 FPGA 顶层端口为视角：

```json
{
  "kind": "fixed",
  "signals": [
    { "id": "sck" },
    { "id": "cs_n" },
    { "id": "mosi" },
    { "id": "miso" }
  ],
  "function": {
    "spi-master": {
      "sck": "output",
      "cs_n": "output",
      "mosi": "output",
      "miso": "input"
    },
    "spi-slave": {
      "sck": "input",
      "cs_n": "input",
      "mosi": "input",
      "miso": "output"
    }
  }
}
```

以上为固定接口字段片段，完整文件还需通用字段、`groups` 与 `differentialPairs`。角色键使用明确名称，如 `spi-master`、`hdmi-source`；宿主读取对应方向表，不根据名字猜测方向或自动反转。

接口实例引用一份定义，并通过 `function` 选择角色：

```json
{
  "id": "SPI0",
  "definition": { "path": "spi.fixed.json", "id": "fixed.spi.fpga", "revision": "1" },
  "function": "spi-slave"
}
```

固定接口实例必须显式选择已定义的角色，即使只有一个；扩展接口实例不填写 `function`。角色在主板或子卡的功能接口实例上保存，以匹配该硬件的实际用途。

同一接口定义可以用于不同角色的实例，信号 ID、分组与接线保持稳定。切换实例角色后重查 AD 端口方向；选择另一个角色不会改变板卡电路，也不保证原硬件支持反向使用。

| 接口 | function 角色 | 方向规则 |
| --- | --- | --- |
| UART | `uart` | TX 输出，RX 输入 |
| I2C | `i2c` | SCL/SDA 均为 inout，支持双向总线与时钟延展；主从方向相同，共用一个角色 |
| SPI | `spi-master`、`spi-slave` | SCK/CS/MOSI 与 MISO 分别按角色指定方向 |
| HDMI | `hdmi-source`、`hdmi-sink` | TMDS 数据与时钟：source 输出、sink 输入；HPD：source 输入、sink 输出；DDC 与 CEC 均为 inout |

I2C、DDC、CEC 的总线驱动和释放由 RTL 实现，模型只检查顶层方向。这里的方向也不会直接导出为 XDC；它用于 AD 端口创建建议与绑定校验。

一个信号表示一根标量线，向量展开为多个信号 ID 后分别绑定端口位。差分信号独立列出 P/N，并用 `differentialPairs` 声明配对。

### 分组与部分选用

`groups` 保存 `{ id, name, members, selection }`：

- `individual`：整组选中时包含全组，允许再选用部分成员。
- `together`：任一成员启用时必须启用全组。
- 固定接口的功能差分对始终成对启用，不允许只选 P 或 N；扩展接口的差分能力配对允许单脚作为单端使用。

固定接口的信号、分组和差分对不随角色复制。HDMI 共用 `tmds`、`ddc`、`hpd`、`cec` 分组；切换 source/sink 只改变该实例的方向表。

选择展开时合并显式成员与组成员，反复补齐整体分组和固定接口的功能差分对，直到集合不再改变。扩展接口的配对本身不触发补齐。同一信号属于多个分组时去重。取消选择也遵守对应的整体分组与功能成对选择规则；不根据协议名称强制添加其他可选功能。

## 4. 扩展接口：仅列出可连接信号

扩展接口只记录可供 FPGA 使用的信号 ID。差分对的 P/N 也各列为一个信号，并由 `differentialPairs` 配对：

```json
{
  "kind": "expansion",
  "signals": [
    { "id": "io0" },
    { "id": "io1" },
    { "id": "dp0_p" },
    { "id": "dp0_n" }
  ],
  "differentialPairs": [
    { "id": "dp0", "positive": "dp0_p", "negative": "dp0_n" }
  ]
}
```

以上为字段片段。扩展接口的 `groups` 可省略，需要批量选用时再定义。没有出现在差分对中的信号只提供单端连接；`differentialPairs` 表示配对能力，P/N 本身也是两根可独立使用的信号，不限定为差分用途。

单端信号可映射到 `dp0_p` 或 `dp0_n` 任一脚，无需新增使用模式字段。单独选用一脚不自动勾选或占用另一脚；两脚也可分别承载两个独立单端信号，方向可以不同。扩展口分组使用 `individual` 时允许拆选，勾选整个分组只表示批量选择，不自动切换为差分用途。

实际按差分功能使用时，功能接口的 `differentialPairs` 要求同时映射 P/N，检查扩展配对、封装配对与极性，并占用两脚。最终按主板允许的 I/O 标准和 Bank 条件检查电气合法性；单端使用须选择合适的单端 I/O 标准，不能沿用差分标准。

删除机械规格、完整触点编号表、触点角色、连接器对接规则，以及电源、地、NC 信号。物理位置有助于查资料时可放在信号的 `name` 或 `description` 中，不要求补齐排针所有位置。

40 PIN 示例只列出已连接 FPGA 的可用信号；FMC 同样只列出需要参与映射的单端或差分信号，例如 `LA00_P`、`LA00_N`。实际板卡未连接或不可用的信号省略，不创建占位信号。

不同扩展接口的信号 ID 不应因显示名称相似而自动匹配。子卡引用具体扩展接口定义及版本，安装时检查主板插槽引用的定义一致。信号的最终可用性、差分配对与电平仍按主板接线校验。

## 5. 子卡：直接映射到扩展信号 ID

子卡的主要字段只有：

| 字段 | 内容 |
| --- | --- |
| `expansions` | 子卡使用的扩展接口定义引用，通常只有一个 |
| `interfaces` | 子卡提供的固定功能接口实例，包括所选 function |
| `mappings` | 功能信号 ID 到对应扩展信号 ID 的映射 |

映射示例：

```json
{
  "interface": "HDMI0",
  "expansion": "EXT0",
  "signals": {
    "data0_p": "dp0_p",
    "data0_n": "dp0_n",
    "data1_p": "dp1_p",
    "data1_n": "dp1_n",
    "data2_p": "dp2_p",
    "data2_n": "dp2_n",
    "clock_p": "dp3_p",
    "clock_n": "dp3_n",
    "ddc_scl": "io0",
    "ddc_sda": "io1",
    "hpd": "io2",
    "cec": "io3"
  }
}
```

`interface` 引用子卡功能接口实例；`expansion` 引用 `expansions` 中的实例；`signals` 的键是功能信号 ID，值是扩展接口信号 ID。一块子卡提供多个功能接口时，各建一张表；使用多个扩展接口时可把一个功能接口分为多张表，每根功能信号仍只能映射一次。

单端功能同样直接引用扩展信号 ID。例如 UART 的 TX/RX 可以分别使用同一差分能力配对的两脚，仍按两个独立单端信号处理：

```json
{
  "interface": "UART0",
  "expansion": "EXT0",
  "signals": { "tx": "dp0_p", "rx": "dp0_n" }
}
```

如果只将 TX 映射到 `dp0_p`，而 RX 映射到其他信号，则 `dp0_n` 仍可供其他单端功能或原始 GPIO 使用；占用检查按每根实际映射的信号处理。

不再创建子卡连接器触点、供电要求、地映射、条件接线或电平转换元件表。信号电气约束在主板层维护；需要记录子卡说明时使用文档的 `description`。

### 安装

工程指定子卡放在哪个扩展接口上：

```json
{
  "id": "video0",
  "card": { "path": "hdmi.daughtercard.json", "id": "daughtercard.demo.hdmi", "revision": "rev-a" },
  "installed": true,
  "connections": [
    { "boardInterface": "J1", "cardExpansion": "EXT0" }
  ]
}
```

之后直接合成：

```text
video0.HDMI0.data0_p → EXT0.dp0_p → J1.dp0_p → FPGA.A1
```

同一主板扩展口同时只安装一张子卡；子卡声明的全部扩展实例必须有安装位置。两张相同子卡通过不同挂载 ID 区分。

`installed: false` 保留勾选与绑定，但停止输出其活动约束和占用。已安装子卡的全部映射信号均保留占用，包括未勾选功能对应的信号；剩余未被子卡映射的 GPIO 可直接使用。软件里的安装状态和角色选择描述用户配置，不控制硬件。

## 6. 主板：接线与电平检查

主板保留具体约束需要的信息：

- `device`：厂商、完整器件与封装。
- `fpgaPins`：封装脚 ID，可附 Bank、能力、允许 I/O 标准与预留策略。
- `differentialPairs`：器件真实差分配对。
- `banks`、`rails`：Bank 与其供电电压。这是电平检查数据，不是扩展接口的电源信号列表。
- `interfaces`：固定/扩展接口实例。
- `selectors`、`routes`：硬件复用设置和信号到封装脚的接线。

单条接线示例：

```json
{
  "interface": "J1",
  "member": "io0",
  "target": { "kind": "fpga", "pin": "A9" },
  "when": [{ "selector": "JP1", "value": "header" }],
  "fpgaElectrical": { "ioStandard": "LVCMOS33", "vccoMv": 3300 }
}
```

`when` 可省略；填写时所有条件满足才生效。一个成员同一硬件设置下最多一条接线；缺少跳线设置时标记未确定，不猜测接线。

固定接口和 GPIO 引用同一封装脚表示共享资源；活动信号冲突必须报告。取消功能勾选不会改变真实硬件连接。未连接或预留状态只在主板接线中记录，扩展接口不列电源、地或空位置。

封装脚预留策略可为 `{ policy: "warn" | "forbid", reason }`；前者提示用途，后者禁止选用。I/O 驱动的推挽/开漏不再建模；`fpgaElectrical.driveMa` 则是可选的驱动电流约束，和驱动方式无关，仍可保留。

电压使用整数毫伏。Bank 引用供电轨，电压可以固定、可选或未知；工程仅为可选轨记录允许的电压。检查已知 VCCO 与 I/O 标准，资料不足时报告未验证。子卡信号接入后继承主板扩展口的引脚约束；本版不检查子卡供电、机械对接或转换电路。

## 7. AD 绑定与约束生成

装配 `design` 指向 AD 文件，或 HDL 文件与顶层模块；现有 AD V2 不改格式。物理接口分组与绑定显示在 AD 编辑器中，数据保存在装配文档。

`selections` 按接口实例选择组和成员；`bindings` 把物理成员绑定到顶层端口：

```json
{
  "source": { "kind": "daughtercard", "mount": "video0", "interface": "HDMI0", "member": "data0_p" },
  "port": { "name": "hdmi_data_p", "bit": 0 },
  "ioStandard": "TMDS_33"
}
```

端口名与位索引分开保存。标量省略 `bit`；向量按照实际声明索引检查，例如 `[15:8]` 的合法索引是 8–15。参数范围未解析时不猜测，允许 HDL 实际范围内的负索引。

固定接口方向取自实例选择的 `function`，不能使用另一个角色的方向表；扩展口原始 GPIO 的方向来自绑定端口。AD 成组接口先展开为实际导出的顶层端口，不能把内部网当作封装端口。

未勾选信号的绑定可以保留；活动成员必须有且只有一个有效绑定。同一成员多次分组选中只生成一次约束；不同成员争用同一封装脚或端口位时报错。

导出格式标识先保留 XDC、QSF、LPF、PCF，具体导出器后续实现。SDC 时序约束单独管理。function 用于功能角色选择与方向检查，不直接输出为约束字段。

## 8. 校验规则

JSON Schema 检查字段形状；跨文档语义由后续解析器负责：

1. ID、引用和版本正确；信号与分组 ID 唯一，所有组成员与差分成员存在。
2. 每个 function 方向表恰好覆盖固定接口全部信号；同一差分对在每个角色下 P/N 方向一致。实例的 function 存在，扩展实例禁止填写 function。
3. 差分对不重叠，正负成员不同。固定功能差分对必须成对选择；扩展能力配对允许拆为单端，不能因配对记录而自动补齐另一脚。分组与去重规则按上述定义处理。
4. 子卡引用的扩展定义与安装位置一致；功能信号到扩展信号的映射完整，每根功能信号只能映射一次，不同功能信号不能占用同一扩展信号。
5. 功能差分对映射到扩展差分对，再映射到真实封装差分对；P/N 必须一致。单端功能信号可按主板允许条件使用一根差分能力引脚，此时按单端约束处理，不能默认为差分功能。
6. 已安装子卡映射占用的信号不能另作原始 GPIO；拔卡后恢复可用。两个主板接口引用同一封装脚时，继续检查最终资源冲突。
7. 主板接线终止于可用封装脚；NC、禁止使用、跳线未确定或断开路径阻止活动约束导出。
8. 固定接口按选定角色校验顶层方向，检查真实位索引；角色切换后重新校验，不自动改写 HDL。
9. 检查已知 Bank 电压、I/O 标准、差分配对与预留用途；无法确认电气合法性时显示未验证，不把接口名称当作器件规则。

差分能力的扩展信号被单端功能或原始 GPIO 使用时，仅占用实际使用的脚；另一脚未被映射或占用时仍可使用。真正的差分功能占用两脚，与任一脚的单端使用冲突。最终差分校验依据实际功能信号和 I/O 标准，不能仅因扩展口记录了配对就强制成对选择或使用差分 I/O 标准。

## 9. 录入模板与示例

[JSON Schema](schemas/physical-interface-model.schema.json) 与全部示例同步修订：

| 文件 | 用途 |
| --- | --- |
| [uart.fixed.json](examples/physical-interfaces/uart.fixed.json) | 单角色 UART |
| [i2c.fixed.json](examples/physical-interfaces/i2c.fixed.json) | 单一 I2C 角色，SCL/SDA 均为 inout |
| [spi.fixed.json](examples/physical-interfaces/spi.fixed.json) | 共用信号的 SPI master/slave |
| [hdmi.fixed.json](examples/physical-interfaces/hdmi.fixed.json) | HDMI source/sink 与部分分组选用 |
| [header40.expansion.json](examples/physical-interfaces/header40.expansion.json) | 四个差分对、四根单端信号；省略非信号触点 |
| [hdmi.daughtercard.json](examples/physical-interfaces/hdmi.daughtercard.json) | 功能信号到扩展信号 ID 的直接映射 |
| [carrier.board.json](examples/physical-interfaces/carrier.board.json) | 扩展信号到封装脚，以及 UART/GPIO 复用 |
| [demo.assembly.json](examples/physical-interfaces/demo.assembly.json) | 子卡安装到 J1，只启用 TMDS |
| [top.ad](examples/physical-interfaces/top.ad) | 对应的现有 AD V2 顶层端口 |

录入常用接口时：

- 固定接口：列信号 ID，给出每个 function 角色的完整方向表，再添加分组与差分对。
- 扩展接口：只列可连接信号 ID 和差分配对，需要时添加批量选择分组。
- 子卡：引用扩展接口和固定接口，选择固定接口角色，填写功能信号 ID → 扩展信号 ID。
- 主板：填写接口信号 ID → FPGA 封装脚及实际电平、Bank、复用或预留信息。

示例器件、引脚、Bank 和电气值为演示数据，不能用于实物。录入真实主板资料时再替换这些值。现阶段仅交付模型；后续验证至少覆盖多个角色的方向、HDMI 部分启用、子卡映射、差分脚拆为单端、差分极性、拔卡、GPIO 复用与 Bank 电平冲突。
