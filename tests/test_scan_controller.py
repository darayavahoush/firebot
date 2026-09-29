import numpy as np
import pytest

from firebot.sim.controller import RuleController
from firebot.sim.env import DT, FireEnv
from firebot.sim.frontier_controller import FrontierController
from firebot.sim.scan_controller import ScanController, corridor_clearance
from firebot.sim.world import World

N = 36
REL = -np.pi + 2 * np.pi * np.arange(N) / N


def test_corridor_sees_thin_obstacle_but_passes_doorway():
    open_scan = np.full(N, 3.0)
    assert corridor_clearance(open_scan, REL)[N // 2] == pytest.approx(3.0)
    trunk = open_scan.copy()
    trunk[N // 2] = 0.5                           # one ray hits something dead ahead
    assert corridor_clearance(trunk, REL)[N // 2] < 0.6
    door = open_scan.copy()                       # walls 0.6 m either side of the heading
    door[N // 2 + 9] = door[N // 2 - 9] = 0.6     # rays at +/-90 deg
    assert corridor_clearance(door, REL)[N // 2] == pytest.approx(3.0)


def test_scan_shape_and_obs_dim_unchanged():
    env = FireEnv(world=World())
    obs, _ = env.reset(seed=0)
    assert env.scan().shape == (36,) and obs.shape == (17,)


def test_scan_controller_without_scan_matches_rule_baseline():
    env = FireEnv(world=World())
    obs, _ = env.reset(seed=1)
    rule, scan = RuleController(), ScanController()
    for _ in range(50):
        a, b = rule.act(obs, DT), scan.act(obs, DT)
        assert np.allclose(a, b)
        obs, *_ = env.step(a)


def test_scan_controller_turns_from_wall():
    c = ScanController()
    scan = np.full(N, 3.0)
    scan[N // 2 - 2:N // 2 + 3] = 0.4             # wall right in front
    scan[N // 2 + 6] = 3.0                        # opening on the left
    obs = np.zeros(17, dtype=np.float32)
    obs[0:4] = .5
    act = c.act(obs, DT, scan=scan)
    assert act[0] < .2 and abs(act[1]) > .5


def test_frontier_controller_runs_and_maps():
    env = FireEnv(world=World(), max_steps=400)
    obs, _ = env.reset(seed=3)
    c = FrontierController()
    for _ in range(400):
        obs, _, te, tr, info = env.step(c.act(obs, DT, scan=env.scan(), pose=env.robot))
        if te or tr:
            break
    assert (c.grid > 0).sum() > 500 and info["collisions"] < 50


def test_frontier_beats_rule_on_mujoco_maps():
    pytest.importorskip("mujoco")
    from firebot.sim.mujoco_world import MuJoCoWorld

    def coll(mk, use_pose):
        total = 0
        for seed in (0, 1, 2):
            env = FireEnv(max_steps=500, world_factory=lambda rng: MuJoCoWorld.random(rng))
            obs, _ = env.reset(seed=seed)
            c = mk()
            for _ in range(500):
                a = c.act(obs, DT, scan=env.scan(), pose=env.robot) if use_pose else c.act(obs, DT)
                obs, _, te, tr, info = env.step(a)
                if te or tr:
                    break
            total += info["collisions"]
            env.world.close()
        return total
    assert coll(FrontierController, True) < coll(RuleController, False) / 5
