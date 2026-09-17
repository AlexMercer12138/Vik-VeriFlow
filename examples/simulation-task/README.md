# Basic graphical Testbench

Open `basic.st` in the VeriFlow Simulation Task editor. It connects a 100 MHz
Clock, a low-active Reset released at 20 ns, and an 8-bit Stimulus to the
parameterized `counter` module. The stimulus changes at 30, 70 and 110 ns to
1, 3 and 16. The counter reaches `8'h60` before the task finishes at 160 ns.

```bash
veriflow task validate examples/simulation-task/basic.st
veriflow task run examples/simulation-task/basic.st
```

Use Generate Testbench to save a readable `.v`; run and waveform buttons use
the same task configuration. `manual_tb.v` is an independent Verilog-2005
Testbench for the same DUT and timing. Its checks print `PASS` on success;
waveform statements are included as comments so they can be enabled explicitly.

The example has one control counter, one synchronous active-low reset and one
independent testbench. It needs no additional top-level wrapper. No protocol,
case matrix, embedded HDL asset or verification framework is required.
