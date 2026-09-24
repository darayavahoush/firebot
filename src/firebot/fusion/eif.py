"""Extended Information Filter for a static 2D fire source from bearing-only measurements."""
from __future__ import annotations

import numpy as np


def wrap(a: float) -> float:
    return float(np.arctan2(np.sin(a), np.cos(a)))


class BearingEIF:
    """State: fire position [x, y]. Measurement: bearing relative to robot heading."""

    def __init__(self, prior_mean=(6.0, 4.0), prior_info: float = 0.01) -> None:
        self.Y = np.eye(2) * prior_info
        self.y = self.Y @ np.asarray(prior_mean, dtype=float)

    @property
    def mean(self) -> np.ndarray:
        return np.linalg.solve(self.Y, self.y)

    @property
    def cov(self) -> np.ndarray:
        return np.linalg.inv(self.Y)

    def update(self, robot_x: float, robot_y: float, robot_th: float, z: float, sigma: float):
        """Fuse one bearing measurement `z` (rad, relative to heading) with std `sigma`."""
        m = self.mean
        dx, dy = m[0] - robot_x, m[1] - robot_y
        r2 = dx * dx + dy * dy + 1e-9
        h = wrap(np.arctan2(dy, dx) - robot_th)
        H = np.array([[-dy / r2, dx / r2]])
        ri = 1.0 / sigma**2
        innov = wrap(z - h)
        self.Y = self.Y + ri * (H.T @ H)
        self.y = self.y + ri * (H.T[:, 0] * (innov + float((H @ m).item())))
