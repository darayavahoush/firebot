"""Training / dataset database: scenarios, runs, episodes, transitions, metrics, evals."""
from __future__ import annotations

import hashlib
import json
import sqlite3
import time
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import numpy as np

from .migrate import apply_migrations


def _blob(a: np.ndarray) -> bytes:
    return np.ascontiguousarray(a, dtype="<f4").tobytes()


class TrainingStore:
    def __init__(self, path: str | Path = "training.db") -> None:
        self.conn = sqlite3.connect(str(path))
        self.conn.row_factory = sqlite3.Row
        self.conn.execute("PRAGMA foreign_keys = ON")
        if str(path) != ":memory:":
            self.conn.execute("PRAGMA journal_mode = WAL")
        apply_migrations(self.conn, "training_migrations")

    def close(self) -> None:
        self.conn.close()

    def __enter__(self):
        return self

    def __exit__(self, *exc: object) -> None:
        self.close()

    def add_scenario(self, name: str, config: dict[str, Any], seed: int | None = None) -> int:
        """Deduplicated by hash of (config, seed), so identical scenarios are stored once."""
        blob = json.dumps({"c": config, "s": seed}, sort_keys=True)
        h = hashlib.sha256(blob.encode()).hexdigest()
        with self.conn:
            self.conn.execute(
                "INSERT OR IGNORE INTO scenarios(name, seed, config, config_hash, created_at)"
                " VALUES (?, ?, ?, ?, ?)",
                (name, seed, json.dumps(config, sort_keys=True), h, time.time()),
            )
        return int(self.conn.execute(
            "SELECT id FROM scenarios WHERE config_hash = ?", (h,)).fetchone()[0])

    def start_run(self, algo: str, hyperparams: dict[str, Any] | None = None,
                  git_commit: str | None = None, env_version: str | None = None,
                  notes: str | None = None) -> int:
        with self.conn:
            cur = self.conn.execute(
                "INSERT INTO runs(algo, hyperparams, git_commit, env_version, started_at, notes)"
                " VALUES (?, ?, ?, ?, ?, ?)",
                (algo, json.dumps(hyperparams) if hyperparams else None, git_commit,
                 env_version, time.time(), notes),
            )
        return int(cur.lastrowid)

    def finish_run(self, run_id: int, status: str = "done") -> None:
        with self.conn:
            self.conn.execute("UPDATE runs SET status = ?, ended_at = ? WHERE id = ?",
                              (status, time.time(), run_id))

    def log_metric(self, run_id: int, step: int, name: str, value: float) -> None:
        with self.conn:
            self.conn.execute("INSERT OR REPLACE INTO metrics(run_id, step, name, value)"
                              " VALUES (?, ?, ?, ?)", (run_id, step, name, value))

    def add_episode(self, run_id: int, obs: np.ndarray, actions: np.ndarray,
                    rewards: np.ndarray, terminated: np.ndarray, truncated: np.ndarray,
                    *, policy: str, success: bool, scenario_id: int | None = None,
                    split: str = "train", source: str = "sim",
                    source_session_id: int | None = None, collisions: int = 0,
                    water_used: float | None = None, time_to_extinguish: float | None = None,
                    final_obs: np.ndarray | None = None) -> int:
        """Store a whole episode atomically. obs/actions are (T, dim); the rest are (T,)."""
        obs, actions = np.atleast_2d(obs), np.atleast_2d(actions)
        T = len(rewards)
        if not (len(obs) == len(actions) == len(terminated) == len(truncated) == T):
            raise ValueError("episode arrays must share the same length")
        with self.conn:
            cur = self.conn.execute(
                "INSERT INTO episodes(run_id, scenario_id, policy, split, source,"
                " source_session_id, obs_dim, act_dim, n_steps, total_reward, success,"
                " collisions, water_used, time_to_extinguish, final_obs, created_at)"
                " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (run_id, scenario_id, policy, split, source, source_session_id, obs.shape[1],
                 actions.shape[1], T, float(np.sum(rewards)), int(success), collisions,
                 water_used, time_to_extinguish,
                 _blob(final_obs) if final_obs is not None else None, time.time()),
            )
            eid = int(cur.lastrowid)
            self.conn.executemany(
                "INSERT INTO transitions(episode_id, step, obs, action, reward, terminated,"
                " truncated) VALUES (?, ?, ?, ?, ?, ?, ?)",
                [(eid, t, _blob(obs[t]), _blob(actions[t]), float(rewards[t]),
                  int(terminated[t]), int(truncated[t])) for t in range(T)],
            )
        return eid

    def load_episode(self, episode_id: int) -> dict[str, np.ndarray]:
        rows = self.conn.execute(
            "SELECT obs, action, reward, terminated, truncated FROM transitions"
            " WHERE episode_id = ? ORDER BY step", (episode_id,)).fetchall()
        f = lambda k: np.stack([np.frombuffer(r[k], dtype="<f4") for r in rows])
        return {
            "obs": f("obs"), "actions": f("action"),
            "rewards": np.array([r["reward"] for r in rows], dtype=np.float32),
            "terminated": np.array([r["terminated"] for r in rows], dtype=bool),
            "truncated": np.array([r["truncated"] for r in rows], dtype=bool),
        }

    def iter_episodes(self, split: str = "train", policy: str | None = None,
                      success_only: bool = False) -> Iterator[dict[str, np.ndarray]]:
        q, args = "SELECT id FROM episodes WHERE split = ?", [split]
        if policy:
            q += " AND policy = ?"
            args.append(policy)
        if success_only:
            q += " AND success = 1"
        for (eid,) in self.conn.execute(q + " ORDER BY id", args).fetchall():
            yield self.load_episode(eid)

    def save_checkpoint(self, run_id: int, step: int, path: str,
                        metrics: dict[str, float] | None = None) -> int:
        with self.conn:
            cur = self.conn.execute(
                "INSERT INTO checkpoints(run_id, step, path, metrics, created_at)"
                " VALUES (?, ?, ?, ?, ?)",
                (run_id, step, path, json.dumps(metrics) if metrics else None, time.time()))
        return int(cur.lastrowid)

    def log_eval(self, run_id: int, metric: str, value: float,
                 checkpoint_id: int | None = None, scenario_id: int | None = None) -> None:
        with self.conn:
            self.conn.execute(
                "INSERT INTO eval_results(run_id, checkpoint_id, scenario_id, metric, value)"
                " VALUES (?, ?, ?, ?, ?)", (run_id, checkpoint_id, scenario_id, metric, value))

    def run_summary(self) -> list[sqlite3.Row]:
        return self.conn.execute("SELECT * FROM v_run_summary ORDER BY run_id").fetchall()
