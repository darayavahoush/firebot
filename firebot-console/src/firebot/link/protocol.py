"""Wire protocol: newline-delimited JSON over TCP. Stdlib only (runs on the Pi).

Pi -> PC   hello  {"type","version","robot","token"}
           frame  {"type","seq","t","pose":[x,y,th],"speed","tank","sensors":{...}}
           bye    {"type"}
PC -> Pi   welcome {"type","session"}         error {"type","reason"}
           cmd     {"type","ack","v","w","pump"}   v in [0,1], w in [-1,1] (normalised), pump bool

Everything received is validated: a malformed frame is dropped by the brain, a malformed
command is ignored by the Pi (and the Pi's watchdog stops the robot if valid ones stop coming).
"""
from __future__ import annotations

import json
import math
from dataclasses import dataclass, field

VERSION = 1
MAX_LINE = 256 * 1024
THERM_ROWS, THERM_COLS = 24, 32

SCALARS = ("us_front_left", "us_front_right", "us_left", "us_right",
           "flame_left", "flame_center", "flame_right", "mq2_front", "mq2_rear")


class ProtocolError(ValueError):
    pass


def _num(v, name: str) -> float:
    if isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v):
        raise ProtocolError(f"{name} is not a finite number")
    return float(v)


@dataclass
class Frame:
    seq: int
    t: float                                  # hardware clock, seconds
    pose: tuple[float, float, float]          # odometry x, y, heading
    speed: float                              # measured forward speed, m/s
    tank: float                               # water level 0..1
    sensors: dict[str, float] = field(default_factory=dict)
    thermal: list[list[float]] = field(default_factory=list)  # 24 x 32, degC

    def to_msg(self) -> dict:
        return {"type": "frame", "seq": self.seq, "t": self.t, "pose": list(self.pose),
                "speed": self.speed, "tank": self.tank,
                "sensors": {**self.sensors, "thermal": self.thermal}}


@dataclass
class Command:
    v: float = 0.0
    w: float = 0.0
    pump: bool = False
    ack: int = -1

    def to_msg(self) -> dict:
        return {"type": "cmd", "ack": self.ack, "v": self.v, "w": self.w, "pump": self.pump}


STOP = Command()


def parse_frame(msg: dict) -> Frame:
    try:
        pose = msg["pose"]
        if not isinstance(pose, list) or len(pose) != 3:
            raise ProtocolError("pose must be [x, y, theta]")
        s = msg["sensors"]
        if not isinstance(s, dict):
            raise ProtocolError("sensors must be an object")
        sensors = {n: _num(s[n], n) for n in SCALARS}
        th = s["thermal"]
        if (not isinstance(th, list) or len(th) != THERM_ROWS
                or any(not isinstance(r, list) or len(r) != THERM_COLS for r in th)):
            raise ProtocolError(f"thermal must be {THERM_ROWS}x{THERM_COLS}")
        thermal = [[_num(x, "thermal") for x in r] for r in th]
        seq = msg["seq"]
        if isinstance(seq, bool) or not isinstance(seq, int):
            raise ProtocolError("seq must be an integer")
        return Frame(seq, _num(msg["t"], "t"), tuple(_num(p, "pose") for p in pose),  # type: ignore[arg-type]
                     _num(msg["speed"], "speed"), min(1.0, max(0.0, _num(msg["tank"], "tank"))),
                     sensors, thermal)
    except KeyError as e:
        raise ProtocolError(f"missing field {e}") from None


def parse_command(msg: dict) -> Command:
    """Clamp to the physical range; reject anything non-numeric."""
    try:
        v = min(1.0, max(0.0, _num(msg["v"], "v")))
        w = min(1.0, max(-1.0, _num(msg["w"], "w")))
        pump = msg["pump"]
        if not isinstance(pump, bool):
            raise ProtocolError("pump must be boolean")
        ack = msg.get("ack", -1)
        return Command(v, w, pump, ack if isinstance(ack, int) and not isinstance(ack, bool) else -1)
    except KeyError as e:
        raise ProtocolError(f"missing field {e}") from None


def encode(msg: dict) -> bytes:
    return json.dumps(msg, separators=(",", ":"), allow_nan=False).encode() + b"\n"


def decode(line: bytes) -> dict:
    if len(line) > MAX_LINE:
        raise ProtocolError("line too long")
    try:
        msg = json.loads(line)
    except (ValueError, UnicodeDecodeError) as e:
        raise ProtocolError(f"bad json: {e}") from None
    if not isinstance(msg, dict) or not isinstance(msg.get("type"), str):
        raise ProtocolError("message must be an object with a string 'type'")
    return msg
