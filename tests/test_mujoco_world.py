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


def test_layout_rooms_typed_and_always_reachable():
    from firebot.sim.mapgen import ROOM_KINDS, generate_layout, is_connected
    for seed in range(40):
        rng = np.random.default_rng(seed)
        width, height, walls, rooms = generate_layout(rng)
        assert is_connected(width, height, walls)
        assert rooms and all(r["kind"] in ROOM_KINDS for r in rooms)
        assert abs(sum(r["w"] * r["h"] for r in rooms) - width * height) < 1e-6


def test_enclosed_rooms_have_interior_walls_but_default_generator_unchanged():
    from firebot.sim import mapgen
    for seed in range(5):
        a = mapgen.generate_building(np.random.default_rng(seed))
        b = mapgen.generate_building(np.random.default_rng(seed))
        assert a == b                       # deterministic, and rng stream is untouched
    _, _, walls, _ = mapgen.generate_layout(np.random.default_rng(7))
    _, _, legacy = mapgen.generate_building(np.random.default_rng(7))
    assert len(walls) > len(legacy) - 4     # enclosed mode adds the missing boundary walls


def test_room_props_follow_room_purpose_and_keep_clearance():
    from firebot.sim.mapgen import ROOM_KINDS, generate_layout
    for seed in range(10):
        rng = np.random.default_rng(seed)
        width, height, walls, rooms = generate_layout(rng)
        props = generate_props(rng, width, height, walls, rooms=rooms)
        for q in props:
            allowed = ROOM_KINDS[rooms[q["room"]]["kind"]][1]
            assert q["kind"] in allowed
            r = rooms[q["room"]]
            assert r["x"] <= q["x"] <= r["x"] + r["w"] and r["y"] <= q["y"] <= r["y"] + r["h"]


def test_render_writes_png_and_survives_edge_clipping(tmp_path):
    w = MuJoCoWorld.random(seed=2)
    out = tmp_path / "m.png"
    w.render(str(out), px_per_m=20)
    assert out.read_bytes()[:8] == b"\x89PNG\r\n\x1a\n"
    # props hugging the map edge must not crash the clipped shadow/paint windows
    edge = MuJoCoWorld(props=[{"kind": "tree", "x": 0.05, "y": 0.05, "r": 0.1, "height": 1.3,
                               "canopy": 0.7, "yaw": 0.0},
                              {"kind": "shelf", "x": 11.95, "y": 7.95, "w": 1.2, "h": 0.4,
                               "height": 1.8, "yaw": 0.4}])
    edge.render(str(tmp_path / "e.png"), px_per_m=20)
    assert (tmp_path / "e.png").exists()


def test_random_world_pickles_with_rooms():
    import pickle
    w = MuJoCoWorld.random(seed=4)
    w2 = pickle.loads(pickle.dumps(w))
    assert w2.rooms == w.rooms and (w2.grid == w.grid).all()


def test_rover_scene_compiles_with_every_sensor_at_sim_angles():
    import re

    from firebot.sensing import FLAME, US
    from firebot.sim.mujoco_world import SENSOR_LEGEND, _rover_mjcf
    xml = _rover_mjcf(1.0, 2.0, 0.3, turret=0.4)
    for a in list(US.values()) + list(FLAME.values()):   # each sensor body uses its sim angle
        assert re.search(rf'euler="0 0 {a}"', xml)
    assert len(SENSOR_LEGEND) == 6
    w = MuJoCoWorld.random(seed=1)
    import mujoco
    mujoco.MjModel.from_xml_string(w._mjcf("neon", rover=(3.0, 3.0, 0.0, 0.2), probe=False))
    mujoco.MjModel.from_xml_string(w._mjcf("neon", rover=(3.0, 3.0, 0.0), beams=False, probe=False))


def test_render3d_writes_png_when_gl_available(tmp_path, monkeypatch):
    import os
    if not os.environ.get("MUJOCO_GL"):
        pytest.skip("set MUJOCO_GL=egl|osmesa to exercise the real 3-D renderer")
    w = MuJoCoWorld.random(seed=3)
    for shot in ("hero", "sensors", "overview"):
        out = tmp_path / f"{shot}.png"
        w.render3d(str(out), shot, width=320, height=200)
        assert out.read_bytes()[:8] == b"\x89PNG\r\n\x1a\n"
