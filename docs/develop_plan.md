# 开发计划

## 1.5.x 功能补全计划

### 1.5.2 落地情况（2026-09-18）

- 修复 Simulation Task 快速仿真波形自动打开、布局变化误判结果过期；Testbench 直接导出到 `.st` 同目录。
- 第 5 项：新增可选 **VeriFlow Canvas** 文件图标主题，统一 `.st` / `.ad` 图标；使用方式和第三方主题边界见 [VS Code 命令与图标](vscode-command-surface.md)。
- 第 6 项：完成 [CLI 命令规范](cli-command-spec.md)。
- 第 7 项：完成命令面板入口整理，保留右键菜单和命令 ID，按 HDL/ST 上下文显示常用操作。
- 第 1 项：完成 [Monitor / Driver / Sequencer 设计草案](simulation-components-design.md)，待评审后分期实现。
- 第 2、3 项涉及模板配置契约和格式化语义，第 4 项 GIF 需要录制实际交互，留待后续迭代。

### 原始需求

1. 添加更多仿真功能模块，实现在画布快速搭建完整的简易 Testbench

- 实现 Monitor 组件（整合现有接口的从机或接收端）
- 实现 Driver 组件（整合现有接口的主机或发送端）
- 实现 Sequencer 组件（生成事务内容暂定为：1、系统预设，递增数，随机数等；2、用户添加）

2. 完善添加 HDL 模板功能，修改为用户自定义模板，在设置处添加修改

3. 优化格式化效果：

```verilog
// 总共五列对齐，每列缩进可在设置中设置
    4       12      20                      44          56
    |       |       |                       |           |
module module_name (
    input   wire                            clk         ,

    input   wire    [15:0]                  data        ,

    input   wire    [CONFIG_WIDTH-1:0]      cfg_data    ,

    output  reg                             valid       ,

    output          [7:0]                   dout
);

    wire    [1:0]                           net1        ;

    reg     [7:0]                           ff          ;

    assign  net1                            = data[1:0] ;
    assign  dout                            = cfg_data[7:0]; // 当对齐列被占用时不进行对齐

    // 过程块不参与对齐
    initial begin
        //...
    end

    generate
        //...
    endgenerate

    always @(posedge clk) begin
        //...
    end

    fifo                                    #(
        .DATA_WIDTH                         (16         ),
        .FIFO_DEPTH                         (1024       ))
    u_fifo                                  (
        .clk                                (clk        ),
        .wren                               (1'b1       ),
        .din                                (data       ));

    clk_wiz u_clk_wiz                       (
        .clk_in                             (clk        ),
        .clk_out                            (usr_clk    ),
        .locked                             (locked     ));

endmodule
```

4. 完善商店页README，录制主要功能的GIF

5. 统一 .st 和 .ad 的 VS Code 文件浏览器图标，目前 .st 仍是 json 图标，.ad 是下箭头图标，统一为一个更符合两者画布身份的图标

## 1.6.x 完整编程语言扩展计划

1. 支持 Verilog/SystemVerilog/XDC/SDC 等文件格式的语法高亮，快速模板等

2. 支持内置 Verilog/SystemVerilog Lint 功能，支持配置外部 Linter，选项依旧 builtin/custom

3. 支持在 AD 编辑器内编辑约束，并导出为各种格式

## 1.7.x 波形查看器功能增强计划

1. 开发自定义波形格式，用二进制存储，优化性能

2. 扩展内置波形器的支持格式，支持常见格式以及自定义格式，支持列表参考 Surfur

3. 优化波形查看器界面，已发现问题有在高对比度主题下亮度过高，在信号列表拖动信号时总会插入偏下的位置