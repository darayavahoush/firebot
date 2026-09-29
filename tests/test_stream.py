import json

import pytest

from firebot.sim.stream import EpisodeStream


def test_rejects_unknown_controller():
    with pytest.raises(ValueError):
        EpisodeStream(0, "nope", world="random")


def test_scene_and_frames_are_json_safe_grid_world():
    s = EpisodeStream(1, "scan", world="random", max_steps=30)
    sc = s.scene()
    assert {"width", "height", "walls", "fire", "robot", "dt", "wall_height"} <= set(sc)
    frames = []
    while not s.done:
        frames.append(s.step())
    assert len(frames) == 30 and frames[-1]["done"]
    f = frames[0]
    assert len(f["scan"]) == 36 and {"x", "y", "th", "turret", "state", "fire_p"} <= set(f)
    json.dumps(sc)
    json.dumps(frames)


def test_mujoco_scene_has_rooms_and_props():
    pytest.importorskip("mujoco")
    s = EpisodeStream(3, "frontier", world="mujoco", max_steps=20)
    try:
        sc = s.scene()
        assert sc["rooms"] and sc["props"]
        assert all("kind" in r for r in sc["rooms"])
        for _ in range(20):
            f = s.step()
        assert f["done"] and isinstance(f["path"], list)
        json.dumps(sc)
    finally:
        s.close()
