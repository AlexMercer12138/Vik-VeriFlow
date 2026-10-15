# 引脚绑定与 XDC

AD 编辑器点击 **Pins / XDC**。普通 `.v` / `.sv` 文件通过资源管理器、编辑器右键或命令面板执行 **VeriFlow: Generate Pin Constraints (XDC)**；文件含多个模块时先选模块。AD 与 RTL 使用同一面板。

## 用户板卡库

板卡保存在 `~/.veriflow_config.json` 的 `boards` 数组，跨工程使用。**Import board…** 导入板卡 JSON；**User board library** 打开用户配置。导入保留已有语言、主题、库目录等设置。

板卡记录包含 `id`、`name`、`model` 和 `definitions`。通用接口通过 `library:interfaces/<文件名>.json` 引用插件的正式接口库，不重复嵌入各板卡；`definitions` 只保存相对文件引用的板卡专用或用户自定义定义，原文件移动后仍可使用。AD 用 `user:<id>` 引用板卡。旧 AD 相对板卡路径仍可读取。

正式数据统一位于 [data/physical-models](../data/physical-models/README.md)。[AU15P 板卡](../data/physical-models/boards/atk-au15p/board.json) 可直接导入；板卡、子卡及示例不打包进 VSIX。

## 操作

1. 选择板卡。上方为每条可调供电轨列出 Bank 电压，只能选板卡声明的值；固定电压显示文本。共用轨的 Bank 使用同一电压，没有跳线设置。
2. 左侧勾选接口、组或信号，立即预留引脚。复用信号自动禁用；必须整体选择的组有一脚冲突时整组禁用。固定功能差分对共同选择，扩展差分对仍可拆为单端。
3. 中间每个信号只占两行：第一行为信号/引脚/Bank，第二行为端口和 IO 标准两个下拉框。拖动右侧端口也能绑定。端口选择空项解除映射；没有 Bind / Clear 按钮。
4. **先确定上方 Bank 电压，再选 IO 标准。** 候选按电压、器件 Bank 类型、方向和单端/差分用途过滤。3.3V HR/HD 单端为 `LVCMOS33`、`LVTTL`；AMD 实际标准名是 `LVTTL`。更换电压后，旧标准若不再适用会标为 unavailable 并阻止导出，用户重新选择。
5. 点击 **Confirm & Generate XDC**。所选信号须全部分配并显式选标准；未知引脚、非法标准、方向/位宽/差分配对错误等阻止导出。

用户决定 HDMI 等接口实际采用的 IO 标准，生成器不按板卡名猜测电路。DCI、VREF、终端和 DDR/MIPI/GT 的 IP 参数须按实际设计配置；此工具生成所选的封装脚、IOSTANDARD 和已知板载时钟约束。

## 总线与差分

接口 `signals` 只列逻辑信号，`bus` 统一保存数字位宽，例如 `"data_p": 3`，不再使用成员数组。界面显示 `data_p[2:0] / data_n[2:0]`，P/N 共用一个绑定项；拖入 `tmds_data_p[2:0]` 或 `tmds_data_n[2:0]` 任一端，按声明索引顺序同时绑定六脚。展开左侧总线可按位选择。为固定差分总线选择标准会同步其对应 N/P 成员。端口向量、方向和极性均校验。

## AD 持久化

选择、分配和标准先作为面板草稿，确认前不改 AD。确认时写入 `physical` 并保存 AD，随后生成 XDC。文档更改和输出文件冲突会重新检查。

```jsonc
"physical": {
  "board": "user:atk-au15p",
  "railVoltages": [{"rail": "VCCIO_B64", "millivolts": 1800}],
  "selections": [{"interface": "HDMI_OUT", "members": ["data_p.2", "data_n.2"]}],
  "ioStandards": [
    {"interface": "HDMI_OUT", "member": "data_p.2", "standard": "LVDS"},
    {"interface": "HDMI_OUT", "member": "data_n.2", "standard": "LVDS"}
  ],
  "bindings": [
    {"source": {"interface": "HDMI_OUT", "member": "data_p.2"}, "port": {"name": "tmds_data_p", "bit": 2}},
    {"source": {"interface": "HDMI_OUT", "member": "data_n.2"}, "port": {"name": "tmds_data_n", "bit": 2}}
  ]
}
```

旧 AD 没有 `selections` 时从绑定推断；旧跳线设置读取后忽略，新保存不再写入。已有绑定没有 IO 标准时须在面板选择，避免静默猜测。

XDC 跟随 AD 的 RTL 输出目录和文件主名，例如 `generated/video.sv` 对应 `generated/video.xdc`。AD 属性 **XDC output path** 可覆盖路径，对应 `export.xdcOutput`。RTL 与 XDC 在 AD 树下并列显示。

## RTL 快速工具

RTL 配置只保留在当前面板，不修改 RTL、不生成绑定配置。确认时用 VS Code `showSaveDialog` 选择 XDC 路径和文件名，和项目已有文件保存操作一致。取消保存保留草稿。

XDC 包含来源标记，只覆盖同一来源生成的文件；人工文件和其他来源的文件会报告冲突。

图形化添加板卡的下一步方案见 [板卡编辑器方案](board-library-editor-proposal.md)。
