module module_name #(
    parameter       [63:0]                  NAME        = "VIK_HDTV",
    parameter                               ADDR_WIDTH  = 28,
    parameter       [31:0]                  CONFIG_WIDTH = 32
) (
    input   wire                            clk         ,
    input   wire    [15:0]                  data        ,
    input   wire    [CONFIG_WIDTH - 1:0]    cfg_data    ,
    output  reg                             valid       ,
    output          [7:0]                   dout
);
    localparam      [31:0]                  BAUD_RATE   = 115200;

    wire    [1:0]                           net1        ;
    reg     signed  [7:0]                   ff          ;
    reg     [15:0]                          ram [0:255] ;

    assign  net1                            = data[1:0] ;
    assign  dout                            = cfg_data[7:0];

    initial begin
        if(ADDR_WIDTH > 0) begin
            valid = 0;
        end else begin
            valid = 1;
        end
    end

    generate
        if(CONFIG_WIDTH > 8) begin : g_wide
            wire    [7:0]                           unused_data ;

        end
    endgenerate

    always @(posedge clk) begin
        if(data[0]) begin
            valid <= 1;
        end else if(data[1]) begin
            valid <= 0;
        end
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
