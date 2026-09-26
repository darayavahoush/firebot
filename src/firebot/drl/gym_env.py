"""Gymnasium ``Env`` wrapper around ``firebot.sim.env.FireEnv``.

``FireEnv`` already exposes a Gymnasium-shaped ``reset``/``step`` API but does not subclass
``gymnasium.Env`` or declare ``action_space``/``observation_space``, which SB3 requires. This
wrapper adds those without touching the sim core, so the rule-based baseline keeps using
``FireEnv`` directly (see ``firebot.sim.run``) and DRL gets a real ``gymnasium.Env``.
"""
from __future__ import annotations

from collections.abc import Callable
from typing import ClassVar

import gymnasium as gym
import numpy as np
from gymnasium import spaces

from firebot.sim.env import ACT_DIM, DEFAULT_MIN_FIRE_DIST, OBS_DIM, FireEnv
from firebot.sim.world import World


class FireGymEnv(gym.Env):
    """``FireEnv`` behind a standard ``gymnasium.Env`` interface.

    Action: ``[forward speed 0..1, turn rate -1..1, pump >0.5 = on]`` (see ``FireEnv``).
    Observation: the 16-value fused vector from ``FireEnv.obs_layout()``.
    """

    metadata: ClassVar[dict] = {"render_modes": []}

    def __init__(self, max_steps: int = 1500, world: World | None = None,
                 world_factory: Callable[[np.random.Generator], World] | None = None,
                 min_fire_dist: float = DEFAULT_MIN_FIRE_DIST) -> None:
        super().__init__()
        self.env = FireEnv(max_steps=max_steps, world=world, world_factory=world_factory,
                          min_fire_dist=min_fire_dist)
        # All 16 components of FireEnv's observation are designed to sit in roughly [-1, 1]
        # (see FireEnv._obs); +/-10 gives headroom without the "too low/high" warnings an
        # unbounded Box triggers, and keeps SB3's default policy init well-scaled.
        self.observation_space = spaces.Box(-10.0, 10.0, (OBS_DIM,), dtype=np.float32)
        self.action_space = spaces.Box(
            low=np.array([0.0, -1.0, 0.0], dtype=np.float32),
            high=np.array([1.0, 1.0, 1.0], dtype=np.float32),
            shape=(ACT_DIM,), dtype=np.float32,
        )

    def reset(self, *, seed: int | None = None, options: dict | None = None):
        super().reset(seed=seed)
        obs, info = self.env.reset(seed=seed)
        return obs, info

    def step(self, action):
        return self.env.step(action)

    def config(self) -> dict:
        return self.env.config()

    def render(self):  # pragma: no cover - no renderer; sim has its own web visualiser
        return None
