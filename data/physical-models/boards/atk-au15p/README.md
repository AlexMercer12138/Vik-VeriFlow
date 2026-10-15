# ATK AU15P 核心板 + 底板 V1.0

[board.json](board.json) 描述核心板与底板连接后的硬件，器件为 AMD `xcau15p-ffvb676-2-i`。21 个接口（含两组独立 MIPI 控制接口）、274 个封装脚、302 条接口接线；不同接口可以引用同一个物理脚。模型不包含 I/O 标准和厂商约束命令，格式见 [物理模型规范](../../../../docs/physical-interface-model.md)。此板卡仅作为仓库示例，不打包进 VSIX；在约束面板使用 **Import board…** 导入用户配置后，任意工程都可选择使用，不必逐工程复制。流程和电气规则范围见 [使用说明](../../../../docs/physical-pin-bindings.md)。

## 来源与覆盖范围

依据用户提供的两份原理图逐页提取网名，并对照连接器及电路图核对接线。页码均为 PDF 页码，未将原理图文件复制入仓库。

| 原文件 | 原理图标题版本 | 使用内容 |
| --- | --- | --- |
| `AU15P_CORE_1V0_USER.pdf` | `AU15P_CORE_1V0_USER_250402`，V1.0 | 第 2–5 页封装脚、Bank 和 P/N 配对，第 3/8 页 DDR4，第 9 页 100 MHz 时钟，第 10–12 页板间连接 |
| `AU15P_BASE_1V0_USER.pdf` | `AU15P_BASE_1V0_USER_250311`，V1.0 | 第 1 页板间网名与封装脚，第 2 页供电与 156.25 MHz 时钟，第 3–11 页外设与复用 |

| 接口 ID | 信号数 | 原理图与范围 |
| --- | ---: | --- |
| `SYS_CLK` | 2 | CORE 2/9；G1 100 MHz 差分输入，V24/W24 |
| `DDR4` | 50 | CORE 3/8；x16 数据、两组 DQS、DM、地址/命令及差分时钟，固定 1.2 V |
| `UART1` | 2 | BASE 1/8；CH340E，FPGA TX=W16、RX=Y16 |
| `I2C4` | 2 | BASE 1/8；RTC、EEPROM 与 FMC 共用，SCL=AC13、SDA=AC14 |
| `ETH1` | 15 | BASE 1/5；YT8531C 的 RGMII、MDIO/MDC 与复位 |
| `LED` / `KEY` / `FAN` | 2 / 3 / 1 | BASE 1/9；两颗用户 LED、两个按键和复位按键、风扇 PWM |
| `SD` | 7 | BASE 1/9；CLK/CMD/D0–D3/CD，与 J16 共享六根总线信号 |
| `CAN1` / `RS4851` | 2 / 2 | BASE 9–11；FPGA 侧 TX/RX，分别经 J17/J18 选择；RS485 自动收发方向电路没有独立 FPGA DE 信号 |
| `J19` | 4 | BASE 11；ATK 模块扩展口 RXD/TXD 和 KEY/LED，分别受 J17/J18 控制 |
| `HDMI_OUT` | 8 | BASE 1/4/11；四组 TMDS，经过 U17/U18 和 AC 耦合网络 |
| `MIPI_CSI` / `MIPI_CSI_CTRL` | 10 / 5 | BASE 1/10；通用四 lane/时钟与板卡相机控制分开 |
| `MIPI_DSI` / `MIPI_DSI_CTRL` | 10 / 6 | BASE 1/10/11；通用四 lane/时钟与板卡背光/触摸控制分开 |
| `J16` | 36 | BASE 11；40 PIN 扩展口的 5–40 号脚，使用连接器脚号作为信号 ID |
| `FMC_LPC` | 75 | BASE 1/3/8；LA00–LA33 共 34 对、两对 M2C 时钟、SCL/SDA、PG_C2M |
| `QSFP` | 25 | BASE 1/2/6；四条 GT TX/RX、管理信号、156.25 MHz 板载参考时钟 |
| `PCIE` | 35 | BASE 1/7；x8 GT TX/RX、外部参考时钟和复位 |

通用接口位于 ../../interfaces，本目录只保留板卡专用信号定义。固定接口的方向相对 FPGA。J19 用连接器原有的 RXD（4 号脚）、TXD（3 号脚）、KEY（2 号脚）、LED（1 号脚）作为扩展信号 ID，具体方向由所接子卡定义。DDR4 的 `odt` 对应原理图拼作 `DDR4_OTD` 的网名，`ras/cas/we` 对应 A16/A15/A14 命令复用脚；不额外虚构一组地址脚。

## Bank 供电

| Bank | 电源轨 | 实物选择方式 |
| --- | --- | --- |
| 64 | `VCCIO_B64`：1.2 / 1.8 V | J4：1–2 为 1.8 V，2–3 为 1.2 V |
| 65 | `VCCIO_B65`：1.2 / 1.8 V | J5：1–2 为 1.8 V，2–3 为 1.2 V |
| 66 | `DDR_1V2`：固定 1.2 V | 核心板 DDR4 供电 |
| 84 | `VCCIO_B84`：固定 3.3 V | 底板 L6 |
| 85 | `VCCIO_B85`：1.8 / 2.5 / 3.3 V | J24：1–2 为 3.3 V，3–4 为 2.5 V，5–6 为 1.8 V |
| 86 | `VCCIO_B86`：1.8 / 2.5 / 3.3 V | J25：位置同 J24，独立选择 |
| 224 / 225 / 226 | GT 专用 Bank，无普通 GPIO VCCO | 不填写 `supplyRail`，由器件的专用收发器规则处理 |

允许电压不代表当前实物供电。约束面板先从板卡允许值选择 Bank 电压，再由用户选择合法 IO 标准。例如 1.8V HP Bank 不会列出 `TMDS_33`，本板 HDMI 可按实际电路选择 `LVDS`。外部电路、VREF、终端及 DDR/MIPI/GT 的 IP 参数由用户设计配置。

## 复用与共享接线

- `J22=hdmi`：J22 1–2，U17/U18 选择 HDMI；`J22=dsi`：J22 2–3，选择 DSI 数据 lane。DSI 的时钟和控制线直接连接，不受 J22 切换。
- `J17=can`：短接 1–3、2–4；`J17=atk`：短接 3–5、4–6。选择 CAN TX/RX 或 ATK 模块串口。
- `J18=rs485`：短接 1–3、2–4；`J18=atk`：短接 3–5、4–6。选择 RS485 TX/RX 或 ATK 模块 KEY/LED。
- J16 始终连接原网，选择 CAN/RS485/ATK 不会断开排针；SD 总线与 DSI 触摸控制也和 J16 共享。JSON 用相同封装脚表达复用，不记录条件 `when`。
- I2C4 与 FMC 的 SCL/SDA 通过 R82/R83 的 0 Ω 电阻相连，是同一总线的两种访问位置。绑定时选择一个入口，不把它们作为两套独立 I2C 引脚。

HDMI/DSI 数据 lane 的实际交换关系如下，均保持 P→P、N→N：

| FPGA 网 | 封装 P / N | HDMI | DSI |
| --- | --- | --- | --- |
| `HDMI_DSI_IO0` | AC18 / AD18 | data0 | d0 |
| `HDMI_DSI_IO1` | AD16 / AE16 | clock | d1 |
| `HDMI_DSI_IO2` | AB17 / AC17 | data2 | d3 |
| `HDMI_DSI_IO3` | AF18 / AF19 | data1 | d2 |

J16 的差分伙伴不一定是相邻脚，例如 5/7 为 G10/G9，6/8 为 J11/J10。扩展定义中的 18 对只表示配对关系，两端可以分别映射单端信号；器件是否支持指定电气模式仍由生成器检查。FMC 的 `LA00_CC`、`LA01_CC`、`LA17_CC`、`LA18_CC` 保留原连接器 ID。

## 明确未纳入的连接

- HDMI 的 DDC、HPD、CEC 未接 FPGA；只提供真实的四组 TMDS，不复用带完整边带信号的 HDMI 模板。
- FMC 的 DP0/GTH 通道未接通，不因连接器上有名称就列为可用信号；FMC JTAG 属配置链，不作为用户 IO。
- 核心板配置 Flash、JTAG、DONE/PROG_B、XADC 和 VBATT 不属于本次用户数字接口约束范围，不伪装成普通 GPIO。PCIe 未接通的 SMBus、WAKE 等也不录入。
- `ADJ_PWR_EN` 是板间供电控制线，原理图没有普通 FPGA IO 封装脚映射；不将邻近的 VBATT Y9 错配给它。
- 这里只覆盖所列接口的已连接封装脚，不声称列出了器件全部焊球。未录入的脚不应被当成空闲资源。

## 校验

仓库根目录运行 `node scripts/verify-physical-models.cjs`。检查全部 JSON 的 Schema、文件引用、信号/角色覆盖、组与差分配对、Bank/电源引用、接线完整性和时钟来源；并固定核对本板若干关键引脚与 lane 交换关系。原理图页码用于人工复查，离线校验不替代实物测试或厂商工具的电气/时序检查。
