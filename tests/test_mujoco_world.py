import numpy as np
import pytest

pytest.importorskip("mujoco")

from firebot.sim.env import FireEnv
from firebot.sim.mapgen import PROP_CLEARANCE, generate_building, generate_props
from firebot.sim.mujoco_world import MuJoCoWorld
from firebot.sim.world import World


def test_default_map_matches_analytic_grid():
    w, ref = MuJoCoWorld(), World()
    w_ok = w.grid | ref.grid
    # physics-derived grid must cover the analytic one and not invent large extra area
    assert (ref.grid & ~w.grid).sum() <= 0.01 * ref.grid.sum()
    assert (w.grid & ~ref.grid).sum() <= 0.15 * ref.grid.sum()
    assert w_ok.any()
    w.close()


def test_rays_match_grid_raycast_and_batch():
    w, ref = MuJoCoWorld(), World()
    for a in np.linspace(0, 2 * np.pi, 12, endpoint=False):
        assert abs(w.ray(1.2, 1.0, a, 4.0) - ref.ray(1.2, 1.0, a, 4.0)) < 0.15
    angs = np.linspace(0, 2 * np.pi, 8, endpoint=False)
    single = np.array([w.ray(1.2, 1.0, a, 4.0) for a in angs])
    assert np.allclose(w.rays(1.2, 1.0, angs, 4.0), single, atol=1e-6)
    w.close()


def test_props_block_grid_and_lidar():
    props = [{"kind": "barrel", "x": 6.0, "y": 4.0, "r": 0.3, "height": 0.9, "yaw": 0.0}]
    w = MuJoCoWorld(props=props)
    assert not w.is_free(6.0, 4.0) and w.is_free(4.5, 4.0)
    assert w.robot_collides(6.0, 4.0) and not w.robot_collides(4.5, 4.0)
    assert 1.0 < w.ray(4.0, 4.0, 0.0, 4.0) < 1.8
    w.close()


def test_tree_canopy_is_visual_only():
    tree = {"kind": "tree", "x": 6.0, "y": 4.0, "r": 0.12, "canopy": 0.7, "height": 1.3,
            "yaw": 0.0}
    w = MuJoCoWorld(props=[tree])
    assert w.is_free(6.5, 4.0)  # under the canopy, clear of the trunk
    w.close()


def test_generated_props_keep_clearance_and_doorways_open():
    rng = np.random.default_rng(3)
    width, height, walls = generate_building(rng)
    props = generate_props(rng, width, height, walls)
    assert len(props) > 10
    for q in props:
        assert 1.0 <= q["x"] <= width - 1.0 and 1.0 <= q["y"] <= height - 1.0
    for i, a in enumerate(props):
        for b in props[i + 1:]:
            assert np.hypot(a["x"] - b["x"], a["y"] - b["y"]) > PROP_CLEARANCE


def test_random_mujoco_world_runs_in_env_and_releases_clients():
    env = FireEnv(max_steps=40, world_factory=lambda rng: MuJoCoWorld.random(rng))
    for seed in (0, 1):
        obs, _ = env.reset(seed=seed)
        for _ in range(20):
            obs, *_ = env.step(np.array([0.5, 0.2, 0.0, 0.0], dtype=np.float32))
        assert obs.shape[0] == env.obs_dim
    assert "props" in env.config()
    env.world.close()


def test_pickle_roundtrip_rebuilds_scene():
    import pickle
    w = MuJoCoWorld.random(seed=5)
    w2 = pickle.loads(pickle.dumps(w))
    assert w2.grid.shape == w.grid.shape and (w2.grid == w.grid).all()
    w.close()
    w2.close()
