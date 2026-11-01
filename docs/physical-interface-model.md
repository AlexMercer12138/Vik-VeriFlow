# 板卡与子卡模板模型 V1

本功能未发布，Schema 保持 `urn:veriflow:physical-model:v1`。板卡文件只有 id/name/kind/extension/pins/interfaces 六个字段。用户库保留 `{id,name,model}`，model 含后四项；文件导入/导出扁平保存，无旧约束格式兼容分支。

```json
{
  "id": "generated-uuid",
  "name": "Carrier",
  "kind": "board",
  "extension": ".xdc",
  "pins": {
    "uart_tx": "set_property PACKAGE_PIN A1 [get_ports {{signal name}}]\n"
  },
  "interfaces": [
    { "id": "UART", "signals": [
      { "id": "tx", "direction": "output", "pins": ["uart_tx"] }
    ] }
  ]
}
```

ID 和子卡实例身份自动生成，用户只填名称；重命名不改变身份。接口/信号使用有实际含义的名称，不重复维护 Name 与 ID。

pins 是逻辑资源名到字符串的字典，不保存独立封装脚号。接口信号只有 id/direction/pins，位宽为列表长度，按逻辑高位到低位排序。核心按真实 HDL 位索引绑定，不推断厂商语法。

主板只替换 `{signal name}`，物理位置写在模板中。子卡 kind 为 daughtercard，额外支持 `{pin name}`，在工程逐位绑定中填写。其余文字原样保留，不解析、不执行、不递归展开、不自动加入特定语言引用。

工程的 `physical` / `.pins.json`：

```json
{
  "board": "user:BOARD_ID",
  "cards": [{ "id": "generated-instance-id", "board": "user:CARD_ID" }],
  "bindings": [{
    "source": { "card": "generated-instance-id", "interface": "UART", "member": "tx" },
    "port": { "name": "sensor_tx" },
    "pin": "B7"
  }]
}
```

主板绑定省略 card/pin。多位 member 为 signal.N-1 到 signal.0，port.bit 保存真实 HDL 索引。子卡无 connections、安装槽位或主板映射，不继承属性，不做跨板物理占用检查。检查明确的逻辑资源和顶层端口重复、方向、位宽、缺失模板/位置、同一文件输出后缀一致性。

输出按主板在前、子卡实例顺序、接口信号/位顺序拼接，只有所选资源输出。保留输入快照、输出归属摘要和原子写入。示例见 [载板](../data/physical-models/examples/carrier.board.json)、[子卡](../data/physical-models/examples/uart.daughtercard.json)、[AD](../data/physical-models/examples/top.ad)。
