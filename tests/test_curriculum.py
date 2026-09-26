"""Smoke tests for the curriculum trainer. Skipped if the `drl` extra isn't installed."""
import pytest

pytest.importorskip("gymnasium")
pytest.importorskip("stable_baselines3")

from firebot.db.training import TrainingStore
from firebot.drl.curriculum import build_stages, train_curriculum


def test_build_stages_are_ordered_easy_to_hard():
    stages = build_stages(timesteps_per_stage=100, easy_min_dist=4.0, hard_min_dist=9.0)
    assert [s.name for s in stages] == ["fixed_room", "fixed_room_far_fire",
                                        "procedural_buildings"]
    assert stages[0].env_kwargs["min_fire_dist"] < stages[1].env_kwargs["min_fire_dist"]
    assert "world_factory" not in stages[0].env_kwargs
    assert "world_factory" in stages[-1].env_kwargs


def test_curriculum_training_smoke(tmp_path):
    run_id = train_curriculum(
        timesteps_per_stage=64, n_envs=1, seed=0, train_path=str(tmp_path / "train.db"),
        out_dir=str(tmp_path / "runs"), checkpoint_every=32, n_steps=32, batch_size=16,
        easy_min_dist=2.0, hard_min_dist=3.0,
    )
    with TrainingStore(tmp_path / "train.db") as store:
        row = store.run_summary()[0]
        assert row["run_id"] == run_id
        assert row["algo"] == "ppo-curriculum" and row["status"] == "done"
    assert (tmp_path / "runs" / "model_final.zip").exists()
    # one "after this stage" checkpoint per stage, plus the model_final.zip save
    for stage_name in ("fixed_room", "fixed_room_far_fire", "procedural_buildings"):
        assert (tmp_path / "runs" / f"model_after_{stage_name}.zip").exists()
