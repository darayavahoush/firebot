"""RRT* on the world's occupancy grid (pure numpy, no OMPL dependency).

`Planner` is the interface the rest of the code depends on, so an OMPL-backed planner can be
dropped in later without touching controllers. Collision checking uses a grid inflated by the
robot radius plus a safety margin, so a path of straight segments is safe for the point robot.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol

import numpy as np

from firebot.sim.world import RES, World

ROBOT_RADIUS = 0.22  # matches FireEnv's collision radius


class Planner(Protocol):
    def plan(self, start: tuple[float, float], goal: tuple[float, float]) -> np.ndarray | None:
        """Return an (N, 2) polyline from start to goal in metres, or None."""


def inflate(grid: np.ndarray, radius: float) -> np.ndarray:
    """Binary dilation of `grid` by a disk of `radius` metres (numpy only)."""
    k = int(np.ceil(radius / RES))
    out = grid.copy()
    for di in range(-k, k + 1):
        for dj in range(-k, k + 1):
            if di * di + dj * dj > k * k or (di == 0 and dj == 0):
                continue
            src = grid[max(0, -di):grid.shape[0] - max(0, di), max(0, -dj):grid.shape[1] - max(0, dj)]
            out[max(0, di):grid.shape[0] - max(0, -di), max(0, dj):grid.shape[1] - max(0, -dj)] |= src
    return out


class CostMap:
    """Inflated occupancy grid with fast point / segment tests."""

    def __init__(self, world: World, margin: float = 0.08) -> None:
        self.grid = inflate(world.grid, ROBOT_RADIUS + margin)

    def free(self, p: np.ndarray) -> np.ndarray:
        p = np.atleast_2d(p)
        j, i = (p[:, 0] / RES).astype(int), (p[:, 1] / RES).astype(int)
        ok = (i >= 0) & (i < self.grid.shape[0]) & (j >= 0) & (j < self.grid.shape[1])
        out = np.zeros(len(p), dtype=bool)
        out[ok] = ~self.grid[i[ok], j[ok]]
        return out

    def segment_free(self, a: np.ndarray, b: np.ndarray) -> bool:
        n = max(2, int(np.hypot(*(b - a)) / (RES * 0.5)) + 1)
        t = np.linspace(0.0, 1.0, n)[:, None]
        return bool(self.free(a + (b - a) * t).all())

    def nearest_free(self, p: np.ndarray, max_r: float = 1.0) -> np.ndarray | None:
        """Closest free point to `p` (searching rings outward), or None."""
        if self.free(p)[0]:
            return np.asarray(p, dtype=float)
        for r in np.arange(RES, max_r, RES):
            ang = np.linspace(0, 2 * np.pi, max(8, int(2 * np.pi * r / RES)), endpoint=False)
            c = np.asarray(p) + r * np.stack([np.cos(ang), np.sin(ang)], axis=1)
            ok = self.free(c)
            if ok.any():
                return c[np.argmax(ok)]
        return None


@dataclass
class RRTStar:
    world: World
    step: float = 0.5
    max_iter: int = 2500
    goal_bias: float = 0.1
    goal_tol: float = 0.25
    gamma: float = 2.5  # rewiring radius scale
    smooth_iter: int = 60
    seed: int | None = None

    def __post_init__(self) -> None:
        self.cmap = CostMap(self.world)
        self.rng = np.random.default_rng(self.seed)

    def plan(self, start, goal) -> np.ndarray | None:
        s, g = self.cmap.nearest_free(np.array(start, float)), self.cmap.nearest_free(np.array(goal, float))
        if s is None or g is None:
            return None
        if self.cmap.segment_free(s, g):
            return self._finish([np.array(start, float), g])
        pts = np.zeros((self.max_iter + 1, 2))
        parent = -np.ones(self.max_iter + 1, dtype=int)
        cost = np.zeros(self.max_iter + 1)
        pts[0], n, best, best_cost = s, 1, -1, np.inf
        for _ in range(self.max_iter):
            q = (g if self.rng.random() < self.goal_bias
                 else self.rng.uniform([0, 0], [self.world.width, self.world.height]))
            d = np.hypot(*(pts[:n] - q).T)
            i = int(np.argmin(d))
            direction = (q - pts[i]) / max(d[i], 1e-9)
            new = pts[i] + direction * min(self.step, d[i])
            if not self.cmap.free(new)[0] or not self.cmap.segment_free(pts[i], new):
                continue
            r = min(self.gamma * np.sqrt(np.log(n + 1) / (n + 1)) * 2.0, 2.0 * self.step)
            dn = np.hypot(*(pts[:n] - new).T)
            near = np.where(dn <= max(r, self.step))[0]
            # choose the cheapest collision-free parent among neighbours
            p_best, c_best = i, cost[i] + np.hypot(*(new - pts[i]))
            for j in near[np.argsort(cost[near] + dn[near])]:
                cj = cost[j] + dn[j]
                if cj < c_best and self.cmap.segment_free(pts[j], new):
                    p_best, c_best = int(j), cj
                    break
            pts[n], parent[n], cost[n] = new, p_best, c_best
            for j in near:  # rewire neighbours through the new node
                cj = c_best + dn[j]
                if cj < cost[j] and self.cmap.segment_free(new, pts[j]):
                    delta = cj - cost[j]
                    parent[j], cost[j] = n, cj
                    self._propagate(parent, cost, j, delta, n)
            if np.hypot(*(new - g)) < self.goal_tol and self.cmap.segment_free(new, g):
                total = c_best + np.hypot(*(g - new))
                if total < best_cost:
                    best, best_cost = n, total
            n += 1
        if best < 0:
            return None
        path, k = [g], best
        while k >= 0:
            path.append(pts[k].copy())
            k = parent[k]
        return self._finish(path[::-1])

    @staticmethod
    def _propagate(parent, cost, root, delta, n) -> None:
        kids = np.where(parent[:n] == root)[0]
        for k in kids:
            cost[k] += delta
            RRTStar._propagate(parent, cost, k, delta, n)

    def _finish(self, path: list[np.ndarray]) -> np.ndarray:
        path = [np.asarray(p, float) for p in path]
        for _ in range(self.smooth_iter):  # random shortcutting
            if len(path) < 3:
                break
            a, b = sorted(self.rng.choice(len(path), 2, replace=False))
            if b - a > 1 and self.cmap.segment_free(path[a], path[b]):
                path = path[:a + 1] + path[b:]
        return np.array(path)


def path_length(path: np.ndarray) -> float:
    return float(np.hypot(*np.diff(path, axis=0).T).sum()) if len(path) > 1 else 0.0
