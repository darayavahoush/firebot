"""Turns validated intents into robot behaviour. Sits between the interpreter and the sim/ESP.

Modes: IDLE (stopped, waiting), AUTO (search -> approach -> suppress via PlanningController),
GOTO (drive a planned path; pump never on), MANUAL (console joystick/cmdhttp bridge; operator
drives and pumps directly). STOP always wins and latches until the next motion command.

MANUAL is entered via `update_manual()`, a fast path for continuous joystick-style samples that
bypasses `handle()`'s validation/logging so a full joystick tick rate doesn't spam the operator
log. It carries its own 0.5s dead-man timeout (`MANUAL_TIMEOUT`): if no fresh sample arrives
within that window, `act()` drops back to IDLE on its own, even with no operator STOP. Nozzle
angle (`manual_state["nozzle"]`, degrees, +/-45) is an absolute pan target; `act()` reads the
turret's current angle back from the observation (`FireEnv`'s 17th component, see
`firebot.sim.env`) and closes the loop with a proportional rate command each tick, same as
`RuleController` does for SPRAY.
"""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from firebot.planning import PlanningController, follow_path
from firebot.sim.env import TURRET_LIMIT
from firebot.sim.world import World

from .intents import SAFE_WITHOUT_CONFIRMATION, Intent, validate
from .parser import HOME

STUCK_AFTER = 2.0   # s commanded forward without moving -> replan
BLOCKED_FRONT = 0.3  # m
MANUAL_TIMEOUT = 0.5  # s without a fresh update_manual() sample -> auto-IDLE


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
        self.manual_state = {"v": 0.0, "w": 0.0, "pump": False, "nozzle": 0.0}
        self.manual_idle = 0.0

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
        if n == "MANUAL":
            p = intent.params
            self.update_manual(p["v"], p["w"], p["pump"], p["nozzle"])
            return Result(True, "Manual control engaged.")
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

    def update_manual(self, v: float, w: float, pump: bool = False, nozzle: float = 0.0) -> None:
        """Fast path for a continuous joystick-style sample: no validation, no operator log.

        Enters/refreshes MANUAL mode and resets the dead-man clock. Values are clamped
        defensively even though callers are expected to have already validated them.
        """
        self.mode, self.path = "MANUAL", None
        self.manual_state = {
            "v": float(np.clip(v, 0.0, 1.0)),
            "w": float(np.clip(w, -1.0, 1.0)),
            "pump": bool(pump),
            "nozzle": float(np.clip(nozzle, -45.0, 45.0)),
        }
        self.manual_idle = 0.0

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
        idle = np.zeros(4, dtype=np.float32)
        if self.mode == "AUTO":
            return self.auto.act(obs, self.pose, dt)
        if self.mode == "MANUAL":
            self.manual_idle += dt
            if self.manual_idle > MANUAL_TIMEOUT:
                self.mode = "IDLE"
                return idle
            m = self.manual_state
            turret = float(obs[16]) * TURRET_LIMIT
            target = np.deg2rad(m["nozzle"])
            turret_cmd = float(np.clip((target - turret) * 3.0, -1.0, 1.0))
            return np.array([m["v"], m["w"], turret_cmd, 1.0 if m["pump"] else 0.0],
                             dtype=np.float32)
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
