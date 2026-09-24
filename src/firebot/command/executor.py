"""Turns validated intents into robot behaviour. Sits between the interpreter and the sim/ESP.

Modes: IDLE (stopped, waiting), AUTO (search -> approach -> suppress via PlanningController),
GOTO (drive a planned path; pump never on). STOP always wins and latches until the next motion
command. The pump is only ever driven by AUTO's suppression logic -- there is no "pump on" intent.
"""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from firebot.planning import PlanningController, follow_path
from firebot.sim.world import World

from .intents import SAFE_WITHOUT_CONFIRMATION, Intent, validate
from .parser import HOME

STUCK_AFTER = 2.0   # s commanded forward without moving -> replan
BLOCKED_FRONT = 0.3  # m


@dataclass
class Result:
    ok: bool
    message: str
    pending: Intent | None = None  # set when confirmation is required


class CommandController:
    def __init__(self, world: World, seed: int | None = 0) -> None:
        self.world, self.seed = world, seed
        self.mode = "IDLE"
        self.auto = PlanningController(world, seed=seed)
        self.path: np.ndarray | None = None
        self.goal: tuple[float, float] | None = None
        self.obs: np.ndarray | None = None
        self.pose = np.zeros(3)
        self.stuck = 0.0
        self.arrived = False

    # ---- command side -------------------------------------------------------------------
    def handle(self, intent: Intent, confirmed: bool = False) -> Result:
        ok, reason = validate(intent)
        if not ok:
            return Result(False, f"rejected: {reason}")
        if intent.needs_confirmation and not confirmed and intent.name not in SAFE_WITHOUT_CONFIRMATION:
            return Result(False, f"I understood {self._describe(intent)}. Confirm?", pending=intent)
        n = intent.name
        if n == "STOP":
            self.mode, self.path = "IDLE", None
            return Result(True, "Stopped. Pump off.")
        if n == "STATUS":
            return Result(True, self.status())
        if n == "EXTINGUISH":
            self.auto = PlanningController(self.world, seed=self.seed)
            self.mode, self.path = "AUTO", None
            return Result(True, "Searching for fire and suppressing it.")
        if n in ("GOTO", "RETURN_HOME"):
            xy = HOME if n == "RETURN_HOME" else (intent.params["x"], intent.params["y"])
            return self._goto(xy, "home" if n == "RETURN_HOME" else f"({xy[0]:.1f}, {xy[1]:.1f})")
        return Result(False, "Sorry, I didn't understand that. Try: extinguish, go to <place>, "
                             "return home, status, stop.")

    @staticmethod
    def _describe(i: Intent) -> str:
        p = ", ".join(f"{k}={v:.1f}" for k, v in i.params.items())
        return f"{i.name}" + (f" ({p})" if p else "")

    def _goto(self, xy: tuple[float, float], label: str) -> Result:
        start = self.pose[:2]
        path = self.auto.planner.plan(start, xy)
        if path is None:
            self.mode, self.path = "IDLE", None
            return Result(False, f"No safe route to {label}.")
        self.mode, self.path, self.goal, self.arrived = "GOTO", path, xy, False
        return Result(True, f"Heading to {label}.")

    def status(self) -> str:
        if self.obs is None:
            return f"Mode {self.mode}. No sensor data yet."
        x, y, _ = self.pose
        tank = float(self.obs[14])
        fire = self.auto._fire_estimate(self.obs, self.pose)
        seen = "in view" if self.obs[8] > .5 else "not in view"
        loc = (f"fire localised near ({fire[0]:.1f}, {fire[1]:.1f}), {seen}"
               if fire is not None else "no fire localised")
        return f"Mode {self.mode}. At ({x:.1f}, {y:.1f}). Water {tank:.0%}. {loc.capitalize()}."

    # ---- control side -------------------------------------------------------------------
    def act(self, obs: np.ndarray, pose, dt: float = 0.1) -> np.ndarray:
        self.obs, self.pose = obs, np.asarray(pose, float)
        idle = np.zeros(3, dtype=np.float32)
        if self.mode == "AUTO":
            return self.auto.act(obs, self.pose, dt)
        if self.mode != "GOTO" or self.path is None:
            return idle
        front = min(obs[0], obs[1]) * 4
        self.stuck = self.stuck + dt if (obs[15] < .15 or front < BLOCKED_FRONT) else 0.0
        if self.stuck > STUCK_AFTER:  # blocked by something the map doesn't know about
            self.stuck = 0.0
            r = self._goto(self.goal, "the goal")
            if not r.ok:
                return idle
        a = follow_path(self.path, self.pose)
        if a is None:
            self.mode, self.path, self.arrived = "IDLE", None, True
            return idle
        if front < BLOCKED_FRONT:
            a[0] = 0.0
        return a
