"""Simulated robot hardware: lets the whole link (agent <-> brain) run with no Pi or sensors.

Wraps `FireEnv`. read() advances the physics one step using the last applied command and
returns the resulting sensor frame, exactly what a real driver would report.
"""
from __future__ import annotations

import numpy as np

from firebot.sim.env import DT, FireEnv

from .agent import HardwareDone
from .protocol import SCALARS, Command, Frame


class SimHardware:
    def __init__(self, seed: int = 0, max_steps: int = 1500, stop_on_fire_out: bool = True) -> None:
        self.env = FireEnv(max_steps=max_steps)
        self.env.reset(seed=seed)
        self.action = np.zeros(4, dtype=np.float32)
        self.stop_on_fire_out = stop_on_fire_out
        self.first = True
        self.done = False
        self.stops = 0

    def apply(self, cmd: Command) -> None:
        self.action = np.array([cmd.v, cmd.w, cmd.turret, 1.0 if cmd.pump else 0.0],
                                dtype=np.float32)

    def stop(self) -> None:
        self.action = np.zeros(4, dtype=np.float32)
        self.stops += 1

    def read(self) -> Frame:
        env = self.env
        if self.first:
            self.first = False
        else:
            _, _, te, tr, _ = env.step(self.action)
            if (te and self.stop_on_fire_out) or tr:
                self.done = True
                raise HardwareDone
        s = env.last
        return Frame(0, env.t * DT, tuple(float(v) for v in env.robot), env.meas_speed, env.tank,
                     {n: float(s[n]) for n in SCALARS}, np.round(s["thermal"], 1).tolist(),
                     float(env.turret))
