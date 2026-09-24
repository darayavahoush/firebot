"""Gymnasium-style environment (reset/step API) around the world, sensors and EIF fusion.

Action (3, normalised): [forward speed 0..1, turn rate -1..1, pump >0.5 = on].
"""
from __future__ import annotations

import numpy as np

from firebot.fusion import BearingEIF

from .sensors import FLAME, US, read_sensors, thermal_bearing
from .world import Fire, World

DT, VMAX, WMAX = 0.1, 0.7, 1.6
SPRAY_RANGE, SPRAY_CONE, EXTINGUISH_RATE, WATER_RATE = 2.5, 0.2, 0.2, 0.03
OBS_DIM, ACT_DIM = 16, 3


def obs_layout() -> dict[str, slice | int]:
    return {"us": slice(0, 4), "flame": slice(4, 7), "gas": 7, "seen": 8, "therm_bearing": 9,
            "est_bearing": 10, "est_range": 11, "est_sigma": 12, "therm_peak": 13,
            "tank": 14, "speed": 15}


class FireEnv:
    obs_dim, act_dim = OBS_DIM, ACT_DIM

    def __init__(self, max_steps: int = 1500, world: World | None = None) -> None:
        self.world, self.max_steps = world or World(), max_steps
        self.rng = np.random.default_rng()

    def config(self) -> dict:
        return {"walls": self.world.walls, "max_steps": self.max_steps, "dt": DT,
                "vmax": VMAX, "wmax": WMAX, "obs_dim": OBS_DIM}

    def reset(self, seed: int | None = None):
        self.rng = np.random.default_rng(seed)
        self.robot = np.array([1.2, 1.0, 0.6])  # x, y, theta
        fx, fy = self.world.random_free_point(self.rng, .5, self.robot[:2], 4.0)
        self.fire, self.eif = Fire(fx, fy), BearingEIF()
        self.t, self.tank, self.collisions, self.water = 0, 1.0, 0, 0.0
        self.meas_speed = 0.0
        self.prev_d = float(np.hypot(fx - self.robot[0], fy - self.robot[1]))
        self.last = read_sensors(self.world, self.fire, *self.robot, self.rng)
        return self._obs(), {}

    def _fuse(self, s: dict) -> tuple[bool, float]:
        x, y, th = self.robot
        zt = thermal_bearing(s["thermal"])
        seen = zt is not None
        if seen:
            self.eif.update(x, y, th, zt, 0.04)
        else:
            f = np.array([s[n] for n in FLAME])
            if f.sum() > .15:
                self.eif.update(x, y, th, float((f * np.array(list(FLAME.values()))).sum() / f.sum()), .3)
        return seen, zt or 0.0

    def _obs(self) -> np.ndarray:
        s, (x, y, th) = self.last, self.robot
        seen, zt = self._fuse(s)
        m, P = self.eif.mean, self.eif.cov
        eb = float(np.arctan2(m[1] - y, m[0] - x) - th)
        eb = float(np.arctan2(np.sin(eb), np.cos(eb)))
        sigma = float(np.sqrt(max(P[0, 0], P[1, 1])))
        self.est = {"x": float(m[0]), "y": float(m[1]), "sigma": sigma}
        o = [*(s[n] / 4 for n in US), *(s[n] for n in FLAME), max(s["mq2_front"], s["mq2_rear"]),
             float(seen), zt / .5, eb / np.pi, min(np.hypot(m[0] - x, m[1] - y), 10) / 10,
             min(sigma, 4) / 4, (float(s["thermal"].max()) - 25) / 325, self.tank, self.meas_speed / VMAX]
        return np.array(o, dtype=np.float32)

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
