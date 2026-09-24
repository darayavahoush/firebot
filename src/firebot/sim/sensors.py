"""Sensor models. Names match the device registry in firebot.db.devices."""
from __future__ import annotations

import numpy as np

from .world import Fire, World

US = {"us_front_left": .44, "us_front_right": -.44, "us_left": 1.57, "us_right": -1.57}
FLAME = {"flame_left": .52, "flame_center": 0.0, "flame_right": -.52}
THERM_ROWS, THERM_COLS = 24, 32
HFOV = 0.96  # MLX90640-D55 horizontal FOV (~55 deg), rad
HOT_C = 45.0


def _wrap(a: float) -> float:
    return float(np.arctan2(np.sin(a), np.cos(a)))


def read_sensors(world: World, fire: Fire, rx, ry, th, rng: np.random.Generator) -> dict:
    """Return scalar sensor readings, a thermal frame, and ground-truth visibility."""
    dx, dy = fire.x - rx, fire.y - ry
    d = float(np.hypot(dx, dy))
    ba = float(np.arctan2(dy, dx))
    vis = fire.p > 0 and d < 8 and world.line_of_sight(rx, ry, fire.x, fire.y)
    out: dict = {}
    for n, a in US.items():
        out[n] = float(np.clip(world.ray(rx, ry, th + a, 4.0) + rng.normal(0, .02), .02, 4.0))
    for n, a in FLAME.items():
        b = _wrap(ba - th - a)
        v = fire.p * (1 - abs(b) / .6) * min(1.0, 3.0 / max(d, 1e-3)) if vis and abs(b) < .6 else 0
        out[n] = float(np.clip(v + rng.normal(0, .02), 0, 1)) if v else max(0.0, rng.normal(0, .01))
    g = fire.gas(rx, ry)
    out["mq2_front"] = float(np.clip(g + rng.normal(0, .02), 0, 1))
    out["mq2_rear"] = float(np.clip(g * .9 + rng.normal(0, .02), 0, 1))

    frame = 25.0 + rng.normal(0, .3, (THERM_ROWS, THERM_COLS))
    b0 = _wrap(ba - th)
    if vis and abs(b0) < HFOV / 2:
        col = 15.5 - b0 / HFOV * THERM_COLS
        rr, cc = np.mgrid[0:THERM_ROWS, 0:THERM_COLS]
        frame += (fire.peak_temp(d) - 25) * np.exp(-((cc - col) ** 2 + (rr - 12) ** 2) / (2 * 1.5**2))
    out["thermal"] = frame.astype(np.float32)
    out["_truth"] = {"dist": d, "bearing": b0, "visible": vis}
    return out


def thermal_bearing(frame: np.ndarray) -> float | None:
    """Bearing (rad, +left) of the hotspot centroid, or None if nothing is hot."""
    if float(frame.max()) < HOT_C:
        return None
    w = np.clip(frame - (HOT_C - 5), 0, None)
    col = float((w.sum(axis=0) * np.arange(frame.shape[1])).sum() / w.sum())
    return (15.5 - col) * HFOV / THERM_COLS
