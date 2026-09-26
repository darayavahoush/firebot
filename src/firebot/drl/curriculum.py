"""Curriculum / domain-randomization training over increasingly hard `FireGymEnv` stages.

    firebot-train-curriculum --timesteps-per-stage 100000 --n-envs 8 --seed 0 \\
        --train-db training.db --out runs/curriculum

One PPO model is trained across three stages of increasing difficulty, all recorded under
a single `runs` row (algo="ppo-curriculum") in the training DB. Stage transitions call
`model.set_env(new_vec_env)` then `model.learn(..., reset_num_timesteps=False)`, so SB3's
own timestep counter and logger state carry over unbroken -- this is one policy getting
harder homework each stage, not three unrelated runs:

  1. `fixed_room` -- the same fixed single-room `World()` and (default) fire distance
     `firebot-train` already uses, so this stage alone reproduces the non-curriculum setup.
  2. `fixed_room_far_fire` -- same fixed map, fire spawned much further from the robot
     (`min_fire_dist` raised), so the policy has to search/navigate more before any fire is
     even in sensor range.
  3. `procedural_buildings` -- a fresh, procedurally-generated multi-room building every
     single episode (`World.random`, via `firebot.sim.mapgen`), forcing generalization past
     one memorized floor plan.

`FireEnv`/`FireGymEnv` clamp `min_fire_dist` per-episode (`firebot.sim.env
.clamp_min_fire_dist`) to whatever each generated map can actually satisfy, so stage 3's
randomly-sized rooms never hang training even when they're smaller than `hard_min_dist`.
"""
from __future__ import annotations

import argparse
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from stable_baselines3 import PPO
from stable_baselines3.common.env_util import make_vec_env

from firebot.db.training import TrainingStore
from firebot.sim.world import World

from .gym_env import FireGymEnv
from .train import CHECKPOINT_EVERY, TrainingDBCallback, _git_commit


@dataclass(frozen=True)
class Stage:
    name: str
    timesteps: int
    env_kwargs: dict[str, Any] = field(default_factory=dict)


def _random_building(rng):
    return World.random(rng)


def build_stages(timesteps_per_stage: int, easy_min_dist: float = 4.0,
                 hard_min_dist: float = 9.0) -> list[Stage]:
    return [
        Stage("fixed_room", timesteps_per_stage, {"min_fire_dist": easy_min_dist}),
        Stage("fixed_room_far_fire", timesteps_per_stage, {"min_fire_dist": hard_min_dist}),
        Stage("procedural_buildings", timesteps_per_stage,
             {"world_factory": _random_building, "min_fire_dist": hard_min_dist}),
    ]


def train_curriculum(timesteps_per_stage: int, n_envs: int, seed: int, train_path: str,
                     out_dir: str, checkpoint_every: int = CHECKPOINT_EVERY,
                     learning_rate: float = 3e-4, n_steps: int = 2048, batch_size: int = 64,
                     gamma: float = 0.99, easy_min_dist: float = 4.0,
                     hard_min_dist: float = 9.0) -> int:
    """Train one PPO model through all curriculum stages in order. Returns the `runs.id`."""
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    stages = build_stages(timesteps_per_stage, easy_min_dist, hard_min_dist)
    hyperparams = {"n_envs": n_envs, "learning_rate": learning_rate, "n_steps": n_steps,
                  "batch_size": batch_size, "gamma": gamma,
                  "timesteps_per_stage": timesteps_per_stage,
                  "stages": [s.name for s in stages]}

    model: PPO | None = None
    with TrainingStore(train_path) as train_store:
        run_id = train_store.start_run("ppo-curriculum", hyperparams, git_commit=_git_commit(),
                                       env_version="sim-0.1")
        status = "failed"
        try:
            for stage in stages:
                stage_env = make_vec_env(FireGymEnv, n_envs=n_envs, seed=seed,
                                         env_kwargs=stage.env_kwargs,
                                         monitor_dir=str(out / f"monitor_{stage.name}"))
                if model is None:
                    model = PPO("MlpPolicy", stage_env, learning_rate=learning_rate,
                               n_steps=n_steps, batch_size=batch_size, gamma=gamma,
                               seed=seed, verbose=1)
                else:
                    model.set_env(stage_env)
                callback = TrainingDBCallback(train_store, run_id, out, checkpoint_every)
                model.learn(total_timesteps=stage.timesteps, callback=callback,
                           reset_num_timesteps=False)
                stage_path = out / f"model_after_{stage.name}.zip"
                model.save(str(stage_path))
                train_store.save_checkpoint(run_id, model.num_timesteps, str(stage_path),
                                            metrics={"stage": stage.name})
            status = "done"
        finally:
            if model is not None:
                final_path = out / "model_final.zip"
                model.save(str(final_path))
                train_store.save_checkpoint(run_id, model.num_timesteps, str(final_path))
            train_store.finish_run(run_id, status=status)
    return run_id


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__,
                                formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--timesteps-per-stage", type=int, default=100_000)
    p.add_argument("--n-envs", type=int, default=8)
    p.add_argument("--seed", type=int, default=0)
    p.add_argument("--train-db", default="training.db")
    p.add_argument("--out", default="runs/curriculum")
    p.add_argument("--learning-rate", type=float, default=3e-4)
    p.add_argument("--n-steps", type=int, default=2048)
    p.add_argument("--batch-size", type=int, default=64)
    p.add_argument("--gamma", type=float, default=0.99)
    p.add_argument("--checkpoint-every", type=int, default=CHECKPOINT_EVERY)
    p.add_argument("--easy-min-dist", type=float, default=4.0,
                   help="min robot<->fire distance for the fixed_room stage")
    p.add_argument("--hard-min-dist", type=float, default=9.0,
                   help="min robot<->fire distance for the two harder stages")
    a = p.parse_args()
    run_id = train_curriculum(a.timesteps_per_stage, a.n_envs, a.seed, a.train_db, a.out,
                              a.checkpoint_every, a.learning_rate, a.n_steps, a.batch_size,
                              a.gamma, a.easy_min_dist, a.hard_min_dist)
    n_stages = len(build_stages(a.timesteps_per_stage))
    print(f"Curriculum run {run_id} done across {n_stages} stages. "
          f"Model + checkpoints in {a.out}/. Compare with `firebot-eval --train-db {a.train_db}`.")


if __name__ == "__main__":
    main()
