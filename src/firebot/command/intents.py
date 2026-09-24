"""Command intents: the only thing a parser (rules or SLM) may hand to the robot.

A parser never produces actions, only an `Intent`, and every intent -- whatever its source --
goes through `validate()` before the executor sees it. Adding a command means adding it to
`SCHEMA` here; nothing else can reach the actuators.
"""
from __future__ import annotations

import math
from dataclasses import asdict, dataclass, field
from typing import Any

from firebot.sim.world import H, W

MARGIN = 0.5  # keep goals off the outer walls

# name -> {param: (type, lo, hi)} ; params not listed are rejected
SCHEMA: dict[str, dict[str, tuple[type, float | None, float | None]]] = {
    "STOP": {},                       # halt, pump off, latch until the next motion command
    "EXTINGUISH": {},                 # autonomous search -> approach -> suppress
    "GOTO": {"x": (float, MARGIN, W - MARGIN), "y": (float, MARGIN, H - MARGIN)},
    "RETURN_HOME": {},
    "STATUS": {},
    "UNKNOWN": {},                    # parser understood nothing
}
SAFE_WITHOUT_CONFIRMATION = {"STOP", "STATUS", "UNKNOWN"}


@dataclass
class Intent:
    name: str
    params: dict[str, Any] = field(default_factory=dict)
    confidence: float = 1.0
    source: str = "rules"            # "rules" | "slm"
    text: str = ""                   # the normalised utterance this came from
    needs_confirmation: bool = False

    def to_json(self) -> dict[str, Any]:
        return asdict(self)


def validate(intent: Intent) -> tuple[bool, str]:
    """Return (ok, reason). Rejects unknown intents, unknown/missing params, bad types/ranges."""
    spec = SCHEMA.get(intent.name)
    if spec is None:
        return False, f"unknown intent {intent.name!r}"
    extra = set(intent.params) - set(spec)
    if extra:
        return False, f"unexpected params {sorted(extra)}"
    for key, (typ, lo, hi) in spec.items():
        if key not in intent.params:
            return False, f"missing param {key!r}"
        try:
            v = typ(intent.params[key])
        except (TypeError, ValueError):
            return False, f"param {key!r} is not a {typ.__name__}"
        if math.isnan(v) or (lo is not None and v < lo) or (hi is not None and v > hi):
            return False, f"param {key!r}={v} outside [{lo}, {hi}]"
        intent.params[key] = v
    if not 0.0 <= intent.confidence <= 1.0:
        return False, "confidence outside [0, 1]"
    return True, "ok"
