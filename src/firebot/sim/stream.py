"""Step an episode one frame at a time and describe it as JSON-safe dicts.

Used by the web console's MuJoCo tab: `scene()` is sent once (map geometry, fire, start pose),
then `step()` yields one small frame per simulation tick. Nothing here needs a display or GL --
the browser draws the scene from this data.
"""
from __future__ import annotations

import numpy as np

from .controller import RuleController
from .env import DT, VMAX, FireEnv, obs_layout
from .frontier_controller import FrontierController
from .scan_controller import ScanController


def _get_mm_controller():
    try:
        from firebot.drl.drl_controller import MultimodalController
        return MultimodalController
    except (ImportError, Exception):
        return None


def get_controller_class(name: str):
    if name == "rule":
        return RuleController
    if name == "scan":
        return ScanController
    if name == "frontier":
        return FrontierController
    if name == "mm_fusion":
        cls = _get_mm_controller()
        if cls is None:
            raise ValueError("mm_fusion controller requires gymnasium: pip install 'firebot[drl]'")
        return cls
    raise ValueError(f"controller must be one of ['frontier', 'mm_fusion', 'rule', 'scan'], got {name!r}")


CONTROLLERS = {
    "rule": RuleController,
    "scan": ScanController,
    "frontier": FrontierController,
}

ROBOT_RADIUS = 0.22
_PATH_POINTS = 40


def _r(v, n: int = 2) -> float:
    return round(float(v), n)


class EpisodeStream:
    def __init__(self, seed: int = 0, controller: str = "frontier", world: str = "mujoco",
                 max_steps: int = 1500) -> None:
        ctrl_cls = get_controller_class(controller)
        if world == "mujoco":
            from .mapgen import ALL_ROOM_KINDS
            from .mujoco_world import MuJoCoWorld
            factory = lambda rng: MuJoCoWorld.random(rng, room_kinds=ALL_ROOM_KINDS)
        elif world == "random":
            from .world import World
            factory = lambda rng: World.random(rng)
        else:
            raise ValueError("world must be 'mujoco' or 'random'")
        self.controller_name, self.seed = controller, seed
        self.env = FireEnv(max_steps=max_steps, world_factory=factory)
        self.obs, _ = self.env.reset(seed=seed)
        self.ctrl = ctrl_cls()
        self.done = False
        self.seq = 0
        self.last_db: dict = {}

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
        obs_in = np.asarray(self.obs, dtype=float)
        if isinstance(c, FrontierController):
            act = c.act(self.obs, DT, scan=env.scan(), pose=env.robot)
        elif isinstance(c, ScanController):
            act = c.act(self.obs, DT, scan=env.scan())
        else:
            act = c.act(self.obs, DT)
        self.obs, _, te, tr, info = env.step(act)
        self.seq += 1
        scan = [_r(v) for v in env.scan()]
        self.last_db = self._db_row(obs_in, act, info, scan)
        self.done = bool(te or tr)
        path = []
        if isinstance(c, FrontierController) and c.path:
            k = max(1, len(c.path) // _PATH_POINTS)
            path = [[_r(x), _r(y)] for x, y in c.path[::k]] + [[_r(c.path[-1][0]), _r(c.path[-1][1])]]
        lay = obs_layout()
        est = getattr(env, "est", {}) or {}
        return {
            "t": _r(env.t * DT, 1),
            **self._pose(),
            "fire_p": _r(env.fire.p),
            "state": c.state,
            "pump": bool(info["pump"]),
            "collisions": int(info["collisions"]),
            "tank": _r(env.tank),
            "scan": scan,
            "path": path,
            "done": self.done,
            "success": bool(te),
            "est": {"x": _r(est.get("x", 0.0)), "y": _r(est.get("y", 0.0)), "sigma": _r(est.get("sigma", 4.0))} if est else None,
            "gas": _r(float(obs_in[lay["gas"]]), 3) if len(obs_in) > lay["gas"] else 0.0,
            "peak": _r(float(obs_in[lay["therm_peak"]]), 3) if len(obs_in) > lay["therm_peak"] else 0.0,
        }

    def _db_row(self, obs, act, info, scan) -> dict:
        """One telemetry row in the ops-DB shape (sessions/frames), so the History and Live
        tabs can show a simulated run like a real one."""
        lay = obs_layout()
        us, fl = obs[lay["us"]], obs[lay["flame"]]
        names = ("us_front_left", "us_front_right", "us_left", "us_right")
        sensors = {n: _r(v, 3) for n, v in zip(names, us)}
        sensors.update(flame_left=_r(fl[0], 3), flame_center=_r(fl[1], 3), flame_right=_r(fl[2], 3),
                       mq2_front=_r(obs[lay["gas"]], 3), mq2_rear=_r(obs[lay["gas"]], 3))
        # 36 ranges in metres, ray k at angle -pi + 2*pi*k/36 from heading. A list, so the
        # anomaly detector (numeric channels only) ignores it; the real robot has no lidar.
        sensors["lidar"] = scan
        a = np.asarray(act, dtype=float).ravel()
        x, y, th = self.env.robot
        return {"seq": self.seq, "t": _r(self.env.t * DT, 2), "x": _r(x, 3), "y": _r(y, 3),
                "theta": _r(th, 3), "tank": _r(self.env.tank, 3), "sensors": sensors,
                "mode": self.ctrl.state, "cmd_v": _r(a[0], 3) if a.size > 0 else 0.0,
                "cmd_w": _r(a[1], 3) if a.size > 1 else 0.0, "cmd_pump": bool(info["pump"]),
                "fire_p": _r(self.env.fire.p, 3), "collisions": int(info["collisions"])}

    def close(self) -> None:
        if hasattr(self.env.world, "close"):
            self.env.world.close()
