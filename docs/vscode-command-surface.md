# VS Code 命令与文件关联（1.5.2）

命令面板只展示常用创建、查找、打开、运行、编辑和输出入口；需要画布选中对象、树节点或内部参数的命令保留注册，放在右键菜单、画布按钮或供快捷键调用。保留原有命令 ID，以兼容用户快捷键。

## 入口规则

- 全局保留：新建 HDL、Architecture Design、Simulation Task，扫描模块，选择现有 Testbench，打开 VCD，显示 VeriFlow 输出。
- HDL 文本编辑器激活时：格式化、插入 HDL 模板、例化模块、打开原理图、运行当前 Testbench。
- ST 画布激活时：运行、停止、导出 Testbench、打开仿真波形。
- 隐藏旧的全局 Compile & Simulate / Analyze / Generate Testbench 流程及重复模板子命令；模块操作从模块浏览器右键执行，AD 操作从 AD 文件树右键或画布执行。
- `menus.commandPalette` 只控制命令面板可见性，不删除命令，也不影响已有右键菜单。

## 统一画布文件关联

`.ad` 与 `.st` 都是 JSON 文档，统一关联内置 `json` 语言。以文本打开时，两者均有 JSON 高亮、格式化和语法诊断；`.st` 继续使用现有 schema。AD 的领域校验仍由 AD 编辑器完成，JSON 语法正确不代表设计语义正确。

文件语言与默认打开方式独立：两者仍通过文件名匹配打开各自的自定义画布编辑器。移除独立的 `arch-design` 语言及 VeriFlow Canvas 图标主题和配套 SVG；无需切换用户的文件图标主题。按语言提供图标的主题会使用同一 JSON 图标，但主题或用户设置若显式区分扩展名，可覆盖这一默认结果，扩展不强制改写这些设置。

实现依据：[VS Code 文件图标主题](https://code.visualstudio.com/api/extension-guides/file-icon-theme)、[命令贡献与菜单](https://code.visualstudio.com/api/references/contribution-points)。VS Code 1.74 起会根据 commands、views 和 customEditors 自动生成激活事件；本扩展最低版本为 1.82，清单测试应验证贡献本身，不要求重复的显式激活事件。
