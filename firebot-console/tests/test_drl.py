"""Smoke tests for the DRL layer. Skipped if the `drl` extra isn't installed."""
import pytest

pytest.importorskip("gymnasium")
pytest.importorskip("stable_baselines3")

from gymnasium.utils.env_checker import check_env

from firebot.db.training import TrainingStore
from firebot.drl.evaluate import evaluate_policy, rule_act_factory
from firebot.drl.gym_env import FireGymEnv
from firebot.drl.train import train


def test_gym_env_conforms_to_gymnasium_api():
    check_env(FireGymEnv(max_steps=50), skip_render_check=True)


def test_ppo_training_smoke(tmp_path):
    run_id = train(
        timesteps=128, n_envs=2, seed=0, train_path=str(tmp_path / "train.db"),
        out_dir=str(tmp_path / "runs"), checkpoint_every=64, n_steps=32, batch_size=16,
    )
    with TrainingStore(tmp_path / "train.db") as store:
        row = store.run_summary()[0]
        assert row["run_id"] == run_id and row["algo"] == "ppo" and row["status"] == "done"
    assert (tmp_path / "runs" / "model_final.zip").exists()
    assert list((tmp_path / "runs").glob("ckpt_*.zip"))


def test_evaluate_writes_comparable_runs(tmp_path):
    train(timesteps=64, n_envs=1, seed=0, train_path=str(tmp_path / "train.db"),
         out_dir=str(tmp_path / "runs"), checkpoint_every=64, n_steps=32, batch_size=16)
    from stable_baselines3 import PPO

    model = PPO.load(str(tmp_path / "runs" / "model_final.zip"))

    def ppo_act_factory():
        def act(obs):
            action, _ = model.predict(obs, deterministic=True)
            return action
        return act

    with TrainingStore(tmp_path / "train.db") as store:
        evaluate_policy(store, "ppo", "drl", ppo_act_factory, episodes=2, seed=10_000)
        evaluate_policy(store, "rule", "rule", rule_act_factory, episodes=2, seed=10_000)
        rows = {r["algo"]: r for r in store.run_summary()}
        assert rows["ppo"]["episodes"] == 2 and rows["rule"]["episodes"] == 2
