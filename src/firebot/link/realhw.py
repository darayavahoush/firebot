"""Real robot hardware driver for Raspberry Pi + ESP32.

Complies with the `Hardware` protocol required by `firebot.link.agent:PiAgent`.
Communicates with:
  1. MLX90640 Far-Infrared 32x24 Thermal Camera via hardware I2C (0x33).
  2. ESP32 Real-Time Microcontroller via Serial/UART (115200 baud).

Fail-safe:
  - If serial comms drops, `stop()` zeros actuators idempotently.
  - If MLX90640 drops or is disconnected, reports ambient fallback temperatures.
"""
from __future__ import annotations

import glob
import json
import logging
import time
from typing import Any

from .protocol import SCALARS, THERM_COLS, THERM_ROWS, Command, Frame

log = logging.getLogger("firebot.realhw")

# Optional PySerial import
try:
    import serial
except ImportError:
    serial = None  # type: ignore[assignment]

# Optional Adafruit CircuitPython MLX90640 import
try:
    import board
    import busio
    import adafruit_mlx90640
except ImportError:
    adafruit_mlx90640 = None  # type: ignore[assignment]


def find_serial_port() -> str:
    """Auto-detect ESP32 serial port on Linux/Raspberry Pi/macOS."""
    candidates = (
        glob.glob("/dev/ttyUSB*")
        + glob.glob("/dev/ttyACM*")
        + glob.glob("/dev/serial0")
        + glob.glob("/dev/cu.usbserial*")
        + glob.glob("/dev/cu.usbmodem*")
    )
    if candidates:
        return candidates[0]
    return "/dev/ttyUSB0"


class RealHardware:
    """Production driver connecting Raspberry Pi to ESP32 and MLX90640."""

    def __init__(
        self,
        port: str = "auto",
        baud: int = 115200,
        i2c_bus: int = 1,
        thermal_fps: int = 8,
    ) -> None:
        self.port = find_serial_port() if port == "auto" else port
        self.baud = baud
        self.i2c_bus = i2c_bus
        self.thermal_fps = thermal_fps

        self.ser: Any = None
        self.mlx: Any = None
        self._raw_thermal = [25.0] * (THERM_ROWS * THERM_COLS)

        # Cached state in case of intermittent serial reads
        self._last_t = time.monotonic()
        self._pose = (0.0, 0.0, 0.0)
        self._speed = 0.0
        self._tank = 1.0
        self._turret = 0.0
        self._sensors = {s: 0.0 for s in SCALARS}
        # Provide reasonable defaults for distances
        self._sensors["us_front_left"] = 2.0
        self._sensors["us_front_right"] = 2.0
        self._sensors["us_left"] = 2.0
        self._sensors["us_right"] = 2.0

        self._init_mlx()
        self._init_serial()

    def _init_mlx(self) -> None:
        """Initialize MLX90640 I2C sensor if available."""
        if adafruit_mlx90640 is None:
            log.warning("adafruit_mlx90640 library not installed; thermal frames will be simulated")
            return

        try:
            # Raspberry Pi hardware I2C
            i2c = busio.I2C(board.SCL, board.SDA, frequency=400000)
            self.mlx = adafruit_mlx90640.MLX90640(i2c)
            # 8 Hz is optimal for MLX90640 SNR and latency
            self.mlx.refresh_rate = adafruit_mlx90640.RefreshRate.REFRESH_8_HZ
            log.info("MLX90640 thermal camera initialized on I2C @ 0x33")
        except Exception as e:
            log.warning("Could not connect to MLX90640 on I2C (%s); using ambient fallback", e)
            self.mlx = None

    def _init_serial(self) -> None:
        """Connect to ESP32 microcontroller over Serial."""
        if serial is None:
            log.warning("pyserial library not installed; cannot communicate with ESP32")
            return

        try:
            self.ser = serial.Serial(self.port, self.baud, timeout=0.05)
            # Give ESP32 1.5s to reset if DTR toggled
            time.sleep(1.5)
            self.ser.reset_input_buffer()
            self.ser.reset_output_buffer()
            log.info("Connected to ESP32 on %s @ %d baud", self.port, self.baud)
        except Exception as e:
            log.warning("Failed to open serial port %s (%s). Retrying in loop...", self.port, e)
            self.ser = None

    def _read_esp32_telemetry(self) -> None:
        """Read latest lines from ESP32 serial buffer (non-blocking)."""
        if self.ser is None:
            # Try to reconnect
            try:
                self.ser = serial.Serial(self.port, self.baud, timeout=0.05)
                self.ser.reset_input_buffer()
            except Exception:
                return

        try:
            while self.ser.in_waiting > 0:
                raw_line = self.ser.readline()
                if not raw_line:
                    break
                line = raw_line.decode("utf-8", errors="ignore").strip()
                if not line.startswith("{") or not line.endswith("}"):
                    continue
                try:
                    msg = json.loads(line)
                except json.JSONDecodeError:
                    continue

                # Parse fields
                if "t" in msg:
                    self._last_t = float(msg["t"])
                if "pose" in msg and isinstance(msg["pose"], list) and len(msg["pose"]) == 3:
                    self._pose = (float(msg["pose"][0]), float(msg["pose"][1]), float(msg["pose"][2]))
                if "speed" in msg:
                    self._speed = float(msg["speed"])
                if "tank" in msg:
                    self._tank = max(0.0, min(1.0, float(msg["tank"])))
                if "turret" in msg:
                    self._turret = float(msg["turret"])

                sensors = msg.get("sensors", {})
                if isinstance(sensors, dict):
                    for k in SCALARS:
                        if k in sensors:
                            self._sensors[k] = float(sensors[k])
        except Exception as e:
            log.warning("Serial read exception: %s", e)
            try:
                if self.ser:
                    self.ser.close()
            except Exception:
                pass
            self.ser = None

    def _read_thermal_frame(self) -> list[list[float]]:
        """Sample 32x24 thermal image from MLX90640."""
        if self.mlx is not None:
            try:
                self.mlx.getFrame(self._raw_thermal)
            except (ValueError, OSError) as e:
                log.debug("MLX90640 frame read retry: %s", e)
                # Keep prior thermal values on occasional I2C checksum error

        # Reshape flat 768 pixels to 24 rows x 32 columns
        grid: list[list[float]] = []
        for r in range(THERM_ROWS):
            row = [round(float(self._raw_thermal[r * THERM_COLS + c]), 1) for c in range(THERM_COLS)]
            grid.append(row)
        return grid

    def read(self) -> Frame:
        """Sample all sensors + thermal camera + odometry. Must return quickly."""
        self._read_esp32_telemetry()
        thermal_matrix = self._read_thermal_frame()

        return Frame(
            seq=0,  # seq is stamped by PiAgent._send_loop
            t=self._last_t,
            pose=self._pose,
            speed=self._speed,
            tank=self._tank,
            sensors=dict(self._sensors),
            thermal=thermal_matrix,
            turret=self._turret,
        )

    def apply(self, cmd: Command) -> None:
        """Send actuator command down to ESP32 over serial."""
        if self.ser is None:
            return

        payload = {
            "v": round(float(cmd.v), 3),
            "w": round(float(cmd.w), 3),
            "pump": bool(cmd.pump),
            "turret": round(float(cmd.turret), 3),
            "ack": int(cmd.ack),
        }
        try:
            line = json.dumps(payload, separators=(",", ":")) + "\n"
            self.ser.write(line.encode("ascii"))
            self.ser.flush()
        except Exception as e:
            log.warning("Serial write failed: %s", e)
            try:
                self.ser.close()
            except Exception:
                pass
            self.ser = None

    def stop(self) -> None:
        """Emergency stop: zero motors, turn off water pump. Idempotent & safe."""
        if self.ser is None:
            return

        try:
            payload = {"v": 0.0, "w": 0.0, "pump": False, "turret": 0.0, "ack": -1}
            line = json.dumps(payload, separators=(",", ":")) + "\n"
            self.ser.write(line.encode("ascii"))
            self.ser.flush()
        except Exception:
            pass  # stop() must never raise


if __name__ == "__main__":
    # Bench test helper: python -m firebot.link.realhw
    import sys
    logging.basicConfig(level=logging.INFO)
    print("Testing RealHardware connection...")
    hw = RealHardware()
    print("Polling 10 frames from hardware:")
    for i in range(10):
        frame = hw.read()
        print(f"[{i}] t={frame.t:.2f}s speed={frame.speed:.2f}m/s tank={frame.tank:.2f} "
              f"flame_c={frame.sensors['flame_center']} us_fl={frame.sensors['us_front_left']}m "
              f"temp_center={frame.thermal[12][16]}C")
        time.sleep(0.1)
    hw.stop()
    print("Test completed safely.")
