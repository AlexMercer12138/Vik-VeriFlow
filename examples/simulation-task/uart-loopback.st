{
  "format": "veriflow-simulation-task",
  "schemaVersion": 1,
  "settings": {
    "timeUnit": "1ns",
    "timePrecision": "1ps",
    "duration": 2000,
    "waveform": {
      "enabled": true,
      "filename": "uart_loopback_tb.vcd"
    }
  },
  "instances": [
    {
      "id": "tx",
      "preset": {
        "kind": "protocol",
        "protocol": "uart",
        "role": "tx",
        "start": 0,
        "timeout": 10000,
        "data": [
          "8'h55"
        ],
        "options": {
          "width": 8,
          "period": 100,
          "parity": "none",
          "stopBits": 1
        }
      }
    },
    {
      "id": "rx",
      "preset": {
        "kind": "protocol",
        "protocol": "uart",
        "role": "rx",
        "start": 0,
        "timeout": 10000,
        "data": [],
        "expected": [
          "8'h55"
        ],
        "options": {
          "width": 8,
          "period": 100,
          "parity": "none",
          "stopBits": 1
        }
      }
    }
  ],
  "connections": [
    {
      "name": "uart_data",
      "endpoints": [
        {
          "kind": "instance",
          "instance": "tx",
          "port": "data"
        },
        {
          "kind": "instance",
          "instance": "rx",
          "port": "data"
        }
      ]
    }
  ],
  "logic": [],
  "defaults": {},
  "interfaceConnections": [],
  "interfaceOverrides": {},
  "presentation": {}
}
