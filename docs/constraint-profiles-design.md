# 板卡模板设计

当前已确认并实施的方案见 [约束工作台与独立板卡模板 V1](constraint-workbench-design.md)。板卡文件只保存显式资源模板，不导入/解析 XDC 或其他约束文件；主板只替换信号名，子卡额外在工程中指定最终引脚。使用说明见 [约束工作台](physical-pin-bindings.md)。
