"""
firebot.api.server — thin bridge between the React console and the
Postgres logging sink (historical runs) and live telemetry.

Rewritten against the real schema (see src/firebot/db/pg_migrations/001_init.sql):
  sessions(id, robot, started_at, ended_at, notes, meta)
  frames(session_id, seq, t, recv_at, x, y, theta, speed, tank, sensors,
         thermal, est_x, est_y, est_sigma, mode, cmd_v, cmd_w, cmd_pump, compute_ms)
  operator_commands(id, session_id, at, text, intent, valid, message)

Note: `frames.thermal` is stored FLATTENED (768-element row-major array) by
PostgresBackend.insert_frames — it is only present on every Nth frame
(thermal_every). We reshape it back to THERM_ROWS x THERM_COLS here before
sending to the frontend.

`/api/command` and `/api/command/estop` remain stubs: the brain has no HTTP
command entrypoint yet, so manual control from the UI won't reach the robot
until that's added separately.

Run with: uvicorn server:app --reload --port 8000
"""

import asyncio
import json
from datetime import datetime, timezone
from typing import Any

import asyncpg
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from firebot.link.protocol import THERM_COLS, THERM_ROWS

DATABASE_URL = "postgresql://firebot:firebot@localhost:5432/firebot"

app = FastAPI(title="firebot-api")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)

_pool: asyncpg.Pool | None = None


@app.on_event("startup")
async def startup() -> None:
    global _pool
    _pool = await asyncpg.create_pool(DATABASE_URL, min_size=1, max_size=5)


@app.on_event("shutdown")
async def shutdown() -> None:
    if _pool is not None:
        await _pool.close()


def _reshape_thermal(flat: list[float] | None) -> list[list[float]] | None:
    """Undo PostgresBackend's row-major flatten back into THERM_ROWS x THERM_COLS."""
    if flat is None:
        return None
    return [flat[i * THERM_COLS:(i + 1) * THERM_COLS] for i in range(THERM_ROWS)]


# ---- REST: historical runs, read from the Postgres sink ----

@app.get("/api/runs")
async def list_runs() -> list[dict[str, Any]]:
    query = """
        SELECT s.id, s.robot, s.started_at, s.ended_at, s.notes,
               count(f.seq)                         AS frames,
               max(f.t)                             AS duration_s,
               min(f.tank)                           AS min_tank,
               coalesce(bool_or(f.cmd_pump), false)  AS pumped,
               (SELECT count(*) FROM operator_commands c
                WHERE c.session_id = s.id)           AS operator_commands
        FROM sessions s
        LEFT JOIN frames f ON f.session_id = s.id
        GROUP BY s.id
        ORDER BY s.started_at DESC
        LIMIT 100
    """
    async with _pool.acquire() as conn:
        rows = await conn.fetch(query)
    return [dict(r) for r in rows]


@app.get("/api/runs/{run_id}")
async def run_detail(run_id: str) -> dict[str, Any]:
    query = """
        SELECT seq, t, x, y, theta, speed, tank, sensors, thermal,
               est_x, est_y, est_sigma, mode, cmd_v, cmd_w, cmd_pump, compute_ms
        FROM frames
        WHERE session_id = $1
        ORDER BY seq ASC
    """
    async with _pool.acquire() as conn:
        rows = await conn.fetch(query, run_id)

    points = []
    for r in rows:
        d = dict(r)
        sensors = d.pop("sensors")
        d["sensors"] = json.loads(sensors) if isinstance(sensors, str) else sensors
        d["thermal"] = _reshape_thermal(d["thermal"])
        points.append(d)

    return {"id": run_id, "points": points}


# ---- REST: command forwarding to the brain ----

class Command(BaseModel):
    type: str
    dir: str | None = None
    speed: int | None = None
    on: bool | None = None
    angle: int | None = None
    mode: str | None = None


@app.post("/api/command")
async def post_command(cmd: Command) -> dict[str, Any]:
    # TODO: forward to the brain's actual command entrypoint
    # (e.g. brain.executor.submit(cmd) or a queue the link server reads).
    print(f"[command] {cmd.model_dump()}")
    return {"ok": True}


@app.post("/api/command/estop")
async def post_estop() -> dict[str, Any]:
    # TODO: forward an immediate stop to the brain.
    print("[command] ESTOP")
    return {"ok": True}


# ---- WebSocket: live telemetry, polling the active session's latest frame ----

@app.websocket("/ws/telemetry")
async def ws_telemetry(ws: WebSocket) -> None:
    await ws.accept()
    last_seq: int | None = None
    try:
        while True:
            async with _pool.acquire() as conn:
                session = await conn.fetchrow(
                    "SELECT id FROM sessions WHERE ended_at IS NULL "
                    "ORDER BY started_at DESC LIMIT 1"
                )
                if session is None:
                    await asyncio.sleep(0.4)
                    continue

                row = await conn.fetchrow(
                    "SELECT seq, t, x, y, theta, speed, tank, sensors, thermal, "
                    "est_x, est_y, est_sigma, mode, cmd_v, cmd_w, cmd_pump, compute_ms "
                    "FROM frames WHERE session_id = $1 "
                    "ORDER BY seq DESC LIMIT 1",
                    session["id"],
                )

            if row is not None and row["seq"] != last_seq:
                last_seq = row["seq"]
                d = dict(row)
                sensors = d.pop("sensors")
                d["sensors"] = json.loads(sensors) if isinstance(sensors, str) else sensors
                d["thermal"] = _reshape_thermal(d["thermal"])
                d["session_id"] = str(session["id"])
                await ws.send_text(json.dumps(d, default=str))

            await asyncio.sleep(0.4)
    except WebSocketDisconnect:
        pass
