import sqlite3

import pytest

from firebot.db.store import Store


def test_session_and_events_roundtrip():
    with Store(":memory:") as db:
        sid = db.start_session("sim", "unit test")
        db.log_fire_event(sid, "detected", x=1.0, y=2.0, confidence=0.4, ts=1.0)
        db.log_fire_event(sid, "extinguished", x=1.1, y=2.1, confidence=0.9, ts=2.0,
                          meta={"water": 0.2})
        ev = db.fire_events(sid)
        assert [e["kind"] for e in ev] == ["detected", "extinguished"]
        assert db.recent_fire_events(1)[0]["kind"] == "extinguished"


def test_batch_readings_and_actions():
    with Store(":memory:") as db:
        sid = db.start_session()
        db.log_readings(sid, [(0.0, "us1", 1.5), (0.1, "us1", 1.4), (0.1, "gas", 0.2)])
        assert [r["value"] for r in db.readings(sid, "us1")] == [1.5, 1.4]
        assert db.log_action(sid, "spray", {"pan": 0.1}, "ok") == 1


def test_constraints_enforced():
    with Store(":memory:") as db:
        sid = db.start_session()
        with pytest.raises(sqlite3.IntegrityError):
            db.log_fire_event(sid, "exploded")
        with pytest.raises(sqlite3.IntegrityError):
            db.log_fire_event(sid, "detected", confidence=1.5)
        with pytest.raises(sqlite3.IntegrityError):
            db.log_fire_event(9999, "detected")


def test_schema_version_set(tmp_path):
    path = tmp_path / "t.db"
    Store(path).close()
    assert sqlite3.connect(path).execute("PRAGMA user_version").fetchone()[0] == 1
