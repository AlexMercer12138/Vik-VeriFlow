# VS Code 命令与画布图标（1.5.2）

命令面板只展示常用创建、查找、打开、运行、编辑和输出入口；需要画布选中对象、树节点或内部参数的命令保留注册，放在右键菜单、画布按钮或供快捷键调用。保留原有命令 ID，以兼容用户快捷键。

## 入口规则

- 全局保留：新建 HDL、Architecture Design、Simulation Task，扫描模块，选择现有 Testbench，打开 VCD，显示 VeriFlow 输出。
- HDL 文本编辑器激活时：格式化、插入 HDL 模板、例化模块、打开原理图、运行当前 Testbench。
- ST 画布激活时：运行、停止、导出 Testbench、打开仿真波形。
- 隐藏旧的全局 Compile & Simulate / Analyze / Generate Testbench 流程及重复模板子命令；模块操作从模块浏览器右键执行，AD 操作从 AD 文件树右键或画布执行。
- `menus.commandPalette` 只控制命令面板可见性，不删除命令，也不影响已有右键菜单。

## 统一画布文件图标

使用 **Preferences: File Icon Theme → VeriFlow Canvas** 可让资源管理器中的 `.st` 和 `.ad` 使用相同的节点连线图标。这个可选主题对其他文件使用通用文件/文件夹图标，不自动替换用户当前主题。

`.st` 继续关联 JSON，保留现有 schema 校验与文本编辑能力。VS Code 文件图标由当前主题决定；扩展无法向任意第三方主题强行注入扩展名图标。因此，如果继续使用其他主题，需要该主题自身提供 `.st` / `.ad` 映射。

实现依据：[VS Code 文件图标主题](https://code.visualstudio.com/api/extension-guides/file-icon-theme)、[命令贡献与菜单](https://code.visualstudio.com/api/references/contribution-points)。VS Code 1.74 起会根据 commands、views 和 customEditors 自动生成激活事件；本扩展最低版本为 1.82，清单测试应验证贡献本身，不要求重复的显式激活事件。
