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
import time

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

router = APIRouter()
CONTROLLERS = ("rule", "scan", "frontier")


def _availability() -> tuple[bool, str]:
    try:
        import mujoco  # noqa: F401
    except ImportError:
        return False, "mujoco isn't installed in the backend's venv: pip install -e '.[mujoco]'"
    return True, ""


@router.get("/api/mujoco/status")
def mujoco_status() -> dict:
    ok, detail = _availability()
    return {"available": ok, "controllers": list(CONTROLLERS), "detail": detail}


@router.websocket("/ws/mujoco")
async def ws_mujoco(ws: WebSocket, seed: int = 0, controller: str = "frontier",
                    speed: float = 1.0, max_steps: int = 1500) -> None:
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
    try:
        stream = await asyncio.to_thread(EpisodeStream, seed, controller, "mujoco",
                                         min(max_steps, 5000))
        await ws.send_json({"type": "scene", **stream.scene()})
        dt = stream.scene()["dt"]
        while not state.get("gone"):
            if state["paused"]:
                await asyncio.sleep(0.05)
                continue
            t0 = time.monotonic()
            frame = await asyncio.to_thread(stream.step)
            await ws.send_json({"type": "frame", **frame})
            if frame["done"]:
                await ws.send_json({"type": "end", "success": frame["success"], "t": frame["t"],
                                    "collisions": frame["collisions"]})
                break
            await asyncio.sleep(max(0.0, dt / state["speed"] - (time.monotonic() - t0)))
    except WebSocketDisconnect:
        pass
    finally:
        listener.cancel()
        with contextlib.suppress(asyncio.CancelledError, Exception):
            await listener
        if stream is not None:
            await asyncio.to_thread(stream.close)
        with contextlib.suppress(Exception):
            await ws.close()
