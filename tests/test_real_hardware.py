"""Unit tests for RealHardware driver (bench & mock modes)."""
from __future__ import annotations

import json
from unittest.mock import MagicMock

from firebot.link.protocol import Command
from firebot.link.realhw import RealHardware


def test_real_hardware_defaults_without_devices(monkeypatch):
    """RealHardware should initialise safely even when no serial device or I2C bus is connected."""
    monkeypatch.setattr("firebot.link.realhw.find_serial_port", lambda: "/dev/null")

    hw = RealHardware(port="/dev/null")
    frame = hw.read()

    assert frame.seq == 0
    assert len(frame.thermal) == 24
    assert len(frame.thermal[0]) == 32
    assert "us_front_left" in frame.sensors
    assert "flame_center" in frame.sensors
    assert "mq2_front" in frame.sensors
    assert frame.tank == 1.0

    # Test stop is idempotent and does not raise
    hw.stop()
    hw.stop()


def test_real_hardware_serial_roundtrip(monkeypatch):
    """Test reading telemetry packets and sending actuation commands."""
    hw = RealHardware(port="/dev/null")

    mock_ser = MagicMock()
    mock_payload = {
        "t": 15.5,
        "pose": [1.2, 0.4, 0.78],
        "speed": 0.35,
        "tank": 0.82,
        "turret": 0.15,
        "sensors": {
            "us_front_left": 1.25,
            "us_front_right": 1.10,
            "us_left": 2.50,
            "us_right": 0.85,
            "flame_left": 0.0,
            "flame_center": 1.0,
            "flame_right": 0.0,
            "mq2_front": 0.22,
            "mq2_rear": 0.05,
        },
    }
    raw_line = (json.dumps(mock_payload) + "\n").encode()
    mock_ser.in_waiting = len(raw_line)
    mock_ser.readline.side_effect = [raw_line, b""]

    hw.ser = mock_ser
    frame = hw.read()

    assert frame.t == 15.5
    assert frame.pose == (1.2, 0.4, 0.78)
    assert frame.speed == 0.35
    assert frame.tank == 0.82
    assert frame.turret == 0.15
    assert frame.sensors["flame_center"] == 1.0
    assert frame.sensors["us_front_left"] == 1.25

    # Test apply writes valid JSON
    cmd = Command(v=0.45, w=-0.2, pump=True, turret=0.1, ack=99)
    hw.apply(cmd)
    assert mock_ser.write.called
    written_data = mock_ser.write.call_args[0][0].decode()
    parsed_cmd = json.loads(written_data)
    assert parsed_cmd["v"] == 0.45
    assert parsed_cmd["w"] == -0.2
    assert parsed_cmd["pump"] is True
    assert parsed_cmd["turret"] == 0.1
    assert parsed_cmd["ack"] == 99
