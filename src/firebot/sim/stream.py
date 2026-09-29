"""Step an episode one frame at a time and describe it as JSON-safe dicts.

Used by the web console's MuJoCo tab: `scene()` is sent once (map geometry, fire, start pose),
then `step()` yields one small frame per simulation tick. Nothing here needs a display or GL --
the browser draws the scene from this data.
"""
from __future__ import annotations

from .controller import RuleController
from .env import DT, VMAX, FireEnv
from .frontier_controller import FrontierController
from .scan_controller import ScanController

CONTROLLERS = {"rule": RuleController, "scan": ScanController, "frontier": FrontierController}
ROBOT_RADIUS = 0.22
_PATH_POINTS = 40


def _r(v, n: int = 2) -> float:
    return round(float(v), n)


class EpisodeStream:
    def __init__(self, seed: int = 0, controller: str = "frontier", world: str = "mujoco",
                 max_steps: int = 1500) -> None:
        if controller not in CONTROLLERS:
            raise ValueError(f"controller must be one of {sorted(CONTROLLERS)}")
        if world == "mujoco":
            from .mujoco_world import MuJoCoWorld
            factory = lambda rng: MuJoCoWorld.random(rng)
        elif world == "random":
            from .world import World
            factory = lambda rng: World.random(rng)
        else:
            raise ValueError("world must be 'mujoco' or 'random'")
        self.controller_name, self.seed = controller, seed
        self.env = FireEnv(max_steps=max_steps, world_factory=factory)
        self.obs, _ = self.env.reset(seed=seed)
        self.ctrl = CONTROLLERS[controller]()
        self.done = False

    def scene(self) -> dict:
        w, e = self.env.world, self.env
        d = w.to_dict() if hasattr(w, "to_dict") else {
            "width": w.width, "height": w.height, "walls": [list(x) for x in w.walls],
            "props": [], "rooms": []}
        d.update(wall_height=getattr(w, "wall_height", 2.5), dt=DT, vmax=VMAX,
                 robot_radius=ROBOT_RADIUS, controller=self.controller_name, seed=self.seed,
                 max_steps=e.max_steps, fire={"x": _r(e.fire.x), "y": _r(e.fire.y)},
                 robot=self._pose())
        return d

    def _pose(self) -> dict:
        x, y, th = self.env.robot
        return {"x": _r(x, 3), "y": _r(y, 3), "th": _r(th, 3), "turret": _r(self.env.turret, 3)}

    def step(self) -> dict:
        env, c = self.env, self.ctrl
        if isinstance(c, FrontierController):
            act = c.act(self.obs, DT, scan=env.scan(), pose=env.robot)
        elif isinstance(c, ScanController):
            act = c.act(self.obs, DT, scan=env.scan())
        else:
            act = c.act(self.obs, DT)
        self.obs, _, te, tr, info = env.step(act)
        self.done = bool(te or tr)
        path = []
        if isinstance(c, FrontierController) and c.path:
            k = max(1, len(c.path) // _PATH_POINTS)
            path = [[_r(x), _r(y)] for x, y in c.path[::k]] + [[_r(c.path[-1][0]), _r(c.path[-1][1])]]
        return {"t": _r(env.t * DT, 1), **self._pose(), "fire_p": _r(env.fire.p),
                "state": c.state, "pump": bool(info["pump"]), "collisions": int(info["collisions"]),
                "tank": _r(env.tank), "scan": [_r(v) for v in env.scan()], "path": path,
                "done": self.done, "success": bool(te)}

    def close(self) -> None:
        if hasattr(self.env.world, "close"):
            self.env.world.close()
