`timescale 1ns/1ps

module manual_tb;
    reg clk = 1'b0;
    reg rst_n = 1'b0;
    reg [7:0] step = 8'h00;
    wire [7:0] count;

    counter #(.WIDTH(8)) counter_inst (
        .clk(clk),
        .rst_n(rst_n),
        .step(step),
        .count(count)
    );

    always #5 clk = ~clk;
    initial #20 rst_n = 1'b1;
    initial #160 $finish;

    // Uncomment to record the standalone traditional testbench waveform.
    // initial begin
    //     $dumpfile("manual_tb.vcd");
    //     $dumpvars(0, manual_tb);
    // end

    task drive_step_after;
        input integer delay_ns;
        input [7:0] value;
        begin
            #(delay_ns) step <= value;
        end
    endtask

    task check_count;
        input [7:0] expected;
        begin
            if (count !== expected) begin
                $display("ERROR: count=%h expected=%h", count, expected);
                $finish;
            end
        end
    endtask

    initial begin
        drive_step_after(30, 8'h01);
        drive_step_after(40, 8'h03);
        drive_step_after(40, 8'h10);
    end

    initial begin
        #16 check_count(8'h00);
        #50 check_count(8'h04);
        #40 check_count(8'h10);
        #50 check_count(8'h60);
        $display("PASS: reset and 8-bit step sequence");
    end
endmodule
