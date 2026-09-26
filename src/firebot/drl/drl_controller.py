"""Trained-policy confrontation controller: same interface as `sim.controller.RuleController`
(`.act(obs, dt) -> [v, w, pump]`, `.state`), so it drops into `PlanningController`'s `rule`
slot with nothing else in the codebase changing -- mirrors how `OMPLPlanner` already drops
into `PlanningController`'s `planner_cls` slot.

`.state` matters because `PlanningController.act` checks `self.rule.state == "SPRAY"` to know
when the reactive controller has already gotten into position and should not be interrupted by
a fresh RRT*/OMPL replan. A PPO policy has no discrete internal state to read, so `.state` here
is *derived* from the same observation fields `RuleController` uses to decide it has reached
SPRAY (`seen and peak > 140`) -- not learned, just mirrored, so `PlanningController`'s existing
"don't override an in-progress spray" logic keeps working unmodified regardless of which
controller is plugged into `rule`.

Safety note (read before deploying on real hardware, not just in sim): a trained policy fed an
observation outside its training distribution can produce an action nothing in `RuleController`
ever would. This class alone does not shield against that -- it exposes the same interface,
not the same safety guarantee. Before this runs on the real robot, wrap it (or check its output
against `RuleController.act` on the same obs and prefer the rule action on large disagreement)
the same way `ShadowRouter` double-checks the voice classifier rather than trusting it blind.
That shield is not built here; treat this class as sim/bench-ready, not deployment-ready.
"""
from __future__ import annotations

from pathlib import Path

import numpy as np

_model_cache: dict[str, object] = {}


def _load(model_path: str):
    if model_path not in _model_cache:
        from stable_baselines3 import PPO  # imported lazily -- optional/heavy dependency
        _model_cache[model_path] = PPO.load(model_path)
    return _model_cache[model_path]


class DRLController:
    """`model_path`: a PPO `.zip` checkpoint saved by `firebot-train` (e.g.
    `runs/ppo/model_final.zip` or any `runs/ppo/ckpt_*.zip`). `deterministic=True` matches
    `drl/evaluate.py`'s comparison run -- keep it True for anything other than deliberately
    re-introducing training-time exploration noise."""

    def __init__(self, model_path: str | Path, deterministic: bool = True) -> None:
        self.model_path = str(model_path)
        self.deterministic = deterministic
        self._last_obs: np.ndarray | None = None

    @property
    def state(self) -> str:
        """Mirrors RuleController's SPRAY-entry condition exactly (see sim/controller.py) so
        PlanningController's handoff logic is unaffected by which controller is plugged in."""
        if self._last_obs is None:
            return "EXPLORE"
        obs = self._last_obs
        seen, peak = obs[8] > .5, obs[13] * 325 + 25
        return "SPRAY" if (seen and peak > 140) else "TRACK"

    def act(self, obs: np.ndarray, dt: float = 0.1) -> np.ndarray:
        self._last_obs = obs
        model = _load(self.model_path)
        action, _ = model.predict(obs, deterministic=self.deterministic)
        return np.asarray(action, dtype=np.float32)
