import numpy as np

from firebot.db.store import Store


def test_seed_devices_and_device_linked_readings():
    with Store(":memory:") as db:
        db.seed_default_devices()
        db.seed_default_devices()  # idempotent
        ids = db.device_ids()
        assert {"thermal_cam", "pump", "us_left", "mq2_rear", "servo_pan"} <= set(ids)
        sid = db.start_session()
        db.log_readings(sid, [(0.0, "us_left", 1.2), (0.0, "unknown_sensor", 3.0)])
        rows = db.conn.execute("SELECT sensor, device_id FROM sensor_readings").fetchall()
        assert rows[0]["device_id"] == ids["us_left"] and rows[1]["device_id"] is None


def test_thermal_frame_roundtrip_and_hotspot():
    with Store(":memory:") as db:
        db.seed_default_devices()
        sid = db.start_session()
        frame = np.full((24, 32), 25.0, dtype=np.float32)
        frame[10, 20] = 310.5
        fid = db.log_thermal_frame(sid, frame)
        out = db.thermal_frame(fid)
        assert out.shape == (24, 32) and np.allclose(out, frame)
        row = db.conn.execute("SELECT * FROM thermal_frames WHERE id=?", (fid,)).fetchone()
        assert (row["hot_row"], row["hot_col"]) == (10, 20)


def test_telemetry_and_incident_view():
    with Store(":memory:") as db:
        db.seed_default_devices()
        sid = db.start_session()
        db.log_pose(sid, 1.0, 2.0, 0.3, "odom")
        db.log_power(sid, "battery", 11.8, 2.1)
        db.set_actuator(sid, "pump", 1.0)
        aid = db.log_action(sid, "spray")
        db.log_voice_command(sid, "put out the fire", {"intent": "suppress"}, True, aid)
        db.log_fire_event(sid, "detected", ts=10.0)
        db.log_fire_event(sid, "extinguished", ts=25.0)
        inc = db.incidents()
        assert len(inc) == 1 and inc[0]["response_s"] == 15.0
