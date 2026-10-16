# 物理模型数据

本目录是物理接口、板卡和硬件映射示例的唯一源目录。构建用同一复制函数将 `interfaces` 中的通用接口交付到 `hdl-runtime/resources/physical-models/interfaces` 和扩展 `resources/physical-models/interfaces`；生成资源不手工维护。AD/ST、逻辑协议与 Schema 的位置见[架构与模型索引](../../docs/architecture.md)。

| 目录 | 内容 |
| --- | --- |
| interfaces/ | UART、I2C、SPI、RGB、HDMI、DDR4 x16、MIPI、RGMII、SD、CAN、QSFP、PCIe x8、40 PIN、FMC LPC 等可复用接口 |
| boards/atk-au15p/ | AU15P 硬件接线与 CLK、LED、KEY、风扇、ATK 模块口、MIPI 控制信号等板卡专用定义 |
| examples/ | 板卡/子卡装配示例与测试输入；生产接口库不依赖本目录 |

板卡使用 `library:interfaces/<文件名>.json` 引用通用定义；板卡专用定义使用相对路径。新接口先判断是否与板卡接线无关，能复用的放 `interfaces`，专用信号放对应板卡目录。位宽固定的变体以文件名明确规格，不把最大位宽当作所有板卡的实际连线。

MIPI 通用定义只保留标准数据 lane 和时钟，AU15P 的触摸、背光、相机复位/I2C 等控制线独立建模。总线在 `signals` 中作为一个信号，`bus` 只记录数字位宽，成员 ID 为 `信号.位索引`。接口实例的 `signals` 可引用模板子集；AU15P 的 HDMI 只引用通用 HDMI 中的数据和时钟，未接通的边带信号无需另建接口。

板卡和子卡由用户导入，不随 VSIX 打包。用户板卡库位于 `~/.veriflow_config.json`；通用定义按库引用复用，专用定义导入时保存快照。

运行 `node scripts/verify-physical-models.cjs` 检查 Schema、引用和硬件映射。使用说明见 [引脚绑定](../../docs/physical-pin-bindings.md)。

硬件模型 Schema 源在 `packages/schematic-core/schemas/physical-interface-model.schema.json`，随模型所属共享包维护。
