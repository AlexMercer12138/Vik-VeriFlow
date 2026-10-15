# 引脚绑定与 XDC

在 AD 编辑器点击 **Pins / XDC**，或在 Architecture Design 树中右键选择 **Board / Pin Bindings (AD)**。普通 `.v` / `.sv` 文件可以从资源管理器、编辑器右键菜单或命令面板执行 **VeriFlow: Generate Pin Constraints (XDC)**；文件含多个模块时先选择模块。

板卡保存在现有用户配置 `~/.veriflow_config.json` 的 `boards` 数组中，任意工程均可使用。点击 **Import board…** 导入 `kind: "board"` 的 JSON；导入时解析并保存所需接口定义，原始文件移动或工程切换后仍可使用。**User board library** 打开该配置，可直接维护板卡。导入会保留已有库目录、语言、主题和其他配置。

每条记录包含 `id`、`name`、`model`（原板卡硬件模型）与 `definitions`（按原定义引用索引的接口快照）。AD 使用 `user:<id>` 引用，例如 `user:atk-au15p`，不会复制工程相关路径。内置接口仍随插件提供，导入文件可以引用 `library:interfaces/uart.fixed.json` 或相对文件路径。

仓库的 `docs/boards/atk-au15p/board.json` 可通过导入加入用户板卡库。板卡不打包进 VSIX。旧 AD 的相对板卡路径仍可读取；旧 `library:boards/...` 引用需先导入板卡，再重新选择用户板卡。

## 绑定

1. 选择已保存的板卡，按实物设置可选电源轨电压和复用跳线。固定电压无需填写。
2. **左栏选择接口**：可勾选整个接口、分组或单个信号。勾选立即预留物理引脚，与 RTL 命名、是否已分配端口无关。复用冲突、非法电压、未定跳线、禁止预留脚等会禁用对应选项，悬停可查看原因。必须整体选择的组和固定功能差分对会传递补齐；其中一脚冲突则整组禁用。取消选择释放引脚，并移除对应草稿映射。
3. **中栏分配端口**：所选信号或总线显示分配位置；将右栏顶层端口拖入，也可使用下拉框，或先选端口再点击 **Bind**。右栏保留全部顶层端口并显示已绑定状态。取消绑定不会取消硬件选择。
4. 检查问题并点击 **Confirm & Generate XDC**。所选信号必须全部分配；引脚/端口重复、方向/位宽不符、差分极性错误、电平及器件规则问题会阻止生成。警告级预留脚保留提示。

绑定只引用硬件成员与 RTL 端口，板卡 JSON 继续只保存硬件事实。生成器根据器件、Bank、实际供电与接口用途选择约束。

固定接口的差分 `_p` / `_n` 端口自动一起绑定，要求相同的声明索引。例如拖放 `[2:0] tmds_data_p` 到 HDMI `data_p`，会同时绑定 `tmds_data_n[2:0]`，共六个物理脚。数组型 `bus` 按定义顺序对应声明索引；升序及非零起点同样支持。参数范围通过已有整数表达式解析器求值；未解析、多维或超过 4096 位的端口需要先调整范围。

扩展口的差分对仍可拆开使用。把单端端口绑定到 J16 的一个信号，只占用这一脚，生成对应单端标准；另一脚可独立绑定。子卡安装和功能映射尚未接入此版面板。

## AD 保存和路径

选择、设置和端口分配先保留为面板草稿，不立即修改 AD；关闭面板会丢弃未确认的更改。确认时通过 VS Code 文档编辑写入绑定，可撤销/重做，保存 AD 成功后生成 XDC。已存在的人工约束文件会在提交草稿前报告冲突。`physical` 是 AD V2 的可选字段，包含用户板卡引用、`selections` 所选物理成员、实际电压/跳线与逐位绑定，不影响 RTL 语义指纹。旧文件未写 `selections` 时从已有绑定推断选择。通过编辑器重命名、删除顶层端口或公开接口前缀时，会同步更新或移除相应绑定；手工修改文本导致的失效绑定会在面板中报错，可用 **Unbind** 清除。

```jsonc
"physical": {
  "board": "user:atk-au15p",
  "selections": [{"interface": "HDMI_OUT", "members": ["data2_p", "data2_n"]}],
  "boardSettings": [{"selector": "J22", "value": "hdmi"}],
  "railVoltages": [{"rail": "VCCIO_B64", "millivolts": 1800}],
  "bindings": [
    {"source": {"interface": "HDMI_OUT", "member": "data2_p"}, "port": {"name": "tmds_data_p", "bit": 2}}
  ]
}
```

示例只展示一个绑定条目，实际差分对需要完整绑定。

XDC 默认使用 AD 的 RTL 输出目录和文件主名：`top.ad → top.v/top.xdc`；RTL 路径设为 `generated/video.sv` 时，默认约束为 `generated/video.xdc`。在 AD 属性面板设置 **XDC output path**，对应可选的 `export.xdcOutput`，路径相对 AD 文件解析。留空即恢复默认路径。RTL 与 XDC 在 AD 树下并列显示，尚未生成的路径也显示。

RTL 快速工具使用完全相同的三栏界面，配置仅保留在当前面板，关闭后清空。确认时使用 VS Code 的 `showSaveDialog` 选择 XDC 文件名和路径，与新建 HDL/ST 等操作一致；取消对话框保留草稿且不生成文件。RTL 内容不会改动，也不创建绑定配置文件。生成的 XDC 带来源标记，只覆盖同一来源生成的 XDC；人工文件或其他来源的输出会报告冲突。

## 首版生成器范围

- 输出 XDC，当前器件规则为 AMD `xcau15p-ffvb676-2-i`。普通 GPIO 按实际 VCCO 选择 LVCMOS，HP Bank 校验 1.8 V 上限。
- 固定差分信号在受支持的 HP Bank / 1.8 V 条件下使用 LVDS。仓库 ATK AU15P 示例的 HDMI_OUT 使用专门的 AC 耦合发送电路规则，并要求 `J22=hdmi`；不直接套用 `TMDS_33`。生成器通过硬件模型指纹识别已验证的电路，不依赖内置板卡文件。修改硬件模型后需重新验证专用规则；其他 HDMI 电路需要新增生成器规则。
- QSFP/PCIe 的专用 GT 管脚只生成封装脚位置，不附加普通 GPIO IOSTANDARD。板载振荡器根据实际频率生成 `create_clock`。GT 的 IP、参考时钟缓冲、收发器配置和时序仍由工程负责。
- DDR4、MIPI 数据线需要对应 IP 电气配置，当前会明确报错并停止导出；已验证的 AU15P 示例的普通控制脚可以按 GPIO 绑定。其他器件缺少规则时也停止导出。

电平检查覆盖已支持的器件模式与 Bank 实际供电，尚不能判断任意板外负载或子卡的容忍电压。导出结果需结合 Vivado/IP 设计验证。

模型录入规范见 [物理接口模型](physical-interface-model.md)，RGB 示例见 [rgb.fixed.json](examples/physical-interfaces/rgb.fixed.json)。
