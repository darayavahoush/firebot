"""Default equipment registry. Edit mount poses/pins to match the real robot."""

DEFAULT_DEVICES: list[dict] = [
    *[dict(name=n, kind="sensor", model="HC-SR04", controller="esp", bus="gpio", unit="m")
      for n in ("us_front_left", "us_front_right", "us_left", "us_right")],
    *[dict(name=n, kind="sensor", model="IR flame module", controller="esp", bus="gpio",
           unit="norm") for n in ("flame_left", "flame_center", "flame_right")],
    *[dict(name=n, kind="sensor", model="MQ-2", controller="esp", bus="adc", unit="norm")
      for n in ("mq2_front", "mq2_rear")],
    dict(name="thermal_cam", kind="camera", model="MLX90640-D55", controller="pi", bus="i2c",
         address="0x33", unit="degC"),
    dict(name="rgb_cam", kind="camera", model="Raspberry Pi Camera", controller="pi", bus="csi"),
    dict(name="imu", kind="sensor", model="unspecified", controller="esp", bus="i2c"),
    dict(name="water_level", kind="sensor", controller="esp", bus="adc", unit="norm"),
    dict(name="battery_monitor", kind="power", controller="esp", bus="adc", unit="V"),
    dict(name="servo_pan", kind="actuator", model="SG90", controller="esp", bus="pwm",
         unit="rad"),
    dict(name="servo_tilt", kind="actuator", model="SG90", controller="esp", bus="pwm",
         unit="rad"),
    dict(name="pump", kind="actuator", model="12V diaphragm", controller="esp", bus="gpio",
         unit="duty", notes="switched via logic-level MOSFET, fused"),
    dict(name="motor_left", kind="actuator", model="geared DC", controller="esp", bus="pwm",
         unit="duty"),
    dict(name="motor_right", kind="actuator", model="geared DC", controller="esp", bus="pwm",
         unit="duty"),
    dict(name="pi", kind="compute", model="Raspberry Pi"),
    dict(name="esp", kind="compute", model="ESP"),
]
