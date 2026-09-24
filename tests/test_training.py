import numpy as np

from firebot.db.training import TrainingStore


def _episode(T=5, od=4, ad=2):
    rng = np.random.default_rng(1)
    return dict(obs=rng.normal(size=(T, od)), actions=rng.normal(size=(T, ad)),
                rewards=np.ones(T), terminated=np.eye(T)[-1].astype(bool),
                truncated=np.zeros(T, bool))


def test_scenario_dedup_and_episode_roundtrip():
    with TrainingStore(":memory:") as db:
        a = db.add_scenario("room1", {"walls": 3}, seed=1)
        assert a == db.add_scenario("room1", {"walls": 3}, seed=1)
        assert a != db.add_scenario("room1", {"walls": 3}, seed=2)
        run = db.start_run("ppo", {"lr": 3e-4}, git_commit="abc123")
        ep = _episode()
        eid = db.add_episode(run, **ep, policy="drl", success=True, scenario_id=a)
        out = db.load_episode(eid)
        assert np.allclose(out["obs"], ep["obs"], atol=1e-5)
        assert out["terminated"][-1] and out["rewards"].sum() == 5


def test_run_summary_and_iteration():
    with TrainingStore(":memory:") as db:
        run = db.start_run("rule")
        db.add_episode(run, **_episode(), policy="rule", success=True)
        db.add_episode(run, **_episode(), policy="rule", success=False, split="val")
        db.log_metric(run, 100, "reward", 1.5)
        db.finish_run(run)
        s = db.run_summary()[0]
        assert s["episodes"] == 2 and s["success_rate"] == 0.5 and s["status"] == "done"
        assert len(list(db.iter_episodes("train", success_only=True))) == 1
