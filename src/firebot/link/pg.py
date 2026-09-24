"""PostgreSQL backend for the telemetry sink. Requires `pip install firebot[pc]` (psycopg 3)."""
from __future__ import annotations

import contextlib
from datetime import datetime, timezone
from pathlib import Path

from .protocol import THERM_COLS, THERM_ROWS  # noqa: F401
from .sink import FrameRow

MIGRATIONS = Path(__file__).resolve().parent.parent / "db" / "pg_migrations"


class PostgresBackend:
    def __init__(self, dsn: str, thermal_every: int = 10) -> None:
        import psycopg  # imported lazily so the Pi / CI never need it
        self._psycopg, self.dsn, self.thermal_every = psycopg, dsn, thermal_every
        self.conn = None
        self.reconnect()
        self._migrate()

    def reconnect(self) -> None:
        if self.conn is not None:
            with contextlib.suppress(Exception):
                self.conn.close()
        self.conn = self._psycopg.connect(self.dsn, autocommit=False, connect_timeout=5)

    def _migrate(self) -> None:
        with self.conn.transaction():
            self.conn.execute("CREATE TABLE IF NOT EXISTS schema_migrations ("
                              "version INTEGER PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL "
                              "DEFAULT now())")
            done = {r[0] for r in self.conn.execute("SELECT version FROM schema_migrations")}
            for f in sorted(MIGRATIONS.glob("*.sql")):
                v = int(f.name.split("_")[0])
                if v not in done:
                    self.conn.execute(f.read_text())
                    self.conn.execute("INSERT INTO schema_migrations(version) VALUES (%s)", (v,))
        self.conn.commit()

    def insert_session(self, sid, robot, notes, meta) -> None:
        from psycopg.types.json import Jsonb
        with self.conn.transaction():
            self.conn.execute("INSERT INTO sessions(id, robot, notes, meta) VALUES (%s,%s,%s,%s) "
                              "ON CONFLICT (id) DO NOTHING", (sid, robot, notes, Jsonb(meta)))

    def insert_frames(self, rows: list[FrameRow]) -> None:
        from psycopg.types.json import Jsonb
        data = []
        for r in rows:
            f = r.frame
            therm = ([v for row in f.thermal for v in row]
                     if self.thermal_every and f.seq % self.thermal_every == 0 else None)
            data.append((r.session, f.seq, f.t, datetime.fromtimestamp(r.recv_at, timezone.utc),
                         *f.pose, f.speed, f.tank, Jsonb(f.sensors), therm,
                         r.est.get("x"), r.est.get("y"), r.est.get("sigma"), r.mode,
                         r.cmd.v, r.cmd.w, r.cmd.pump, r.compute_ms))
        with self.conn.transaction(), self.conn.cursor() as cur:
            cur.executemany(
                "INSERT INTO frames(session_id, seq, t, recv_at, x, y, theta, speed, tank, sensors,"
                " thermal, est_x, est_y, est_sigma, mode, cmd_v, cmd_w, cmd_pump, compute_ms) "
                "VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s) "
                "ON CONFLICT (session_id, seq) DO NOTHING", data)

    def insert_operator(self, sid, text, intent, valid, message) -> None:
        from psycopg.types.json import Jsonb
        with self.conn.transaction():
            self.conn.execute("INSERT INTO operator_commands(session_id, text, intent, valid, "
                              "message) VALUES (%s,%s,%s,%s,%s)",
                              (sid, text, Jsonb(intent) if intent is not None else None, valid,
                               message))

    def update_session_end(self, sid) -> None:
        with self.conn.transaction():
            self.conn.execute("UPDATE sessions SET ended_at = now() WHERE id = %s", (sid,))

    def close(self) -> None:
        if self.conn is not None:
            self.conn.close()
