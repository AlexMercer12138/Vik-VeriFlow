{
  "format": "veriflow-simulation-task",
  "schemaVersion": 1,
  "settings": {
    "timeUnit": "1ns",
    "timePrecision": "1ps",
    "duration": 160,
    "waveform": {
      "enabled": true,
      "filename": "basic_tb.vcd"
    }
  },
  "instances": [
    {
      "id": "counter_inst",
      "source": {
        "kind": "hdl",
        "path": "counter.v",
        "module": "counter"
      },
      "parameters": {
        "WIDTH": "8"
      }
    },
    {
      "id": "clock_inst",
      "preset": {
        "kind": "clock",
        "frequencyMHz": 100,
        "initial": 0
      }
    },
    {
      "id": "reset_inst",
      "preset": {
        "kind": "reset",
        "active": 0,
        "duration": 20
      }
    },
    {
      "id": "stimulus_inst",
      "preset": {
        "kind": "stimulus",
        "width": 8,
        "initial": "8'h00",
        "transitions": [
          {
            "at": 30,
            "value": "8'h01"
          },
          {
            "at": 70,
            "value": "8'h03"
          },
          {
            "at": 110,
            "value": "8'h10"
          }
        ]
      }
    }
  ],
  "connections": [
    {
      "name": "clk",
      "endpoints": [
        {
          "kind": "instance",
          "instance": "clock_inst",
          "port": "clk"
        },
        {
          "kind": "instance",
          "instance": "counter_inst",
          "port": "clk"
        }
      ]
    },
    {
      "name": "rst_n",
      "endpoints": [
        {
          "kind": "instance",
          "instance": "reset_inst",
          "port": "reset"
        },
        {
          "kind": "instance",
          "instance": "counter_inst",
          "port": "rst_n"
        }
      ]
    },
    {
      "name": "step",
      "endpoints": [
        {
          "kind": "instance",
          "instance": "stimulus_inst",
          "port": "out"
        },
        {
          "kind": "instance",
          "instance": "counter_inst",
          "port": "step"
        }
      ]
    }
  ],
  "logic": [],
  "defaults": {},
  "interfaceConnections": [],
  "interfaceOverrides": {},
  "presentation": {
    "nodes": {
      "instance:clock_inst": {
        "column": 0,
        "order": 0
      },
      "instance:reset_inst": {
        "column": 0,
        "order": 1
      },
      "instance:stimulus_inst": {
        "column": 0,
        "order": 2
      },
      "instance:counter_inst": {
        "column": 1,
        "order": 0
      }
    }
  }
}
