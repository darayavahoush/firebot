"""Smoke tests for the DRL layer. Skipped if the `drl` extra isn't installed."""
import pytest

pytest.importorskip("gymnasium")
pytest.importorskip("stable_baselines3")

from gymnasium.utils.env_checker import check_env

from firebot.db.training import TrainingStore
from firebot.drl.evaluate import compare, evaluate_policy, rule_act_factory
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


def test_compare_handles_runs_with_no_episode_data(tmp_path, capsys):
    """A `firebot-train-curriculum` run logs checkpoints, not episodes, so it shows up
    in `run_summary()` with success_rate/mean_reward/etc. all None. `compare()`'s summary
    printer (used by the `firebot-eval` CLI) must print "--" for that run rather than
    crashing on the None -- especially since curriculum.py's own docstring tells users to
    run `firebot-eval --train-db training.db` right after a curriculum run, which shares
    the same training DB.
    """
    train_path = str(tmp_path / "train.db")
    run_id = train(timesteps=64, n_envs=1, seed=0, train_path=train_path,
                   out_dir=str(tmp_path / "runs"), checkpoint_every=64, n_steps=32,
                   batch_size=16)
    with TrainingStore(train_path) as store:
        # Simulate a prior curriculum run: started and finished, but no add_episode calls,
        # exactly like train_curriculum() in firebot.drl.curriculum.
        no_episode_run_id = store.start_run("ppo-curriculum", {})
        store.finish_run(no_episode_run_id, status="done")

    compare(str(tmp_path / "runs" / "model_final.zip"), episodes=2, seed=10_000,
           train_path=train_path)
    out = capsys.readouterr().out
    assert "--" in out  # the no-episode-data row printed placeholders, not a crash
    assert str(no_episode_run_id) in out
    assert str(run_id) in out
