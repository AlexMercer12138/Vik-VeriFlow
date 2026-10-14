# 引脚绑定与 XDC

在 AD 编辑器点击 **Pins / XDC**，或在 Architecture Design 树中右键选择 **Board / Pin Bindings (AD)**。普通 `.v` / `.sv` 文件可以从资源管理器、编辑器右键菜单或命令面板执行 **VeriFlow: Generate Pin Constraints (XDC)**；文件含多个模块时先选择模块。

板卡列表包含插件内置的 **ATK AU15P**，以及工作区内 `kind: "board"` 的 JSON。工作区板卡按相对 AD/RTL 文件的路径引用，其接口定义按相对板卡的路径加载。内置板卡引用为 `library:boards/atk-au15p/board.json`。

## 绑定

1. 选择板卡，按实物设置可选电源轨电压和复用跳线。固定电压无需填写。
2. 将 RTL 端口拖到接口信号或 `bus` 上；也可先点击端口，再点击目标的 **Bind**。
3. 勾选接口或分组，会保留已有映射，为剩余信号查找同名、`接口名_信号名` 或 `_信号名` 后缀的端口。候选不唯一或没有匹配时，提示手动绑定；不会提交一半映射。取消勾选会移除对应绑定。
4. 检查面板问题，点击 **Export XDC**。引脚/端口重复占用、方向/位宽不符、错误差分极性、未定供电/跳线、禁止使用的预留脚及缺失器件规则都会阻止导出；警告级预留脚保留提示。

绑定只引用硬件成员与 RTL 端口，板卡 JSON 继续只保存硬件事实。生成器根据器件、Bank、实际供电与接口用途选择约束。

固定接口的差分 `_p` / `_n` 端口自动一起绑定，要求相同的声明索引。例如拖放 `[2:0] tmds_data_p` 到 HDMI `data_p`，会同时绑定 `tmds_data_n[2:0]`，共六个物理脚。数组型 `bus` 按定义顺序对应声明索引；升序及非零起点同样支持。参数范围通过已有整数表达式解析器求值；未解析、多维或超过 4096 位的端口需要先调整范围。

扩展口的差分对仍可拆开使用。把单端端口绑定到 J16 的一个信号，只占用这一脚，生成对应单端标准；另一脚可独立绑定。子卡安装和功能映射尚未接入此版面板。

## AD 保存和路径

AD 绑定通过 VS Code 文档编辑写入，可撤销/重做，按正常 Save 保存；导出会先保存 AD。`physical` 是 AD V2 的可选字段，包含板卡引用、实际电压/跳线与逐位绑定，不影响 RTL 语义指纹。通过编辑器重命名、删除顶层端口或公开接口前缀时，会同步更新或移除相应绑定；手工修改文本导致的失效绑定会在面板中报错，可用 **Unbind** 清除。

```jsonc
"physical": {
  "board": "library:boards/atk-au15p/board.json",
  "boardSettings": [{"selector": "J22", "value": "hdmi"}],
  "railVoltages": [{"rail": "VCCIO_B64", "millivolts": 1800}],
  "bindings": [
    {"source": {"interface": "HDMI_OUT", "member": "data2_p"}, "port": {"name": "tmds_data_p", "bit": 2}}
  ]
}
```

示例只展示一个绑定条目，实际差分对需要完整绑定。

XDC 默认使用 AD 的 RTL 输出目录和文件主名：`top.ad → top.v/top.xdc`；RTL 路径设为 `generated/video.sv` 时，默认约束为 `generated/video.xdc`。在 AD 属性面板设置 **XDC output path**，对应可选的 `export.xdcOutput`，路径相对 AD 文件解析。留空即恢复默认路径。RTL 与 XDC 在 AD 树下并列显示，尚未生成的路径也显示。

RTL 快速工具配置仅保留在当前面板，关闭后清空；不改动 RTL、不创建绑定配置文件，导出时使用保存对话框。生成的 XDC 带来源标记，只覆盖同一来源生成的 XDC；人工文件或其他来源的输出会报告冲突。

## 首版生成器范围

- 输出 XDC，当前器件规则为 AMD `xcau15p-ffvb676-2-i`。普通 GPIO 按实际 VCCO 选择 LVCMOS，HP Bank 校验 1.8 V 上限。
- 固定差分信号在受支持的 HP Bank / 1.8 V 条件下使用 LVDS。内置 ATK AU15P 的 HDMI_OUT 使用专门的 AC 耦合发送电路规则，并要求 `J22=hdmi`；不直接套用 `TMDS_33`。其他 HDMI 电路需要新增生成器规则。
- QSFP/PCIe 的专用 GT 管脚只生成封装脚位置，不附加普通 GPIO IOSTANDARD。板载振荡器根据实际频率生成 `create_clock`。GT 的 IP、参考时钟缓冲、收发器配置和时序仍由工程负责。
- DDR4、MIPI 数据线需要对应 IP 电气配置，当前会明确报错并停止导出；内置板卡的普通控制脚可以按 GPIO 绑定。其他器件缺少规则时也停止导出。

电平检查覆盖已支持的器件模式与 Bank 实际供电，尚不能判断任意板外负载或子卡的容忍电压。导出结果需结合 Vivado/IP 设计验证。

模型录入规范见 [物理接口模型](physical-interface-model.md)，RGB 示例见 [rgb.fixed.json](examples/physical-interfaces/rgb.fixed.json)。
