"""MuJoCo tab backend: streams a simulated episode to the console over a WebSocket.

    GET /api/mujoco/status                       -> {"available": bool, "controllers": [...], "detail": str}
    WS  /ws/mujoco?seed=3&controller=frontier    -> {"type": "scene", ...} then {"type": "frame", ...}
                                                    per tick, then {"type": "end", ...}

Client -> server while running: {"paused": bool} and/or {"speed": 0.25..8}.
The physics runs in a worker thread so planning never blocks the event loop; the browser draws
everything (three.js), so the server needs mujoco but no display/GL.
"""
from __future__ import annotations

import asyncio
import contextlib
import json
import time
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

router = APIRouter()
CONTROLLERS = ("rule", "scan", "frontier", "mm_fusion")
ROBOT_NAME = "mujoco-sim"
FLUSH_EVERY = 10  # frames per DB batch (~1 s of sim time)

# server.py sets this to `lambda: _pool` so runs land in the same Postgres the History and
# Live tabs read. Left as None, logging is simply off.
get_pool = None


async def _db_start(pool, seed: int, controller: str) -> str:
    sid = uuid.uuid4()
    meta = {"source": "mujoco-console", "seed": seed, "controller": controller}
    async with pool.acquire() as conn:
        await conn.execute(
            "INSERT INTO sessions(id, robot, notes, meta) VALUES ($1,$2,$3,$4::jsonb)",
            sid, ROBOT_NAME, f"MuJoCo sim: {controller}, seed {seed}", json.dumps(meta))
    return str(sid)


async def _db_flush(pool, sid: str, rows: list[dict]) -> None:
    if not rows:
        return
    now = datetime.now(timezone.utc)
    data = [(uuid.UUID(sid), r["seq"], r["t"], now, r["x"], r["y"], r["theta"], 0.0, r["tank"],
             json.dumps(r["sensors"]), r["mode"], r["cmd_v"], r["cmd_w"], r["cmd_pump"])
            for r in rows]
    async with pool.acquire() as conn:
        await conn.executemany(
            "INSERT INTO frames(session_id, seq, t, recv_at, x, y, theta, speed, tank, sensors,"
            " mode, cmd_v, cmd_w, cmd_pump) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,$12,$13,$14)"
            " ON CONFLICT (session_id, seq) DO NOTHING", data)


async def _db_end(pool, sid: str, success: bool | None) -> None:
    async with pool.acquire() as conn:
        await conn.execute(
            "UPDATE sessions SET ended_at = now(), meta = meta || $2::jsonb WHERE id = $1",
            uuid.UUID(sid), json.dumps({"success": success}))


def _availability() -> tuple[bool, str]:
    import os
    os.environ.setdefault("MUJOCO_GL", "disabled")
    try:
        import mujoco  # noqa: F401
        return True, ""
    except ImportError:
        return False, "mujoco isn't installed in the backend's venv: pip install -e '.[mujoco]'"
    except Exception as e:
        return False, f"MuJoCo initialization error: {e}"


@router.get("/api/mujoco/status")
def mujoco_status() -> dict:
    try:
        ok, detail = _availability()
        return {"available": ok, "controllers": list(CONTROLLERS), "detail": detail}
    except Exception as e:
        return {"available": False, "controllers": list(CONTROLLERS), "detail": f"Status check failed: {e}"}


@router.get("/api/mujoco/test")
def mujoco_test(seed: int = 0, controller: str = "frontier") -> dict:
    import traceback
    try:
        from firebot.sim.stream import EpisodeStream
        s = EpisodeStream(seed=seed, controller=controller, world="mujoco")
        sc = s.scene()
        st = s.step()
        return {
            "ok": True,
            "seed": seed,
            "controller": controller,
            "width": sc.get("width"),
            "height": sc.get("height"),
            "dt": sc.get("dt"),
            "step_t": st.get("t"),
            "robot_x": st.get("x"),
            "robot_y": st.get("y"),
        }
    except Exception as e:
        return {
            "ok": False,
            "error": str(e),
            "traceback": traceback.format_exc(),
        }


@router.websocket("/ws/mujoco")
async def ws_mujoco(ws: WebSocket, seed: int = 0, controller: str = "frontier",
                    speed: float = 1.0, max_steps: int = 1500, log: int = 0) -> None:
    await ws.accept()
    ok, detail = _availability()
    if not ok or controller not in CONTROLLERS:
        await ws.send_json({"type": "error", "message": detail or f"unknown controller {controller!r}"})
        await ws.close()
        return
    from firebot.sim.stream import EpisodeStream

    state = {"paused": False, "speed": min(max(speed, 0.25), 8.0)}

    async def listen() -> None:
        try:
            while True:
                msg = await ws.receive_json()
                if "paused" in msg:
                    state["paused"] = bool(msg["paused"])
                if "speed" in msg:
                    state["speed"] = min(max(float(msg["speed"]), 0.25), 8.0)
        except (WebSocketDisconnect, RuntimeError, ValueError):
            state["gone"] = True

    listener = asyncio.create_task(listen())
    stream = None
    pool = get_pool() if (log and get_pool) else None
    sid, buf, success = None, [], None
    try:
        # Keepalive while compiling scene so cloud proxies (Cloudflare, Render) don't drop silent WebSockets
        await ws.send_json({"type": "status", "message": "Compiling simulation world..."})
        init_task = asyncio.create_task(
            asyncio.to_thread(EpisodeStream, seed, controller, "mujoco", min(max_steps, 5000))
        )
        while not init_task.done():
            done, _ = await asyncio.wait([init_task], timeout=1.5)
            if not done:
                with contextlib.suppress(Exception):
                    await ws.send_json({"type": "ping"})
        stream = await init_task

        if pool is not None:
            try:
                sid = await _db_start(pool, seed, controller)
            except Exception as e:  # noqa: BLE001 -- DB down: keep playing, just do not log
                pool = None
                await ws.send_json({"type": "warn", "message": f"Not logging this run: {e}"})
        await ws.send_json({"type": "scene", "session_id": sid, **stream.scene()})
        dt = stream.scene().get("dt", 0.1)
        while not state.get("gone"):
            if state["paused"]:
                await asyncio.sleep(0.05)
                continue
            t0 = time.monotonic()
            frame = await asyncio.to_thread(stream.step)
            await ws.send_json({"type": "frame", **frame})
            if sid is not None:
                buf.append(stream.last_db)
                if len(buf) >= FLUSH_EVERY or frame["done"]:
                    with contextlib.suppress(Exception):
                        await _db_flush(pool, sid, buf)
                    buf = []
            if frame["done"]:
                success = frame["success"]
                await ws.send_json({"type": "end", "success": frame["success"], "t": frame["t"],
                                    "collisions": frame["collisions"]})
                break
            # Pace the stream according to dt and speed multiplier so we don't saturate the socket
            elapsed = time.monotonic() - t0
            target_dt = dt / max(state.get("speed", 1.0), 0.25)
            delay = max(0.005, target_dt - elapsed)
            await asyncio.sleep(delay)
    except WebSocketDisconnect:
        pass
    except Exception as e:
        import logging
        logging.getLogger("firebot.mujoco").exception("MuJoCo simulation stream failed: %s", e)
        with contextlib.suppress(Exception):
            await ws.send_json({"type": "error", "message": f"Simulation failed: {e}"})
            await asyncio.sleep(0.5)
    finally:
        if sid is not None:  # also runs on disconnect, so an abandoned run never stays "live"
            with contextlib.suppress(Exception):
                await _db_flush(pool, sid, buf)
                await _db_end(pool, sid, success)
        listener.cancel()
        with contextlib.suppress(asyncio.CancelledError, Exception):
            await listener
        if stream is not None:
            await asyncio.to_thread(stream.close)
        with contextlib.suppress(Exception):
            await ws.close()
