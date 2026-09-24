"""Train a PPO policy against `FireGymEnv` and record progress to the training DB.

    firebot-train --timesteps 200000 --n-envs 8 --seed 0 \\
        --train-db training.db --out runs/ppo

Every run is a row in `runs` (algo="ppo"); rollout stats land in `metrics`, and periodic +
final checkpoints are recorded via `save_checkpoint`. `firebot-eval` compares the result
against the `RuleController` baseline (algo="rule") through `TrainingStore.run_summary()`
(`v_run_summary`).
"""
from __future__ import annotations

import argparse
import subprocess
from pathlib import Path

from stable_baselines3 import PPO
from stable_baselines3.common.callbacks import BaseCallback
from stable_baselines3.common.env_util import make_vec_env

from firebot.db.training import TrainingStore

from .gym_env import FireGymEnv

CHECKPOINT_EVERY = 50_000


def _git_commit() -> str | None:
    try:
        return subprocess.check_output(["git", "rev-parse", "--short", "HEAD"],
                                       stderr=subprocess.DEVNULL, text=True).strip()
    except (OSError, subprocess.CalledProcessError):
        return None


class TrainingDBCallback(BaseCallback):
    """Mirrors SB3's own rollout stats into `training.db` and saves periodic checkpoints.

    Reads `model.logger.name_to_value` after each rollout (populated by SB3's own logger with
    things like `rollout/ep_rew_mean`, `rollout/ep_len_mean`, `train/loss`), so this adds no
    bookkeeping of its own and stays correct if SB3 adds/renames metrics.
    """

    def __init__(self, train: TrainingStore, run_id: int, out_dir: Path,
                 checkpoint_every: int = CHECKPOINT_EVERY, verbose: int = 0) -> None:
        super().__init__(verbose)
        self.train, self.run_id, self.out_dir = train, run_id, out_dir
        self.checkpoint_every, self._next_ckpt = checkpoint_every, checkpoint_every

    def _on_step(self) -> bool:
        if self.num_timesteps >= self._next_ckpt:
            path = self.out_dir / f"ckpt_{self.num_timesteps}.zip"
            self.model.save(str(path))
            self.train.save_checkpoint(self.run_id, self.num_timesteps, str(path))
            self._next_ckpt += self.checkpoint_every
        return True

    def _on_rollout_end(self) -> None:
        for key, value in self.model.logger.name_to_value.items():
            self.train.log_metric(self.run_id, self.num_timesteps, key, float(value))


def train(timesteps: int, n_envs: int, seed: int, train_path: str, out_dir: str,
          checkpoint_every: int = CHECKPOINT_EVERY, learning_rate: float = 3e-4,
          n_steps: int = 2048, batch_size: int = 64, gamma: float = 0.99) -> int:
    """Run PPO training; returns the `runs.id` in `train_path` for this run."""
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    vec_env = make_vec_env(FireGymEnv, n_envs=n_envs, seed=seed,
                           monitor_dir=str(out / "monitor"))
    model = PPO("MlpPolicy", vec_env, learning_rate=learning_rate, n_steps=n_steps,
               batch_size=batch_size, gamma=gamma, seed=seed, verbose=1)
    hyperparams = {"n_envs": n_envs, "learning_rate": learning_rate, "n_steps": n_steps,
                  "batch_size": batch_size, "gamma": gamma, "timesteps": timesteps}
    with TrainingStore(train_path) as train_store:
        run_id = train_store.start_run("ppo", hyperparams, git_commit=_git_commit(),
                                       env_version="sim-0.1")
        callback = TrainingDBCallback(train_store, run_id, out, checkpoint_every)
        status = "failed"
        try:
            model.learn(total_timesteps=timesteps, callback=callback)
            status = "done"
        finally:
            final_path = out / "model_final.zip"
            model.save(str(final_path))
            train_store.save_checkpoint(run_id, model.num_timesteps, str(final_path))
            train_store.finish_run(run_id, status=status)
    return run_id


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__,
                                formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--timesteps", type=int, default=200_000)
    p.add_argument("--n-envs", type=int, default=8)
    p.add_argument("--seed", type=int, default=0)
    p.add_argument("--train-db", default="training.db")
    p.add_argument("--out", default="runs/ppo")
    p.add_argument("--learning-rate", type=float, default=3e-4)
    p.add_argument("--n-steps", type=int, default=2048)
    p.add_argument("--batch-size", type=int, default=64)
    p.add_argument("--gamma", type=float, default=0.99)
    p.add_argument("--checkpoint-every", type=int, default=CHECKPOINT_EVERY)
    a = p.parse_args()
    run_id = train(a.timesteps, a.n_envs, a.seed, a.train_db, a.out, a.checkpoint_every,
                  a.learning_rate, a.n_steps, a.batch_size, a.gamma)
    print(f"PPO run {run_id} done. Model + checkpoints in {a.out}/. "
          f"Compare with `firebot-eval --train-db {a.train_db}`.")


if __name__ == "__main__":
    main()
