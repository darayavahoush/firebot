"""The MuJoCo tab's /ws/mujoco?log=1 writes a session + frames using the ops-DB shapes."""
import pytest

pytest.importorskip("mujoco")
pytest.importorskip("fastapi")

from firebot.sim.stream import EpisodeStream

SENSOR_KEYS = {"us_front_left", "us_front_right", "us_left", "us_right", "flame_left",
               "flame_center", "flame_right", "mq2_front", "mq2_rear"}


def test_db_row_matches_frames_schema():
    st = EpisodeStream(seed=0, controller="frontier", max_steps=50)
    try:
        st.step()
        st.step()
        r = st.last_db
        assert r["seq"] == 2
        assert set(r["sensors"]) == SENSOR_KEYS
        assert r["mode"] in {"EXPLORE", "TRACK", "SPRAY"}
        assert isinstance(r["cmd_pump"], bool)
        assert {"t", "x", "y", "theta", "tank", "cmd_v", "cmd_w"} <= set(r)
    finally:
        st.close()
