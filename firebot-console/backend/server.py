"""
firebot.api.server — thin bridge between the React console and:
  - the Postgres logging sink (historical runs)
  - the brain's live telemetry + command channel (WebSocket)

This is scaffolding: the queries below assume plausible table/column
names (`runs`, `frames`, `commands`) that need to match your actual
schema from the logging sink you built earlier. Adjust the SQL and the
telemetry bridge to your real brain API before running it for real.

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


# ---- REST: historical runs, read from the Postgres sink ----

@app.get("/api/runs")
async def list_runs() -> list[dict[str, Any]]:
    # TODO: match to the actual `runs` table your sink writes.
    query = """
        SELECT id, started_at, duration_s, mode, extinguished,
               max_temp_c, commands
        FROM runs
        ORDER BY started_at DESC
        LIMIT 100
    """
    async with _pool.acquire() as conn:
        rows = await conn.fetch(query)
    return [dict(r) for r in rows]


@app.get("/api/runs/{run_id}")
async def run_detail(run_id: str) -> dict[str, Any]:
    # TODO: match to the actual `frames` table your sink writes.
    query = """
        SELECT t, temp_c, battery_v
        FROM frames
        WHERE run_id = $1
        ORDER BY t ASC
    """
    async with _pool.acquire() as conn:
        rows = await conn.fetch(query, run_id)
    return {"id": run_id, "points": [dict(r) for r in rows]}


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
    # TODO: call the same fast-path STOP the voice backstop uses.
    print("[estop] triggered from console")
    return {"ok": True}


# ---- WebSocket: live telemetry, bridged from the brain's frame stream ----

@app.websocket("/ws/telemetry")
async def telemetry_ws(websocket: WebSocket) -> None:
    await websocket.accept()
    try:
        while True:
            # TODO: replace with a subscription to the brain's real frame
            # stream (e.g. an asyncio.Queue fed by the link server) instead
            # of this placeholder heartbeat.
            frame = {
                "t": int(datetime.now(timezone.utc).timestamp()),
                "mode": "auto",
                "battery_v": 12.4,
                "temp_c": 26.5,
                "gas_ppm": 6.0,
                "pos": {"x": 0.0, "y": 0.0},
                "link_ok": True,
                "last_ack_ms": 30,
            }
            await websocket.send_text(json.dumps(frame))
            await asyncio.sleep(0.8)
    except WebSocketDisconnect:
        pass
