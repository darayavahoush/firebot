"""2D world: walls on an occupancy grid, vectorised ray casting, fire and gas fields."""
from __future__ import annotations

import numpy as np

W, H, RES = 12.0, 8.0, 0.05
# (x, y, w, h) rectangles in metres
DEFAULT_WALLS = [(0, 0, 12, .1), (0, 7.9, 12, .1), (0, 0, .1, 8), (11.9, 0, .1, 8),
                 (3, 1.5, .3, 3.5), (6.5, 3.5, 3, .3), (7.5, 6, .3, 1.9)]
_OFFS = np.array([[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1], [.7, .7], [-.7, .7], [.7, -.7],
                  [-.7, -.7]])


class World:
    def __init__(self, walls=None, width: float = W, height: float = H) -> None:
        """`width`/`height` default to the module constants (the fixed single-room map every
        other test and the command schema assume). Passing larger values -- see
        `World.random()` -- builds a bigger instance without touching that default."""
        self.walls = list(walls if walls is not None else DEFAULT_WALLS)
        self.width, self.height = float(width), float(height)
        self.grid = np.zeros((int(self.height / RES), int(self.width / RES)), dtype=bool)
        for x, y, w, h in self.walls:
            self.grid[int(y / RES):int(np.ceil((y + h) / RES)),
                      int(x / RES):int(np.ceil((x + w) / RES))] = True

    @classmethod
    def random(cls, rng: np.random.Generator | None = None, seed: int | None = None) -> World:
        """A bigger, procedurally-generated multi-room building, different every call.

        Uses `firebot.sim.mapgen.generate_building` (BSP room partition + doorways) so training
        and demo runs aren't stuck fighting the same single pillar every episode.
        """
        from .mapgen import generate_building
        rng = rng if rng is not None else np.random.default_rng(seed)
        width, height, walls = generate_building(rng)
        return cls(walls=walls, width=width, height=height)

    def occupied(self, x, y):
        """Vectorised occupancy test; out-of-bounds counts as occupied."""
        x, y = np.asarray(x), np.asarray(y)
        i, j = (y / RES).astype(int), (x / RES).astype(int)
        ok = (i >= 0) & (i < self.grid.shape[0]) & (j >= 0) & (j < self.grid.shape[1])
        out = np.ones(np.shape(x), dtype=bool)
        out[ok] = self.grid[i[ok], j[ok]]
        return out

    def is_free(self, x: float, y: float, r: float = 0.0) -> bool:
        pts = np.array([x, y]) + _OFFS * r
        return not bool(self.occupied(pts[:, 0], pts[:, 1]).any())

    def ray(self, x: float, y: float, a: float, max_range: float) -> float:
        """Distance to the first wall along angle `a` (max_range if none)."""
        d = np.arange(0.0, max_range, RES * 0.8)
        hits = self.occupied(x + np.cos(a) * d, y + np.sin(a) * d)
        return float(d[np.argmax(hits)]) if hits.any() else float(max_range)

    def line_of_sight(self, x0, y0, x1, y1) -> bool:
        d = float(np.hypot(x1 - x0, y1 - y0))
        return self.ray(x0, y0, float(np.arctan2(y1 - y0, x1 - x0)), d) >= d - 0.2

    def random_free_point(self, rng: np.random.Generator, margin=0.5, avoid=None, min_dist=0.0):
        while True:
            x, y = rng.uniform(1, self.width - 1), rng.uniform(1, self.height - 1)
            if not self.is_free(x, y, margin):
                continue
            if avoid is not None and np.hypot(x - avoid[0], y - avoid[1]) < min_dist:
                continue
            return float(x), float(y)


class Fire:
    def __init__(self, x: float, y: float, intensity: float = 1.0) -> None:
        self.x, self.y, self.p = x, y, intensity

    def gas(self, rx: float, ry: float) -> float:
        return self.p * float(np.exp(-np.hypot(self.x - rx, self.y - ry) / 4.0))

    def peak_temp(self, d: float) -> float:
        return 25.0 + self.p * 320.0 / (1.0 + d * d * 0.3)
