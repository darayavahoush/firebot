"""SQLite persistence for sessions, fire events, sensor readings and actions."""
from __future__ import annotations

import json
import sqlite3
import time
from collections.abc import Iterable
from importlib import resources
from pathlib import Path
from typing import Any

SCHEMA_VERSION = 1
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
        version = self.conn.execute("PRAGMA user_version").fetchone()[0]
        if version < 1:
            sql = resources.files("firebot.db").joinpath("schema.sql").read_text()
            with self.conn:
                self.conn.executescript(sql)
                self.conn.execute(f"PRAGMA user_version = {SCHEMA_VERSION}")

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
        with self.conn:
            self.conn.executemany(
                "INSERT INTO sensor_readings(session_id, ts, sensor, value) VALUES (?, ?, ?, ?)",
                [(session_id, ts, s, v) for ts, s, v in readings],
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
