"""Benchmark the planning controller against the rule baseline (same seeds, training DB).

    firebot-plan --episodes 30 --seed 10000 --train-db training.db

Both controllers are stored as runs (`algo="planner"` / `"rule"`) so `v_run_summary` compares
them side by side. No extra dependencies beyond numpy.
"""
from __future__ import annotations

import argparse
import subprocess
from collections.abc import Callable

import numpy as np

from firebot.db.training import TrainingStore
from firebot.sim.controller import RuleController
from firebot.sim.env import DT, FireEnv

from .controller import PlanningController

POLICY = {"planner": "rrt", "rule": "rule"}  # episodes.policy CHECK values in the schema

# factory(env, seed) -> act(obs, robot_pose) -> action
ActFactory = Callable[[FireEnv, int], Callable[[np.ndarray, np.ndarray], np.ndarray]]


def _git_commit() -> str | None:
    try:
        return subprocess.check_output(["git", "rev-parse", "--short", "HEAD"],
                                       stderr=subprocess.DEVNULL, text=True).strip()
    except (OSError, subprocess.CalledProcessError):
        return None


def rule_factory(env: FireEnv, seed: int):
    ctrl = RuleController()
    return lambda obs, pose: ctrl.act(obs, DT)


def planner_factory(env: FireEnv, seed: int):
    ctrl = PlanningController(env.world, seed=seed)
    return lambda obs, pose: ctrl.act(obs, pose, DT)


def run_episode(env: FireEnv, act, seed: int) -> dict:
    obs, _ = env.reset(seed=seed)
    O, A, R, TE, TR = [], [], [], [], []
    info: dict = {}
    while True:
        a = np.asarray(act(obs, env.robot), dtype=np.float32)
        O.append(obs)
        A.append(a)
        obs, r, te, tr, info = env.step(a)
        R.append(r)
        TE.append(te)
        TR.append(tr)
        if te or tr:
            break
    return dict(obs=np.array(O), actions=np.array(A), rewards=np.array(R),
                terminated=np.array(TE), truncated=np.array(TR), final_obs=obs,
                success=bool(te), collisions=info["collisions"], water_used=info["water_used"],
                time_to_extinguish=env.t * DT if te else None)


def evaluate(train: TrainingStore, algo: str, factory: ActFactory, episodes: int, seed: int) -> int:
    env = FireEnv()
    run_id = train.start_run(algo, {"controller": algo}, git_commit=_git_commit(),
                             env_version="sim-0.1")
    for i in range(episodes):
        s = seed + i
        ep = run_episode(env, factory(env, s), s)
        scen = train.add_scenario("default-room", env.config(), seed=s)
        train.add_episode(
            run_id, ep["obs"], ep["actions"], ep["rewards"], ep["terminated"], ep["truncated"],
            policy=POLICY[algo], success=ep["success"], scenario_id=scen, split="test",
            collisions=ep["collisions"], water_used=ep["water_used"],
            time_to_extinguish=ep["time_to_extinguish"], final_obs=ep["final_obs"])
    train.finish_run(run_id)
    return run_id


def compare(episodes: int, seed: int, train_path: str) -> None:
    with TrainingStore(train_path) as train:
        evaluate(train, "planner", planner_factory, episodes, seed)
        evaluate(train, "rule", rule_factory, episodes, seed)
        print(f"{'run':>4}  {'algo':<8} {'success':>8} {'reward':>8} {'steps':>7} {'collisions':>11}")
        for r in train.run_summary():
            print(f"{r['run_id']:>4}  {r['algo']:<8} {r['success_rate']:>7.0%} "
                  f"{r['mean_reward']:>8.1f} {r['mean_steps']:>7.0f} {r['mean_collisions']:>11.2f}")


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__,
                                formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--episodes", type=int, default=30)
    p.add_argument("--seed", type=int, default=10_000)
    p.add_argument("--train-db", default="training.db")
    a = p.parse_args()
    compare(a.episodes, a.seed, a.train_db)


if __name__ == "__main__":
    main()
