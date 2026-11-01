# 约束工作台

右键 `.v` / `.sv` 选择 **VeriFlow: Add constraints**，直接使用被点击的文件；不需要 AD 工程。AD 使用工具栏/右键的板卡约束入口。工作台只有一个标签，内部 **Pin bindings / Board library** 两页共用，切页保留草稿。

## 建立板卡

1. **Manage Boards → New board**，填写名称、类型、输出后缀。ID 自动生成，不要求输入。
2. **Pins → Add pin**，填写资源名（例如 uart_tx），编写多行约束模板。主板位置直接写在字符串内，只插入 `{signal name}`。
3. **Interfaces → Add interface**，为 UART 等接口添加信号、方向和有序资源列表。列表长度是位宽；支持多选 Pins 后直接创建接口。
4. **Save board** 保存到用户库。**Import board** 只接受板卡 JSON；不能导入约束文件。复制会生成新的内部身份，重命名保留原身份。

主板示例：

```text
set_property PACKAGE_PIN A1 [get_ports {{signal name}}]
set_property IOSTANDARD LVCMOS33 [get_ports {{signal name}}]
```

这里只替换内层 `{signal name}`。绑定 console_tx 后得到 `[get_ports {console_tx}]`；外层花括号属于用户文本。任何格式都按相同固定标记替换，不解析约束语言，不执行 Tcl。

## 绑定与导出

选择主板，勾选接口或信号，从右侧端口列表拖入对应行。拖起时高亮方向和位宽兼容的目标；可搜索端口，已绑定端口可一键解除。键盘可先选择端口再选择目标行，无端口下拉框。

总线按真实 HDL 声明顺序逐位绑定，支持升序、非零和负数索引。主板无需另外填写封装引脚。**Save bindings** 保存到 AD 的 physical 或默认同名 RTL `.pins.json`，也可加载/另存绑定；不需要手工编辑 JSON。

**Export constraints** 使用主板后缀输出选中的模板。格式不转换，未绑定资源不输出。完整性、方向、位宽、重复信号和所需子卡位置均通过后才导出；输出冲突在保存 AD 草稿前检查。生成文件旁的 `.veriflow.json` 记录来源和内容摘要，人工修改后的输出不会被静默覆盖。

## 子卡

子卡与主板独立建模。**Add daughtercard** 只选模型，实例 ID 自动生成；重复添加以名称后的序号区分。每个子卡信号从右侧拖入顶层端口，模板使用 `{pin name}` 时在工程绑定行填写最终 FPGA 引脚，例如 B7。总线展开逐位填写。

```text
set_property PACKAGE_PIN {pin name} [get_ports {{signal name}}]
set_property IOSTANDARD LVCMOS18 [get_ports {{signal name}}]
```

子卡使用自己的全部模板，不映射主板资源、不继承主板电平，不做跨板物理占用检查。主板必须选择，子卡可选，所用模板后缀必须一致。主板只维护固定板载功能，扩展排针/FMC 功能由子卡维护。

## CLI

```bash
veriflow board ui
veriflow pins ui top.v
veriflow pins ui top.ad
veriflow board import carrier.board.json
veriflow board export user:BOARD_ID -o carrier.board.json
veriflow pins validate top.v --config top.pins.json
veriflow pins export top.v --config top.pins.json -o top.xdc
veriflow arch build top.ad
```

单文件只有一个模块时自动使用，多模块才选择模块或提供 `--module`。CLI UI 和 VS Code 使用相同前端、库模型与导出核心。结构见 [V1 模型](physical-interface-model.md)，完整交互见 [工作台设计](constraint-workbench-design.md)。
