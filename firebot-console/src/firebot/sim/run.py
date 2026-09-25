"""Run baseline episodes in the simulator and record them to both databases.

    firebot-sim --episodes 20 --seed 0 --ops-db firebot.db --train-db training.db
"""
from __future__ import annotations

import argparse
import subprocess
import time

import numpy as np

from firebot.db.store import Store
from firebot.db.training import TrainingStore

from .controller import RuleController
from .env import DT, FireEnv

SCALARS = ("us_front_left", "us_front_right", "us_left", "us_right", "flame_left",
           "flame_center", "flame_right", "mq2_front", "mq2_rear")


def _git_commit() -> str | None:
    try:
        return subprocess.check_output(["git", "rev-parse", "--short", "HEAD"],
                                       stderr=subprocess.DEVNULL, text=True).strip()
    except (OSError, subprocess.CalledProcessError):
        return None


def run_episode(env: FireEnv, ctrl: RuleController, ops: Store, seed: int) -> dict:
    """Play one episode, logging telemetry/events to `ops`. Returns arrays and stats."""
    obs, _ = env.reset(seed=seed)
    sid = ops.start_session("sim", f"rule baseline, seed {seed}")
    base = time.time()
    O, A, R, TE, TR = [], [], [], [], []
    readings: list[tuple[float, str, float]] = []
    seen_states = {"EXPLORE"}
    localised = False
    info: dict = {}
    while True:
        a = ctrl.act(obs, DT)
        ts = base + env.t * DT
        O.append(obs)
        A.append(a)
        obs, r, te, tr, info = env.step(a)
        R.append(r)
        TE.append(te)
        TR.append(tr)
        est, conf = info["est"], float(np.clip(1 - info["est"]["sigma"] / 4, 0, 1))
        if ctrl.state not in seen_states:
            seen_states.add(ctrl.state)
            kind = {"TRACK": "detected", "SPRAY": "suppressing"}.get(ctrl.state)
            if kind:
                ops.log_fire_event(sid, kind, est["x"], est["y"], conf, ts=ts)
        if not localised and est["sigma"] < .5:
            localised = True
            ops.log_fire_event(sid, "localised", est["x"], est["y"], conf, ts=ts)
        if env.t % 5 == 0:
            readings += [(ts, n, env.last[n]) for n in SCALARS]
            x, y, th = env.robot
            ops.log_pose(sid, float(x), float(y), float(th), "sim_truth", ts=ts)
        if env.t % 20 == 0:
            ops.log_thermal_frame(sid, env.last["thermal"], ts=ts)
        if te or tr:
            break
    ts = base + env.t * DT
    if te:
        ops.log_fire_event(sid, "extinguished", est["x"], est["y"], 1.0, 0.0, ts=ts)
    ops.log_readings(sid, readings)
    ops.end_session(sid)
    return dict(session_id=sid, obs=np.array(O), actions=np.array(A), rewards=np.array(R),
                terminated=np.array(TE), truncated=np.array(TR), final_obs=obs,
                success=bool(te), collisions=info["collisions"], water_used=info["water_used"],
                time_to_extinguish=env.t * DT if te else None)


def run_baseline(episodes: int, seed: int, ops_path: str, train_path: str) -> list[dict]:
    env = FireEnv()
    results = []
    with Store(ops_path) as ops, TrainingStore(train_path) as train:
        ops.seed_default_devices()
        run = train.start_run("rule", {"controller": "RuleController"},
                              git_commit=_git_commit(), env_version="sim-0.1")
        for i in range(episodes):
            s = seed + i
            ep = run_episode(env, RuleController(), ops, s)
            scen = train.add_scenario("default-room", env.config(), seed=s)
            split = "val" if i % 10 == 8 else "test" if i % 10 == 9 else "train"
            train.add_episode(
                run, ep["obs"], ep["actions"], ep["rewards"], ep["terminated"], ep["truncated"],
                policy="rule", success=ep["success"], scenario_id=scen, split=split,
                source_session_id=ep["session_id"], collisions=ep["collisions"],
                water_used=ep["water_used"], time_to_extinguish=ep["time_to_extinguish"],
                final_obs=ep["final_obs"])
            results.append(ep)
        train.finish_run(run)
    return results


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--episodes", type=int, default=20)
    p.add_argument("--seed", type=int, default=0)
    p.add_argument("--ops-db", default="firebot.db")
    p.add_argument("--train-db", default="training.db")
    a = p.parse_args()
    res = run_baseline(a.episodes, a.seed, a.ops_db, a.train_db)
    ok = [r for r in res if r["success"]]
    t = [r["time_to_extinguish"] for r in ok]
    print(f"{len(ok)}/{len(res)} extinguished"
          + (f", mean time {np.mean(t):.1f}s" if t else "")
          + f", mean collisions {np.mean([r['collisions'] for r in res]):.1f}")


if __name__ == "__main__":
    main()
