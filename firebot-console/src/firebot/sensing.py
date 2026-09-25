"""Sensor layout constants and thermal-frame processing. Pure numpy, no simulator imports,
so both the sim and the real-robot brain can use it."""
from __future__ import annotations

import numpy as np

US = {"us_front_left": .44, "us_front_right": -.44, "us_left": 1.57, "us_right": -1.57}
FLAME = {"flame_left": .52, "flame_center": 0.0, "flame_right": -.52}
THERM_ROWS, THERM_COLS = 24, 32
HFOV = 0.96  # MLX90640-D55 horizontal FOV (~55 deg), rad
HOT_C = 45.0


def thermal_bearing(frame: np.ndarray) -> float | None:
    """Bearing (rad, +left) of the hotspot centroid, or None if nothing is hot."""
    if float(frame.max()) < HOT_C:
        return None
    w = np.clip(frame - (HOT_C - 5), 0, None)
    col = float((w.sum(axis=0) * np.arange(frame.shape[1])).sum() / w.sum())
    return (15.5 - col) * HFOV / THERM_COLS
