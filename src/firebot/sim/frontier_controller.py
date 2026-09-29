"""ScanController + frontier exploration.

While the rule state machine is EXPLORE (no fire seen), replace its sinusoidal wander with:
build an occupancy grid from the lidar sweeps (needs the robot pose -- wheel odometry / SLAM
on hardware, `env.robot` in sim), find the nearest reachable frontier (free cell next to
unknown), BFS a path to it through inflated free space, and pure-pursuit along the path.
TRACK / SPRAY, lidar avoidance and stuck recovery are inherited unchanged.
"""
from __future__ import annotations

from collections import deque

import numpy as np

from .env import VMAX, WMAX
from .scan_controller import ScanController

RES = 0.1            # m per grid cell
INFLATE = 3          # cells (0.3 m) of clearance around obstacles for planning
REPLAN = 1.0         # s between replans
LOOKAHEAD = 0.6      # m
UNKNOWN, FREE, OCC = 0, 1, 2


def _wrap(a: float) -> float:
    return float(np.arctan2(np.sin(a), np.cos(a)))


class FrontierController(ScanController):
    def __init__(self, width: float = 40.0, height: float = 40.0) -> None:
        super().__init__()
        self.grid = np.zeros((int(height / RES), int(width / RES)), dtype=np.uint8)
        self.path: list[tuple[float, float]] = []
        self.since_plan = np.inf
        self.pose = np.zeros(3)
        self.visited: set[tuple[int, int]] = set()
        self.virtual = np.zeros_like(self.grid, dtype=bool)   # cells given up on after a stall
        self.anchor, self.anchor_t = np.zeros(2), 0.0

    # ---- mapping ----------------------------------------------------------------------
    def _integrate(self, scan: np.ndarray, max_range: float = 3.0) -> None:
        x, y, th = self.pose
        n = len(scan)
        rel = -np.pi + 2 * np.pi * np.arange(n) / n
        for a, d in zip(th + rel, scan):
            hit = d < max_range - 0.05
            steps = np.arange(0.0, d, RES * 0.7)
            ci = ((y + np.sin(a) * steps) / RES).astype(int)
            cj = ((x + np.cos(a) * steps) / RES).astype(int)
            ok = (ci >= 0) & (ci < self.grid.shape[0]) & (cj >= 0) & (cj < self.grid.shape[1])
            self.grid[ci[ok], cj[ok]] = np.where(self.grid[ci[ok], cj[ok]] == OCC, OCC, FREE)
            if hit:
                i, j = int((y + np.sin(a) * d) / RES), int((x + np.cos(a) * d) / RES)
                if 0 <= i < self.grid.shape[0] and 0 <= j < self.grid.shape[1]:
                    self.grid[i, j] = OCC

    def _blocked_mask(self) -> np.ndarray:
        occ = self.grid == OCC
        m = occ.copy() | self.virtual
        for di in range(-INFLATE, INFLATE + 1):
            for dj in range(-INFLATE, INFLATE + 1):
                if di * di + dj * dj <= INFLATE * INFLATE:
                    m |= np.roll(np.roll(occ, di, 0), dj, 1)
        return m

    # ---- planning ---------------------------------------------------------------------
    def _plan(self, fire: np.ndarray | None = None) -> None:
        """BFS the known free space from the robot, then pick a goal. With a fire estimate: the
        nearest reachable cell 1-2 m from it (spray position), else the frontier that best
        trades path cost against distance to the fire. Without one: the nearest frontier."""
        blocked = self._blocked_mask()
        H, W = self.grid.shape
        s = (int(self.pose[1] / RES), int(self.pose[0] / RES))
        prev, cost = {s: None}, {s: 0}
        q = deque([s])
        while q:
            c = q.popleft()
            i, j = c
            for di, dj in ((1, 0), (-1, 0), (0, 1), (0, -1), (1, 1), (1, -1), (-1, 1), (-1, -1)):
                n = (i + di, j + dj)
                if 0 <= n[0] < H and 0 <= n[1] < W and n not in prev \
                        and self.grid[n] == FREE and not blocked[n]:
                    prev[n], cost[n] = c, cost[c] + 1
                    q.append(n)
        self.path = []
        cells = np.array([c for c in prev if c != s])
        if len(cells) == 0:
            return
        cst = np.array([cost[tuple(c)] for c in cells]) * RES
        unk = (self.grid == UNKNOWN)
        near_unk = np.zeros_like(unk)
        for di in (-1, 0, 1):
            for dj in (-1, 0, 1):
                near_unk |= np.roll(np.roll(unk, di, 0), dj, 1)
        frontier = near_unk[cells[:, 0], cells[:, 1]]
        if fire is None:
            fr = frontier & np.array([tuple(c) not in self.visited for c in cells])
            if not fr.any():
                return
            k = int(np.argmin(np.where(fr, cst, np.inf)))
            self.visited.add(tuple(cells[k]))
        else:
            xy = (cells[:, ::-1] + .5) * RES
            df = np.hypot(*(xy - fire).T)
            spray = (df >= 1.0) & (df <= 2.0)
            score = np.where(spray, cst, np.where(frontier, cst + 100.0 + 2.0 * df, np.inf))
            if not np.isfinite(score).any():
                return
            k = int(np.argmin(score))
        c = tuple(cells[k])
        while c is not None:
            self.path.append(((c[1] + .5) * RES, (c[0] + .5) * RES))
            c = prev[c]
        self.path.reverse()

    def _fire_estimate(self, obs: np.ndarray) -> np.ndarray | None:
        """World-frame fire position from the EIF, once it has converged enough to trust."""
        if obs[12] * 4 > 1.5 and obs[8] < .5:
            return None
        x, y, th = self.pose
        r, eb = obs[11] * 10, obs[10] * np.pi
        return np.array([x + r * np.cos(th + eb), y + r * np.sin(th + eb)])

    def _follow(self) -> tuple[float, float] | None:
        p = self.pose[:2]
        while len(self.path) > 1 and np.hypot(*(np.array(self.path[0]) - p)) < LOOKAHEAD * .6:
            self.path.pop(0)
        if not self.path:
            return None
        tgt = next((q for q in self.path if np.hypot(*(np.array(q) - p)) >= LOOKAHEAD), self.path[-1])
        if len(self.path) == 1 and np.hypot(*(np.array(self.path[0]) - p)) < .25:
            self.path = []
            return None
        err = _wrap(float(np.arctan2(tgt[1] - p[1], tgt[0] - p[0])) - self.pose[2])
        return VMAX * float(np.clip(np.cos(err), 0, 1)) * .9, float(np.clip(2.5 * err, -WMAX, WMAX))

    # ---- control ----------------------------------------------------------------------
    def act(self, obs: np.ndarray, dt: float = 0.1, scan: np.ndarray | None = None,
            pose=None) -> np.ndarray:
        if scan is not None and pose is not None:
            self.pose = np.asarray(pose, float)
            self._integrate(scan)
        self._obs = obs
        self.since_plan += dt
        self._watchdog(dt)
        a = super().act(obs, dt, scan)
        return a

    def _watchdog(self, dt: float) -> None:
        """If exploring but barely moving for 6 s (avoidance and path fighting over a squeeze the
        planner thinks is passable), rule out the next stretch of the path and replan."""
        if self.state != "EXPLORE" or self.gas_scan > 0:
            self.anchor, self.anchor_t = self.pose[:2].copy(), 0.0
            return
        self.anchor_t += dt
        if np.hypot(*(self.pose[:2] - self.anchor)) > .4:
            self.anchor, self.anchor_t = self.pose[:2].copy(), 0.0
        elif self.anchor_t > 6.0:
            for x, y in self.path[:8]:
                i, j = int(y / RES), int(x / RES)
                self.virtual[max(i - 3, 0):i + 4, max(j - 3, 0):j + 4] = True
            self.path, self.since_plan, self.anchor_t, self.avoid = [], np.inf, 0.0, 0

    def _avoid(self, v: float, w: float, us: np.ndarray) -> tuple[float, float]:
        if self._scan is not None and self.gas_scan <= 0:
            fire = self._fire_estimate(self._obs) if self.state in ("EXPLORE", "TRACK") else None
            in_position = fire is not None and self._obs[8] > .5 and \
                float(np.hypot(*(fire - self.pose[:2]))) < 2.3
            if self.state == "EXPLORE" or (self.state == "TRACK" and fire is not None
                                          and not in_position):
                if self.since_plan > REPLAN or not self.path:
                    self._plan(fire)
                    self.since_plan = 0.0
                cmd = self._follow()
                if cmd is not None and not in_position:
                    v, w = cmd
        return super()._avoid(v, w, us)
