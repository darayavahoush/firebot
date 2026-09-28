"""Sensor layout constants and thermal-frame processing. Pure numpy, no simulator imports,
so both the sim and the real-robot brain can use it."""
from __future__ import annotations

import numpy as np

US = {"us_front_left": .44, "us_front_right": -.44, "us_left": 1.57, "us_right": -1.57}
FLAME = {"flame_left": .52, "flame_center": 0.0, "flame_right": -.52}
THERM_ROWS, THERM_COLS = 24, 32
HFOV = 0.96  # MLX90640-D55 horizontal FOV (~55 deg), rad
HOT_C = 45.0


def thermal_blobs(frame: np.ndarray) -> list[dict]:
    """Segment a thermal frame into connected hot regions (8-connectivity), strongest first.

    A pixel is "warm" above HOT_C - 5 (the same support `thermal_bearing` always weighted
    over); a region only counts as a fire candidate if its peak reaches HOT_C. Each blob:
    {"peak", "area", "strength" (summed excess heat), "row", "col" (weighted centroid)}.
    Pure numpy flood fill -- no scipy/OpenCV, so it runs anywhere the brain does.
    """
    warm = frame >= (HOT_C - 5)
    seen = np.zeros_like(warm, dtype=bool)
    rows, cols = frame.shape
    blobs: list[dict] = []
    for r0 in range(rows):
        for c0 in range(cols):
            if not warm[r0, c0] or seen[r0, c0]:
                continue
            stack, cells = [(r0, c0)], []
            seen[r0, c0] = True
            while stack:
                r, c = stack.pop()
                cells.append((r, c))
                for dr in (-1, 0, 1):
                    for dc in (-1, 0, 1):
                        rr, cc = r + dr, c + dc
                        if 0 <= rr < rows and 0 <= cc < cols and warm[rr, cc] and not seen[rr, cc]:
                            seen[rr, cc] = True
                            stack.append((rr, cc))
            idx = np.array(cells)
            vals = frame[idx[:, 0], idx[:, 1]]
            peak = float(vals.max())
            if peak < HOT_C:
                continue
            w = vals - (HOT_C - 5)
            blobs.append({
                "peak": peak, "area": len(cells), "strength": float(w.sum()),
                "row": float((idx[:, 0] * w).sum() / w.sum()),
                "col": float((idx[:, 1] * w).sum() / w.sum()),
            })
    blobs.sort(key=lambda b: b["strength"], reverse=True)
    return blobs


def thermal_bearing(frame: np.ndarray) -> float | None:
    """Bearing (rad, +left) of the dominant hot region's centroid, or None if nothing is hot.

    Uses only the strongest connected blob, so a second warm object (a heater, a person) no
    longer drags the estimate toward the midpoint between it and the fire.
    """
    if float(frame.max()) < HOT_C:
        return None
    blobs = thermal_blobs(frame)
    if not blobs:
        return None
    return (15.5 - blobs[0]["col"]) * HFOV / THERM_COLS
