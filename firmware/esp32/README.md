# FireBot ESP32 Embedded Controller Firmware

This directory contains the production C++ Arduino firmware for the real-time microcontroller onboard the FireBot rover (`ESP32 DevKit V1`).

---

## 1. Hardware Architecture Overview

```
                        +----------------------+
                        |   Raspberry Pi 4/5   |
                        | (Linux / FireBot Pi) |
                        +----------+-----------+
                                   | USB Serial (115200 baud)
                                   v
+-------------------------------------------------------------------------+
|                                ESP32                                    |
|                       (Real-Time Microcontroller)                       |
+----+-------------+-------------+------------+-------------+-------------+
     |             |             |            |             |
     v             v             v            v             v
  4x HC-SR04    3x Flame      2x MQ-2      TB6612FNG     MOSFET
 Ultrasonic    Photodiodes   Gas Sensors  Motor Driver  Diaphragm
  Sensors     (L / C / R)    (Analog)      2x Motors    Water Pump
```

---

## 2. Requirements & Libraries

Install the following libraries in the **Arduino IDE** (or `platformio.ini`):
1. **ArduinoJson** (v6.x or v7.x) by Benoit Blanchon
2. **ESP32Servo** by Kevin Harrington

### Board Settings (Arduino IDE)
- **Board:** `ESP32 Dev Module` (or `DOIT ESP32 DEVKIT V1`)
- **CPU Frequency:** `240MHz (WiFi/BT)`
- **Flash Frequency:** `80MHz`
- **Upload Speed:** `921600` or `115200`
- **Core Debug Level:** `None` (to avoid polluting Serial stream)

---

## 3. Pin Mapping Reference

| ESP32 Pin | Direction | Device | Description / Signal |
|:---|:---|:---|:---|
| **GPIO 13** | Output | HC-SR04 FL | Trigger pulse (Front-Left) |
| **GPIO 34** | Input | HC-SR04 FL | Echo (via 1k/2k voltage divider to 3.3V) |
| **GPIO 12** | Output | HC-SR04 FR | Trigger pulse (Front-Right) |
| **GPIO 35** | Input | HC-SR04 FR | Echo (via 1k/2k voltage divider to 3.3V) |
| **GPIO 14** | Output | HC-SR04 Left | Trigger pulse (Left) |
| **GPIO 36 (VP)** | Input | HC-SR04 Left | Echo (via 1k/2k voltage divider to 3.3V) |
| **GPIO 27** | Output | HC-SR04 Right | Trigger pulse (Right) |
| **GPIO 39 (VN)** | Input | HC-SR04 Right | Echo (via 1k/2k voltage divider to 3.3V) |
| **GPIO 25** | Input | Flame Left | Digital output (Active LOW on fire) |
| **GPIO 26** | Input | Flame Center | Digital output (Active LOW on fire) |
| **GPIO 33** | Input | Flame Right | Digital output (Active LOW on fire) |
| **GPIO 32** | ADC Input | MQ-2 Front | Analog voltage (Smoke / Combustible gas) |
| **GPIO 15** | ADC Input | MQ-2 Rear | Analog voltage (Smoke / Combustible gas) |
| **GPIO 4**  | ADC Input | Water Level | Float / Resistive sensor (0.0=empty, 1.0=full) |
| **GPIO 2**  | ADC Input | Battery | Voltage divider (10k / 2.2k) for 12V 3S pack |
| **GPIO 18** | PWM Output | Motor Left | PWM Speed control (20 kHz, 0-255) |
| **GPIO 19** | Output | Motor Left | IN1 Direction |
| **GPIO 21** | Output | Motor Left | IN2 Direction |
| **GPIO 22** | PWM Output | Motor Right | PWM Speed control (20 kHz, 0-255) |
| **GPIO 23** | Output | Motor Right | IN3 Direction |
| **GPIO 5**  | Output | Motor Right | IN4 Direction |
| **GPIO 17** | Output | Water Pump | Gate pin for N-MOSFET (IRLZ44N) |
| **GPIO 16** | PWM Output | SG90 Servo | Extinguisher Pan Servo (50 Hz, 500-2500µs) |

---

## 4. Communication Protocol (UART @ 115200)

### Telemetry Packet (ESP32 -> Pi at 10 Hz)
```json
{
  "t": 12.34,
  "pose": [0.12, 0.45, 0.05],
  "speed": 0.25,
  "tank": 0.88,
  "turret": 0.0,
  "sensors": {
    "us_front_left": 1.45,
    "us_front_right": 1.50,
    "us_left": 2.20,
    "us_right": 1.85,
    "flame_left": 0.0,
    "flame_center": 1.0,
    "flame_right": 0.0,
    "mq2_front": 0.18,
    "mq2_rear": 0.06
  }
}
```

### Actuator Command Packet (Pi -> ESP32)
```json
{
  "v": 0.50,
  "w": -0.15,
  "pump": true,
  "turret": 0.20,
  "ack": 104
}
```

---

## 5. Built-in Failsafes
- **Hardware Watchdog:** If no command line arrives over the serial port within **500 ms**, the ESP32 zeroes motor PWM duty cycles and sets the pump MOSFET gate LOW immediately.
- **Power-on Default:** Motors and pump are guaranteed LOW during boot and initialization.
