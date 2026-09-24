"""SQLite persistence for sessions, fire events, sensor readings and actions."""
from __future__ import annotations

import json
import sqlite3
import time
from collections.abc import Iterable
from pathlib import Path
from typing import Any

import numpy as np

from .devices import DEFAULT_DEVICES
from .migrate import apply_migrations

SCHEMA_VERSION = 2
FIRE_KINDS = ("detected", "localised", "suppressing", "extinguished", "lost")


class Store:
    """Thin, dependency-free data layer. Use `Store(":memory:")` in tests."""

    def __init__(self, path: str | Path = "firebot.db") -> None:
        self.conn = sqlite3.connect(str(path))
        self.conn.row_factory = sqlite3.Row
        self.conn.execute("PRAGMA foreign_keys = ON")
        if str(path) != ":memory:":
            self.conn.execute("PRAGMA journal_mode = WAL")
        self._migrate()

    def _migrate(self) -> None:
        apply_migrations(self.conn, "migrations")

    def close(self) -> None:
        self.conn.close()

    def __enter__(self):
        return self

    def __exit__(self, *exc: object) -> None:
        self.close()

    # sessions
    def start_session(self, mode: str = "sim", notes: str | None = None) -> int:
        with self.conn:
            cur = self.conn.execute(
                "INSERT INTO sessions(started_at, mode, notes) VALUES (?, ?, ?)",
                (time.time(), mode, notes),
            )
        return int(cur.lastrowid)

    def end_session(self, session_id: int) -> None:
        with self.conn:
            self.conn.execute(
                "UPDATE sessions SET ended_at = ? WHERE id = ?", (time.time(), session_id)
            )

    # writes
    def log_fire_event(
        self,
        session_id: int,
        kind: str,
        x: float | None = None,
        y: float | None = None,
        confidence: float | None = None,
        intensity: float | None = None,
        meta: dict[str, Any] | None = None,
        ts: float | None = None,
    ) -> int:
        with self.conn:
            cur = self.conn.execute(
                "INSERT INTO fire_events(session_id, ts, kind, x, y, confidence, intensity, meta)"
                " VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                (session_id, ts if ts is not None else time.time(), kind, x, y, confidence,
                 intensity, json.dumps(meta) if meta else None),
            )
        return int(cur.lastrowid)

    def log_readings(
        self, session_id: int, readings: Iterable[tuple[float, str, float]]
    ) -> None:
        """Batch insert (ts, sensor, value) tuples in one transaction."""
        ids = self.device_ids()
        with self.conn:
            self.conn.executemany(
                "INSERT INTO sensor_readings(session_id, ts, sensor, value, device_id)"
                " VALUES (?, ?, ?, ?, ?)",
                [(session_id, ts, s, v, ids.get(s)) for ts, s, v in readings],
            )

    def log_action(
        self,
        session_id: int,
        command: str,
        params: dict[str, Any] | None = None,
        outcome: str | None = None,
        ts: float | None = None,
    ) -> int:
        with self.conn:
            cur = self.conn.execute(
                "INSERT INTO actions(session_id, ts, command, params, outcome)"
                " VALUES (?, ?, ?, ?, ?)",
                (session_id, ts if ts is not None else time.time(), command,
                 json.dumps(params) if params else None, outcome),
            )
        return int(cur.lastrowid)

    # reads
    def fire_events(self, session_id: int) -> list[sqlite3.Row]:
        return self.conn.execute(
            "SELECT * FROM fire_events WHERE session_id = ? ORDER BY ts, id", (session_id,)
        ).fetchall()

    def recent_fire_events(self, limit: int = 20) -> list[sqlite3.Row]:
        return self.conn.execute(
            "SELECT * FROM fire_events ORDER BY ts DESC, id DESC LIMIT ?", (limit,)
        ).fetchall()

    def readings(self, session_id: int, sensor: str) -> list[sqlite3.Row]:
        return self.conn.execute(
            "SELECT ts, value FROM sensor_readings WHERE session_id = ? AND sensor = ? ORDER BY ts",
            (session_id, sensor),
        ).fetchall()

    # equipment
    def register_device(self, name: str, **fields: Any) -> int:
        """Insert or update a device by unique name. Returns its id."""
        fields.setdefault("kind", "sensor")
        cols = ["name", *fields]
        updates = ", ".join(f"{c}=excluded.{c}" for c in fields)
        with self.conn:
            self.conn.execute(
                f"INSERT INTO devices({', '.join(cols)}) VALUES ({', '.join('?' * len(cols))})"
                f" ON CONFLICT(name) DO UPDATE SET {updates}",
                [name, *fields.values()],
            )
        return self.device_ids()[name]

    def seed_default_devices(self) -> None:
        for d in DEFAULT_DEVICES:
            self.register_device(**d)

    def device_ids(self) -> dict[str, int]:
        return {r["name"]: r["id"] for r in self.conn.execute("SELECT id, name FROM devices")}

    # telemetry
    def log_pose(self, session_id: int, x: float, y: float, theta: float, source: str = "fused",
                 v: float | None = None, w: float | None = None, ts: float | None = None) -> None:
        with self.conn:
            self.conn.execute(
                "INSERT INTO robot_poses(session_id, ts, x, y, theta, v, w, source)"
                " VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                (session_id, ts if ts is not None else time.time(), x, y, theta, v, w, source),
            )

    def log_power(self, session_id: int, rail: str, voltage: float | None = None,
                  current: float | None = None, ts: float | None = None) -> None:
        with self.conn:
            self.conn.execute(
                "INSERT INTO power_samples(session_id, ts, rail, voltage, current)"
                " VALUES (?, ?, ?, ?, ?)",
                (session_id, ts if ts is not None else time.time(), rail, voltage, current),
            )

    def set_actuator(self, session_id: int, device: str, value: float,
                     ts: float | None = None) -> None:
        with self.conn:
            self.conn.execute(
                "INSERT INTO actuator_states(session_id, device_id, ts, value)"
                " VALUES (?, ?, ?, ?)",
                (session_id, self.device_ids()[device], ts if ts is not None else time.time(),
                 value),
            )

    def log_thermal_frame(self, session_id: int, frame: np.ndarray, device: str = "thermal_cam",
                          ts: float | None = None) -> int:
        f = np.ascontiguousarray(frame, dtype="<f4")
        r, c = f.shape
        hot = int(np.argmax(f))
        with self.conn:
            cur = self.conn.execute(
                "INSERT INTO thermal_frames(session_id, device_id, ts, rows, cols, min_c, max_c,"
                " hot_row, hot_col, data) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (session_id, self.device_ids().get(device),
                 ts if ts is not None else time.time(), r, c, float(f.min()), float(f.max()),
                 hot // c, hot % c, f.tobytes()),
            )
        return int(cur.lastrowid)

    def thermal_frame(self, frame_id: int) -> np.ndarray:
        row = self.conn.execute(
            "SELECT rows, cols, data FROM thermal_frames WHERE id = ?", (frame_id,)
        ).fetchone()
        return np.frombuffer(row["data"], dtype="<f4").reshape(row["rows"], row["cols"])

    def log_voice_command(self, session_id: int, transcript: str,
                          intent: dict[str, Any] | None = None, validated: bool = False,
                          action_id: int | None = None, ts: float | None = None) -> int:
        with self.conn:
            cur = self.conn.execute(
                "INSERT INTO voice_commands(session_id, ts, transcript, intent, validated,"
                " action_id) VALUES (?, ?, ?, ?, ?, ?)",
                (session_id, ts if ts is not None else time.time(), transcript,
                 json.dumps(intent) if intent else None, int(validated), action_id),
            )
        return int(cur.lastrowid)

    def incidents(self) -> list[sqlite3.Row]:
        return self.conn.execute("SELECT * FROM v_incidents ORDER BY detected_ts").fetchall()
