module counter #(
    parameter WIDTH = 8
) (
    input wire clk,
    input wire rst_n,
    input wire [WIDTH-1:0] step,
    output reg [WIDTH-1:0] count
);
    always @(posedge clk) begin
        if (!rst_n) begin
            count <= {WIDTH{1'b0}};
        end else begin
            count <= count + step;
        end
    end
endmodule
