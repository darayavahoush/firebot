"""Planning controller: RRT* to a spray stand-off point, pure-pursuit path following.

Wraps `RuleController` for perception-driven behaviour (explore / track / spray) and takes over
only while the fire is localised but not yet in spray position, so walls between robot and fire
are routed around instead of bumped into. Needs the robot pose (wheel-odometry / SLAM on the
real robot, `env.robot` in sim).
"""
from __future__ import annotations

import numpy as np

from firebot.sim.controller import RuleController
from firebot.sim.env import SPRAY_RANGE, VMAX, WMAX
from firebot.sim.world import World

from .rrtstar import CostMap, RRTStar, path_length

STANDOFF = 1.8        # desired distance from fire when spraying (< SPRAY_RANGE)
LOOKAHEAD = 0.6
REPLAN_EVERY = 4.0    # s
RETRY_AFTER = 1.5     # s
GOAL_SHIFT = 0.7      # m of estimate drift that forces a replan


def _wrap(a: float) -> float:
    return float(np.arctan2(np.sin(a), np.cos(a)))


def standoff_point(world: World, cmap: CostMap, fire: np.ndarray, robot: np.ndarray):
    """Free point ~STANDOFF from `fire`, with line of sight to it, nearest to `robot`."""
    best, best_d = None, np.inf
    for r in (STANDOFF, STANDOFF - .3, STANDOFF + .4):
        for a in np.linspace(0, 2 * np.pi, 24, endpoint=False):
            p = fire + r * np.array([np.cos(a), np.sin(a)])
            if cmap.free(p)[0] and world.line_of_sight(p[0], p[1], fire[0], fire[1]):
                d = float(np.hypot(*(p - robot)))
                if d < best_d:
                    best, best_d = p, d
    return best


class PlanningController:
    def __init__(self, world: World, seed: int | None = 0) -> None:
        self.world = world
        self.rule = RuleController()
        self.planner = RRTStar(world, seed=seed)
        self.path: np.ndarray | None = None
        self.goal: np.ndarray | None = None
        self.since_plan = np.inf
        self.fire_est: np.ndarray | None = None
        self.stats = {"plans": 0, "plan_failures": 0, "planned_length": 0.0}

    @property
    def state(self) -> str:
        return "PLAN" if self.following else self.rule.state

    @property
    def following(self) -> bool:
        return self.path is not None

    def _fire_estimate(self, obs: np.ndarray, pose: np.ndarray) -> np.ndarray | None:
        sigma = obs[12] * 4
        if sigma > 1.0 and obs[8] < .5:  # not localised and not currently in view
            return None
        x, y, th = pose
        r, eb = obs[11] * 10, obs[10] * np.pi
        return np.array([x + r * np.cos(th + eb), y + r * np.sin(th + eb)])

    def act(self, obs: np.ndarray, pose, dt: float = 0.1) -> np.ndarray:
        pose = np.asarray(pose, float)
        base = self.rule.act(obs, dt)  # keeps the perception state machine running
        self.since_plan += dt
        fire = self._fire_estimate(obs, pose)
        if self.rule.state == "SPRAY" or fire is None:
            self.path = None
            return base
        dist = float(np.hypot(*(fire - pose[:2])))
        in_position = bool(obs[8] > .5) and dist < min(STANDOFF + .6, SPRAY_RANGE - .1)
        if in_position:
            self.path = None
            return base
        moved = self.fire_est is None or float(np.hypot(*(fire - self.fire_est))) > GOAL_SHIFT
        stuck = obs[15] < .15 and self.path is not None and self.since_plan > 1.0
        retry = self.path is None and self.since_plan > RETRY_AFTER  # back off after a failed plan
        if self.fire_est is None or moved or stuck or retry or self.since_plan > REPLAN_EVERY:
            self._replan(fire, pose)
        if self.path is None:
            return base  # no route: fall back to reactive behaviour
        return self._follow(pose, base)

    def _replan(self, fire: np.ndarray, pose: np.ndarray) -> None:
        self.since_plan, self.fire_est = 0.0, fire
        goal = standoff_point(self.world, self.planner.cmap, fire, pose[:2])
        path = self.planner.plan(pose[:2], goal) if goal is not None else None
        self.goal = goal
        if path is None:
            self.stats["plan_failures"] += 1
            self.path = None
            return
        self.stats["plans"] += 1
        self.stats["planned_length"] = path_length(path)
        self.path = path

    def _follow(self, pose: np.ndarray, base: np.ndarray) -> np.ndarray:
        p = pose[:2]
        seg = np.hypot(*np.diff(self.path, axis=0).T)
        # closest point on path, then look ahead along it
        k = int(np.argmin(np.hypot(*(self.path - p).T)))
        target, remaining = self.path[-1], LOOKAHEAD
        for i in range(k, len(self.path) - 1):
            s = seg[i]
            if s >= remaining:
                target = self.path[i] + (self.path[i + 1] - self.path[i]) * remaining / s
                break
            remaining -= s
        if float(np.hypot(*(self.path[-1] - p))) < 0.25:
            self.path = None
            return base
        err = _wrap(float(np.arctan2(target[1] - p[1], target[0] - p[0])) - pose[2])
        w = float(np.clip(2.5 * err, -WMAX, WMAX))
        v = 0.0 if abs(err) > 0.9 else VMAX * float(np.clip(np.cos(err), 0.15, 1.0))
        return np.array([v / VMAX, w / WMAX, 0.0], dtype=np.float32)
