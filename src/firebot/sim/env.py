"""Gymnasium-style environment (reset/step API) around the world, sensors and EIF fusion.

Action (3, normalised): [forward speed 0..1, turn rate -1..1, pump >0.5 = on].
"""
from __future__ import annotations

from collections.abc import Callable

import numpy as np

from firebot.perception import Perception

from .sensors import read_sensors
from .world import Fire, World

DT, VMAX, WMAX = 0.1, 0.7, 1.6
SPRAY_RANGE, SPRAY_CONE, EXTINGUISH_RATE, WATER_RATE = 2.5, 0.2, 0.2, 0.03
OBS_DIM, ACT_DIM = 16, 3
DEFAULT_MIN_FIRE_DIST = 4.0
_START = (1.2, 1.0)  # robot's spawn point on the default single-room map


def clamp_min_fire_dist(world: World, requested: float) -> float:
    """Clamp a requested robot<->fire distance to what `World.random_free_point` can
    actually deliver on `world`, so it never spins forever rejecting samples.

    `random_free_point` samples uniformly inside a fixed ``[1, width-1] x [1, height-1]``
    box (independent of the `margin` argument, which only gates the wall-clearance check)
    and rejects draws closer than `min_dist` to `avoid`. The largest distance between two
    points in that box is its diagonal -- and that's only reachable from the box's opposite
    corners, so even clamping to exactly the diagonal can starve the rejection sampler on a
    small/cluttered map. Clamp to 90% of the reachable diagonal, floored at 0 (a degenerate
    box, e.g. width/height <= 2, just drops the distance constraint entirely).
    """
    reachable = float(np.hypot(max(world.width - 2.0, 0.0), max(world.height - 2.0, 0.0)))
    return float(np.clip(requested, 0.0, reachable * 0.9))


def obs_layout() -> dict[str, slice | int]:
    return {"us": slice(0, 4), "flame": slice(4, 7), "gas": 7, "seen": 8, "therm_bearing": 9,
            "est_bearing": 10, "est_range": 11, "est_sigma": 12, "therm_peak": 13,
            "tank": 14, "speed": 15}


class FireEnv:
    obs_dim, act_dim = OBS_DIM, ACT_DIM

    def __init__(self, max_steps: int = 1500, world: World | None = None,
                 world_factory: Callable[[np.random.Generator], World] | None = None,
                 min_fire_dist: float = DEFAULT_MIN_FIRE_DIST) -> None:
        """`world_factory`, if given, is called as `world_factory(rng)` at the start of
        *every* `reset()` to build a fresh `World` -- e.g. `lambda rng: World.random(rng)`
        for a new procedurally-generated building each episode (curriculum/domain
        randomization). `world` seeds the very first map (or is the map, permanently, when
        `world_factory` is None) but plays no further role once `world_factory` is set --
        every `reset()` after that replaces it. Both default to today's behavior: one fixed
        `World()` for the whole env's lifetime. `min_fire_dist` is the requested
        robot<->fire spawn distance, clamped per-episode via `clamp_min_fire_dist` since it
        may not fit every map `world_factory` produces.
        """
        self.world_factory = world_factory
        if world is not None:
            self.world = world
        elif world_factory is not None:
            self.world = world_factory(np.random.default_rng())
        else:
            self.world = World()
        self.min_fire_dist, self.max_steps = min_fire_dist, max_steps
        self.rng = np.random.default_rng()

    def config(self) -> dict:
        return {"walls": self.world.walls, "max_steps": self.max_steps, "dt": DT,
                "vmax": VMAX, "wmax": WMAX, "obs_dim": OBS_DIM}

    def reset(self, seed: int | None = None):
        self.rng = np.random.default_rng(seed)
        if self.world_factory is not None:
            self.world = self.world_factory(self.rng)
        start = _START if self.world.is_free(*_START, .22) else \
            self.world.random_free_point(self.rng, .22)
        self.robot = np.array([start[0], start[1], 0.6])  # x, y, theta
        min_dist = clamp_min_fire_dist(self.world, self.min_fire_dist)
        fx, fy = self.world.random_free_point(self.rng, .5, self.robot[:2], min_dist)
        self.fire, self.perception = Fire(fx, fy), Perception(VMAX)
        self.t, self.tank, self.collisions, self.water = 0, 1.0, 0, 0.0
        self.meas_speed = 0.0
        self.prev_d = float(np.hypot(fx - self.robot[0], fy - self.robot[1]))
        self.last = read_sensors(self.world, self.fire, *self.robot, self.rng)
        return self._obs(), {}

    def _obs(self) -> np.ndarray:
        obs = self.perception.update(self.last, self.robot, self.tank, self.meas_speed)
        self.est, self.eif = self.perception.est, self.perception.eif
        return obs

    def step(self, action):
        v = float(np.clip(action[0], 0, 1)) * VMAX
        w = float(np.clip(action[1], -1, 1)) * WMAX
        pump = float(action[2]) > .5 and self.tank > 0
        x, y, th = self.robot
        th += w * DT
        nx, ny = x + np.cos(th) * v * DT, y + np.sin(th) * v * DT
        collided = v > 0 and not self.world.is_free(nx, ny, .22)
        if collided:
            nx, ny = x, y
            self.collisions += 1
        self.meas_speed = float(np.hypot(nx - x, ny - y)) / DT  # wheel-odometry speed
        self.robot = np.array([nx, ny, th])
        self.t += 1
        self.last = read_sensors(self.world, self.fire, *self.robot, self.rng)
        tr = self.last["_truth"]
        reward = -0.01 - (1.0 if collided else 0.0)
        if self.fire.p > 0:
            reward += 0.5 * (self.prev_d - tr["dist"])
        self.prev_d = tr["dist"]
        if pump:
            self.tank = max(0.0, self.tank - WATER_RATE * DT)
            self.water += WATER_RATE * DT
            if tr["visible"] and tr["dist"] < SPRAY_RANGE and abs(tr["bearing"]) < SPRAY_CONE:
                dp = min(self.fire.p, EXTINGUISH_RATE * DT)
                self.fire.p -= dp
                reward += 2.0 * dp
        terminated = self.fire.p <= 1e-9
        if terminated:
            self.fire.p = 0.0
            reward += 10.0
        truncated = (not terminated) and self.t >= self.max_steps
        info = {"success": terminated, "collisions": self.collisions, "water_used": self.water,
                "fire_p": self.fire.p, "collided": collided, "pump": pump, "est": None}
        obs = self._obs()
        info["est"] = self.est
        return obs, float(reward), terminated, truncated, info
