"""RuleController with lidar-based obstacle avoidance.

The four ultrasonic beams miss anything thinner than the gap between them (tree trunks, shelf
legs, doorframes). The scan plane (`FireEnv.scan`, 36 rays over 360 deg) doesn't, so this
controller keeps the rule baseline's explore / track / spray logic and swaps in a
gap-following avoidance step: when the way ahead is blocked, steer toward the most open
heading instead of just spinning left or right.
"""
from __future__ import annotations

import numpy as np

from .controller import RuleController

BLOCKED, CLEAR = 0.7, 1.1       # m: start avoiding below BLOCKED, release above CLEAR
HALF_WIDTH = 0.26              # m: corridor half-width a heading must keep clear (robot r=.22);
                               # narrower than the frontier planner's 0.3 m inflation so a planned path never reads as blocked
SIDE_MIN = 0.35                 # m: nudge away from anything closer than this abeam


def corridor_clearance(scan: np.ndarray, rel: np.ndarray) -> np.ndarray:
    """For each candidate heading, the free distance along a corridor `2*HALF_WIDTH` wide: every
    lidar hit that lies inside the corridor limits it. Unlike a fixed angular window this lets
    the robot through a doorway (hits abeam at >HALF_WIDTH don't count) while still seeing a
    thin trunk dead ahead."""
    d = rel[None, :] - rel[:, None]                  # [heading, ray] angle difference
    fwd, lat = scan[None, :] * np.cos(d), np.abs(scan[None, :] * np.sin(d))
    inside = (fwd > 0) & (lat < HALF_WIDTH)
    return np.where(inside, fwd, np.inf).min(axis=1).clip(max=float(scan.max()))


class ScanController(RuleController):
    sticky_spray = True

    def __init__(self) -> None:
        super().__init__()
        self._scan: np.ndarray | None = None

    def act(self, obs: np.ndarray, dt: float = 0.1, scan: np.ndarray | None = None) -> np.ndarray:
        self._scan = scan
        return super().act(obs, dt)

    def _avoid(self, v: float, w: float, us: np.ndarray) -> tuple[float, float]:
        scan = self._scan
        if scan is None:  # no lidar: fall back to the ultrasonic behaviour
            return super()._avoid(v, w, us)
        n = len(scan)
        rel = -np.pi + 2 * np.pi * np.arange(n) / n
        win = corridor_clearance(scan, rel)
        ahead = n // 2                                   # ray at rel = 0
        front = float(win[ahead])
        if self.avoid and front > CLEAR:
            self.avoid = 0
        if front < BLOCKED or self.avoid:
            if not self.avoid:  # commit to the side of the most open heading (no dithering)
                score = np.minimum(win, 2.0) - 0.25 * np.abs(rel)
                score[np.abs(rel) > np.deg2rad(150)] = -np.inf
                best = float(rel[int(np.argmax(score))])
                self.avoid = 1 if best > 0 or (best == 0 and scan[ahead + 3] >= scan[ahead - 3]) else -1
            return (.15 if front > .5 else 0.0), 1.7 * self.avoid
        left, right = float(scan[n // 4 - 1:n // 4 + 2].min()), float(scan[3 * n // 4 - 1:3 * n // 4 + 2].min())
        if right < SIDE_MIN:
            w += .6
        if left < SIDE_MIN:
            w -= .6
        return v, w
