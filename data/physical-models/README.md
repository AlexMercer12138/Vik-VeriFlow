# 原文约束模型与示例

`examples/carrier.board.json`、`examples/uart.daughtercard.json` 是最小 V1 板卡/子卡模型。`examples/top.ad` 展示子卡安装和顶层端口绑定。示例引脚只用于演示，不作为实物约束。

接口直接保存在各板卡/子卡中，不再维护或打包独立物理接口库。用户数据导入后保存在 `~/.veriflow_config.json`，跨工程复用。

```bash
veriflow board import examples/carrier.board.json --id carrier
veriflow arch build examples/top.ad
```

命令在本目录执行。Schema 源为 `packages/schematic-core/schemas/physical-interface-model.schema.json`，保持 V1。运行仓库根目录的 `npm run verify:models` 检查契约。

[模型](../../docs/physical-interface-model.md) · [使用说明](../../docs/physical-pin-bindings.md)
