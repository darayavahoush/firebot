"""Sensor frame -> observation vector. Runs the fusion filter.

The same class is used by the simulator (`FireEnv`) and by the PC brain on real robot data, so
controllers see identical observations in both. It needs only raw sensor readings, the robot
pose (odometry), the tank level and the measured speed.
"""
from __future__ import annotations

import numpy as np

from firebot.fusion import BearingEIF
from firebot.sensing import FLAME, US, thermal_bearing


class Perception:
    def __init__(self, vmax: float = 0.7) -> None:
        self.vmax = vmax
        self.reset()

    def reset(self) -> None:
        self.eif = BearingEIF()
        self.est: dict = {"x": 6.0, "y": 4.0, "sigma": 10.0}

    def _fuse(self, s: dict, x: float, y: float, th: float) -> tuple[bool, float]:
        zt = thermal_bearing(s["thermal"])
        seen = zt is not None
        if seen:
            self.eif.update(x, y, th, zt, 0.04)
        else:
            f = np.array([s[n] for n in FLAME])
            if f.sum() > .15:
                self.eif.update(x, y, th, float((f * np.array(list(FLAME.values()))).sum() / f.sum()), .3)
        return seen, zt or 0.0

    def update(self, s: dict, pose, tank: float, speed: float) -> np.ndarray:
        x, y, th = (float(v) for v in pose)
        seen, zt = self._fuse(s, x, y, th)
        m, P = self.eif.mean, self.eif.cov
        eb = float(np.arctan2(m[1] - y, m[0] - x) - th)
        eb = float(np.arctan2(np.sin(eb), np.cos(eb)))
        sigma = float(np.sqrt(max(P[0, 0], P[1, 1])))
        self.est = {"x": float(m[0]), "y": float(m[1]), "sigma": sigma}
        o = [*(s[n] / 4 for n in US), *(s[n] for n in FLAME), max(s["mq2_front"], s["mq2_rear"]),
             float(seen), zt / .5, eb / np.pi, min(np.hypot(m[0] - x, m[1] - y), 10) / 10,
             min(sigma, 4) / 4, (float(np.max(s["thermal"])) - 25) / 325, tank, speed / self.vmax]
        return np.array(o, dtype=np.float32)
