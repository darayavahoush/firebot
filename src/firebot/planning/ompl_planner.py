"""OMPL-backed planner: same `Planner` interface as `RRTStar`, real OMPL underneath.

`rrtstar.py`'s docstring called this out from day one -- "an OMPL-backed planner can be dropped
in later without touching controllers" -- so `OMPLPlanner` reuses `CostMap` for collision
checking and can be swapped into `PlanningController(planner_cls=OMPLPlanner)` with nothing else
in the codebase changing.

Requires the `ompl` package (``pip install ompl``, or build from source / conda-forge for
platforms without a prebuilt wheel). Import is deferred into `__init__` so the rest of the
package works with plain numpy when it isn't installed -- see `planning/__init__.py`.
"""
from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np

from firebot.sim.world import World

from .rrtstar import CostMap

PLANNERS = ("InformedRRTstar", "RRTstar", "RRTConnect", "PRMstar")


class OMPLNotInstalled(ImportError):
    """Raised lazily, at planner construction, not at import time."""


@dataclass
class OMPLPlanner:
    """Samples in SE(2) position space (x, y) using a real OMPL planner + state validity checker
    driven by the same inflated occupancy grid `RRTStar` uses, so both planners see an
    identically-safe free space and their paths are directly comparable.

    algorithm: one of PLANNERS. "InformedRRTstar" (the default) keeps re-optimising the path
    within a shrinking ellipse once a first solution is found -- OMPL's asymptotically-optimal
    successor to plain RRT*.
    """

    world: World
    algorithm: str = "InformedRRTstar"
    time_limit: float = 1.0          # seconds of planning budget
    goal_tol: float = 0.25
    simplify: bool = True
    seed: int | None = None
    margin: float = 0.08
    _cmap: CostMap = field(init=False, repr=False)

    def __post_init__(self) -> None:
        try:
            from ompl import base as ob
            from ompl import geometric as og
            from ompl import util as ou
        except ImportError as exc:  # pragma: no cover - exercised only without the dep
            raise OMPLNotInstalled(
                "planning.ompl_planner requires the 'ompl' package: pip install ompl "
                "(or build OMPL's Python bindings from source for your platform)."
            ) from exc
        self._ob, self._og = ob, og
        if self.seed is not None:
            ou.RNG.setSeed(int(self.seed))
        self._cmap = CostMap(self.world, margin=self.margin)

        space = ob.RealVectorStateSpace(2)
        bounds = ob.RealVectorBounds(2)
        bounds.setLow(0, 0.0)
        bounds.setHigh(0, self.world.width)
        bounds.setLow(1, 0.0)
        bounds.setHigh(1, self.world.height)
        space.setBounds(bounds)
        self._space = space

        self._si = ob.SpaceInformation(space)
        self._si.setStateValidityChecker(self._valid)
        # fraction of the space's extent to step when checking a motion for collisions
        diag = float(np.hypot(self.world.width, self.world.height))
        self._si.setStateValidityCheckingResolution(0.05 / diag)
        self._si.setup()

    # -- OMPL callbacks ---------------------------------------------------------------
    def _valid(self, state) -> bool:
        return bool(self._cmap.free(np.array([state[0], state[1]]))[0])

    def _make_planner(self):
        cls = getattr(self._og, self.algorithm, None)
        if cls is None:
            raise ValueError(f"unknown OMPL algorithm {self.algorithm!r}; choose from {PLANNERS}")
        return cls(self._si)

    # -- Planner protocol --------------------------------------------------------------
    def plan(self, start: tuple[float, float], goal: tuple[float, float]) -> np.ndarray | None:
        ob = self._ob
        s = self._cmap.nearest_free(np.array(start, float))
        g = self._cmap.nearest_free(np.array(goal, float))
        if s is None or g is None:
            return None
        if self._cmap.segment_free(s, g):
            return np.array([np.asarray(start, float), g])

        pdef = ob.ProblemDefinition(self._si)
        st, gt = self._si.allocState(), self._si.allocState()
        st[0], st[1] = float(s[0]), float(s[1])
        gt[0], gt[1] = float(g[0]), float(g[1])
        pdef.setStartAndGoalStates(st, gt, self.goal_tol)
        pdef.setOptimizationObjective(ob.PathLengthOptimizationObjective(self._si))

        planner = self._make_planner()
        planner.setProblemDefinition(pdef)
        planner.setup()
        solved = planner.solve(self.time_limit)
        if not solved:
            return None
        path = pdef.getSolutionPath()
        if self.simplify:
            og = self._og
            simplifier = og.PathSimplifier(self._si)
            simplifier.simplifyMax(path)
        path.interpolate()
        pts = np.array([[path.getState(i)[0], path.getState(i)[1]]
                        for i in range(path.getStateCount())])
        pts[0] = np.asarray(start, float)  # snap endpoints to the exact requested pose
        return pts

    @property
    def cmap(self) -> CostMap:  # PlanningController reads `.cmap` off whichever planner it holds
        return self._cmap
