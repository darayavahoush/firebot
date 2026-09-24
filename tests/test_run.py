from firebot.db.store import Store
from firebot.db.training import TrainingStore
from firebot.sim.run import run_baseline


def test_run_baseline_writes_both_databases(tmp_path):
    ops_p, tr_p = tmp_path / "ops.db", tmp_path / "train.db"
    res = run_baseline(3, 0, str(ops_p), str(tr_p))
    assert len(res) == 3
    with Store(ops_p) as ops, TrainingStore(tr_p) as tr:
        assert ops.conn.execute("SELECT COUNT(*) FROM sessions").fetchone()[0] == 3
        assert ops.conn.execute("SELECT COUNT(*) FROM thermal_frames").fetchone()[0] > 0
        assert ops.conn.execute("SELECT COUNT(*) FROM robot_poses").fetchone()[0] > 0
        assert any(r["response_s"] and r["response_s"] > 0 for r in ops.incidents())
        s = tr.run_summary()[0]
        assert s["episodes"] == 3 and s["status"] == "done"
        ep = next(tr.iter_episodes("train"))
        assert ep["obs"].shape[1] == 16 and ep["actions"].shape[1] == 3
