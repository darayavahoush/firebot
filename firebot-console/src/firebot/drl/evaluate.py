"""Evaluate a trained PPO checkpoint against the `RuleController` baseline.

    firebot-eval --model runs/ppo/model_final.zip --episodes 30 --seed 10000 \\
        --train-db training.db

Runs both policies over the *same* seeds (so room/fire placement is identical across the
comparison) and appends each as its own run in the training DB (`algo="ppo"` / `"rule"`,
`policy="drl"` / `"rule"` on the episodes). Prints `TrainingStore.run_summary()`
(`v_run_summary`) afterwards so you can see success rate, reward, steps and collisions
side by side.

Unlike `firebot-sim`, this only writes to the training DB, not the operational one: it's an
algorithm-comparison run, not a stand-in for real operation. Use a `--seed` range disjoint
from whatever `firebot-sim` already used (seeds 0..N), so eval episodes are scenarios the
policy hasn't been evaluated on before.
"""
from __future__ import annotations

import argparse
import subprocess
from collections.abc import Callable

import numpy as np
from stable_baselines3 import PPO

from firebot.db.training import TrainingStore
from firebot.sim.controller import RuleController
from firebot.sim.env import DT, FireEnv

Act = Callable[[np.ndarray], np.ndarray]


def _git_commit() -> str | None:
    try:
        return subprocess.check_output(["git", "rev-parse", "--short", "HEAD"],
                                       stderr=subprocess.DEVNULL, text=True).strip()
    except (OSError, subprocess.CalledProcessError):
        return None


def run_episode(env: FireEnv, act: Act, seed: int) -> dict:
    """Play one episode against `act(obs) -> action`. Returns arrays + summary stats."""
    obs, _ = env.reset(seed=seed)
    O, A, R, TE, TR = [], [], [], [], []
    info: dict = {}
    while True:
        a = np.asarray(act(obs), dtype=np.float32)
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


def evaluate_policy(train: TrainingStore, algo: str, policy_label: str,
                    act_factory: Callable[[], Act], episodes: int, seed: int,
                    hyperparams: dict | None = None) -> int:
    """Run `episodes` episodes (seeds `seed..seed+episodes-1`) and store them as one run.

    `act_factory()` is called fresh for each episode, so stateful controllers (e.g.
    `RuleController`) start clean every time, matching how `firebot-sim` uses them.
    """
    env = FireEnv()
    run_id = train.start_run(algo, hyperparams, git_commit=_git_commit(), env_version="sim-0.1")
    for i in range(episodes):
        s = seed + i
        ep = run_episode(env, act_factory(), s)
        scen = train.add_scenario("default-room", env.config(), seed=s)
        train.add_episode(
            run_id, ep["obs"], ep["actions"], ep["rewards"], ep["terminated"], ep["truncated"],
            policy=policy_label, success=ep["success"], scenario_id=scen, split="test",
            collisions=ep["collisions"], water_used=ep["water_used"],
            time_to_extinguish=ep["time_to_extinguish"], final_obs=ep["final_obs"])
    train.finish_run(run_id)
    return run_id


def rule_act_factory() -> Act:
    ctrl = RuleController()
    return lambda obs: ctrl.act(obs, DT)


def _ppo_act_factory(model: PPO) -> Callable[[], Act]:
    def factory() -> Act:
        def act(obs: np.ndarray) -> np.ndarray:
            action, _ = model.predict(obs, deterministic=True)
            return action
        return act
    return factory


def compare(model_path: str, episodes: int, seed: int, train_path: str) -> None:
    model = PPO.load(model_path)
    with TrainingStore(train_path) as train:
        evaluate_policy(train, "ppo", "drl", _ppo_act_factory(model), episodes, seed,
                        hyperparams={"model_path": model_path})
        evaluate_policy(train, "rule", "rule", rule_act_factory, episodes, seed)
        rows = train.run_summary()
        print(f"{'run':>4}  {'algo':<6} {'success':>8} {'reward':>8} {'steps':>7} "
              f"{'collisions':>11}")
        for r in rows:
            print(f"{r['run_id']:>4}  {r['algo']:<6} {r['success_rate']:>7.0%} "
                  f"{r['mean_reward']:>8.1f} {r['mean_steps']:>7.0f} "
                  f"{r['mean_collisions']:>11.2f}")


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__,
                                formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--model", required=True, help="path to a PPO .zip checkpoint")
    p.add_argument("--episodes", type=int, default=30)
    p.add_argument("--seed", type=int, default=10_000)
    p.add_argument("--train-db", default="training.db")
    a = p.parse_args()
    compare(a.model, a.episodes, a.seed, a.train_db)


if __name__ == "__main__":
    main()
