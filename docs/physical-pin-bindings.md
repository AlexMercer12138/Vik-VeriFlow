# 引脚绑定与原文约束

AD 从工具栏的板卡引脚按钮打开；普通 `.v` / `.sv` 文件通过编辑器、资源管理器右键或 **VeriFlow: Generate Pin Constraints** 打开。同一套 TypeScript 核心同时服务扩展和 CLI。

## 建立板卡

1. 打开 **Manage Boards… → Import board**，在文件选择器中过滤支持的约束格式或板卡 profile JSON。
2. 填写 ID、名称；约束原文可以直接编辑，文件后缀随板卡保存。
3. 添加 `UART0` 接口，创建输出 `tx`、输入 `rx`，位宽各为 1，分别匹配导入的引脚。
4. 保存到 `~/.veriflow_config.json` 的 `boards`，所有工程共用；导出 JSON 可以分享。

接口直接属于板卡或子卡，不使用独立接口模型。总线保存按 MSB 到 LSB 排列的引脚列表，列表长度就是位宽；方向相对于 FPGA 顶层端口。不同接口可描述同一物理引脚的不同用途，实际同时绑定时检查冲突。

编辑器保留撤销/重做、关闭前的未保存提示和备份恢复。保存用户配置前写 `.bak`，原子替换，保留其他设置；外部修改或备份失败不会覆盖原配置。

## 绑定与导出

选择板卡，勾选接口或信号，再选择匹配的顶层端口或从右侧拖入。方向、位宽必须匹配；总线按 HDL 声明顺序映射，支持升序、非零和负数索引。所勾选的信号必须全部绑定。只输出已绑定引脚对应的约束。

**Confirm & Export Constraints** 将 AD 绑定保存到 `.ad`；RTL 可以显式加载、保存 `top.pins.json`。相对板卡/子卡路径以配置文件所在目录为准，另存时自动重定位。输出冲突在提交 AD 草稿前检查。

AD 构建同时生成 RTL 和原文约束，扩展名来自板卡。`export.constraintsOutput` 或 CLI `--constraints-output` 可覆盖路径。保存 `.pcf` 就输出 `.pcf`，不转换格式。

```bash
veriflow board import board.xdc --id my-board
veriflow board ui
veriflow board export user:my-board -o my-board.json
veriflow pins validate top.v --config top.pins.json
veriflow pins export top.v --config top.pins.json -o generated/top.xdc
veriflow arch build top.ad
```

输出文件旁的 `<output>.veriflow.json` 保存来源和上次生成内容的摘要。保留该文件才能再次生成；人工修改或其他来源的输出会报告冲突。约束正文不插入生成器头部。

## 子卡

导入子卡约束，在编辑器中选择 **Daughtercard**。原文使用连接器/逻辑引脚名，并在子卡内建立接口和信号。

工程引脚面板展开 **Daughtercards**，选择子卡并填写实例 ID，将子卡引脚逐一映射到主板物理引脚。子卡接口随后与主板接口一起显示；已映射的物理引脚在挂载期间被预留，移除子卡后释放。

选中的子卡信号输出子卡自己保存的约束，只把逻辑引脚替换成主板引脚，不叠加主板同一脚的电气属性。活动模型必须使用相同后缀。缺失映射、重复占脚、无效端口、方向/位宽错误或格式混用会阻止导出。

CLI 导入子卡：`veriflow board import card.xdc --kind daughtercard --id serial-card`。挂载和绑定与 UI 使用同一份 `.pins.json`/AD 配置，见 [V1 模型](physical-interface-model.md) 和 [AD 示例](../data/physical-models/examples/top.ad)。

## 原文支持范围

静态识别 XDC 的 PACKAGE_PIN/LOC、`set_property -dict` 和 `get_ports` 字面量，Tcl 不执行。共享端口列表按绑定筛选；保留注释、命令顺序、属性值和换行。动态 Tcl、通配符、多个端口查询或歧义会明确报错，用户可以编辑原文或使用显式锚点。

其他格式保留后缀，在可编辑原文中明确标记替换位置：

```text
set_io {{PORT:A1}} {{PIN:A1}}
```

`PORT` 替换为顶层端口，`PIN` 替换为最终物理引脚（含子卡映射）。有未绑定锚点的命令不输出，未关联引脚的公共文本保留。XDC 不支持的表达式也可改成显式锚点；引用和转义由模板明确表达。

工具只检查映射，不再选择 Bank 电压、推导 IO 标准或维护厂商电气规则，约束属性按用户保存内容输出。未发布旧板卡数据没有原始约束，需重新导入 XDC。
