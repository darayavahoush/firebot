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

`/api/command` forwards drive, pump and nozzle commands and `/api/command/estop` forwards
ESTOP to the brain process's loopback HTTP bridge (see `firebot.link.cmdhttp`; started by
`firebot-brain` alongside the main Pi link). The UI sends drive/pump/nozzle as separate
discrete events; this module merges them into the one atomic (v, w, pump, nozzle) sample
`/manual` expects (see `_manual_state`). Nozzle angle is forwarded and reported by the
brain but has no backing actuator in the physics model or wire protocol -- it does not
affect the simulated spray.

Run with: uvicorn server:app --reload --port 8000
"""

import asyncio
import json
import os
from datetime import datetime, timezone
from typing import Any

import asyncpg
import httpx
from fastapi import FastAPI, File, HTTPException, UploadFile, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from firebot.link.protocol import THERM_COLS, THERM_ROWS
from firebot.voice_intent.router import ShadowRouter
from firebot.voice_intent.vocab import canonical_phrase

DATABASE_URL = "postgresql://firebot:firebot@localhost:5432/firebot"

# The brain process's manual-control HTTP bridge (firebot.link.cmdhttp), not the
# operator<->Pi link -- loopback only by design, so this only works when the console
# backend runs on the same host as `firebot-brain`.
BRAIN_CMD_URL = os.environ.get("FIREBOT_BRAIN_CMD_URL", "http://127.0.0.1:8766")
BRAIN_TOKEN = os.environ.get("FIREBOT_TOKEN", "")
MAX_TURN_RATE = 1.0  # matches wire protocol's w range; ControlPanel speed is 0-100%

# Voice-command fallback for browsers with no (or broken -- looking at you, Opera/Brave)
# built-in speech recognition: the frontend records a clip and posts it here; we forward it
# to Groq's hosted Whisper (OpenAI-compatible endpoint, generous free tier) and hand back
# plain text. Nothing is stored -- this is stateless request forwarding, same trust boundary
# as /api/command's bridge to the brain.
GROQ_API_KEY = os.environ.get("GROQ_API_KEY", "")
GROQ_TRANSCRIBE_URL = "https://api.groq.com/openai/v1/audio/transcriptions"

# Optional local first-pass: a trained firebot.voice_intent checkpoint, tried before Groq
# (see firebot.voice_intent.README -- "not wired in yet"). Entirely opt-in: torch/librosa
# and the checkpoint itself are only loaded lazily, on first use, and only if this is set,
# so a console deployed without the voice_intent extras installed is completely unaffected.
VOICE_INTENT_CHECKPOINT = os.environ.get("FIREBOT_VOICE_INTENT_CHECKPOINT", "")
VOICE_INTENT_MIN_CONFIDENCE = float(os.environ.get("FIREBOT_VOICE_INTENT_MIN_CONFIDENCE", "0.6"))
# Where the ShadowRouter persists its learned per-confidence-decile trust state between
# server restarts. A missing/corrupt file just starts fresh (see ShadowRouter.load).
VOICE_INTENT_ROUTER_STATE = os.environ.get("FIREBOT_VOICE_INTENT_ROUTER_STATE",
                                          "voice_intent_router.json")

app = FastAPI(title="firebot-api")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)

_pool: asyncpg.Pool | None = None

# Lazily constructed on first /api/transcribe call that has VOICE_INTENT_CHECKPOINT set --
# loading torch/transformers/the checkpoint at import time would slow down (or break) every
# console deployment that doesn't use this feature at all.
_voice_classifier: Any = None
_voice_router: ShadowRouter | None = None


def _get_voice_classifier() -> Any:
    global _voice_classifier
    if _voice_classifier is None:
        from firebot.voice_intent.infer import IntentClassifier
        _voice_classifier = IntentClassifier(VOICE_INTENT_CHECKPOINT)
    return _voice_classifier


def _get_voice_router() -> ShadowRouter:
    global _voice_router
    if _voice_router is None:
        _voice_router = ShadowRouter.load(VOICE_INTENT_ROUTER_STATE)
    return _voice_router


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


async def _post_bridge(path: str, payload: dict) -> dict[str, Any]:
    headers = {"Authorization": f"Bearer {BRAIN_TOKEN}"}
    try:
        async with httpx.AsyncClient(timeout=2.0) as client:
            r = await client.post(f"{BRAIN_CMD_URL}{path}", json=payload, headers=headers)
    except httpx.RequestError as e:
        raise HTTPException(502, f"brain command bridge unreachable: {e}") from e
    if r.status_code == 401:
        raise HTTPException(502, "brain command bridge rejected our token (FIREBOT_TOKEN mismatch)")
    if r.status_code == 409:
        raise HTTPException(409, "no robot currently connected to the brain")
    if r.status_code != 200:
        raise HTTPException(502, f"brain command bridge error: {r.status_code} {r.text}")
    return r.json()


# dir -> (v, w) at full stick deflection; scaled by cmd.speed (0-100%).
_DRIVE_VECTORS = {
    "fwd": (1.0, 0.0), "left": (0.0, -MAX_TURN_RATE), "right": (0.0, MAX_TURN_RATE),
    "stop": (0.0, 0.0),
}

# The console sends drive/pump/nozzle as separate discrete UI events (button press, toggle,
# slider), but /manual on the brain side wants one atomic (v, w, pump, nozzle) sample. Track
# the last commanded value of each here and always send the merged state. Single console
# process, single operator at a time -- module-level state is fine.
_manual_state = {"v": 0.0, "w": 0.0, "pump": False, "nozzle": 0.0}


@app.post("/api/command")
async def post_command(cmd: Command) -> dict[str, Any]:
    if cmd.type == "DRIVE":
        if cmd.dir == "back":
            # No reverse gear: the wire protocol's cmd.v is clamped to [0, 1]. Fail loudly
            # rather than silently drive forward or do nothing.
            raise HTTPException(501, "reverse drive isn't supported by this robot")
        vec = _DRIVE_VECTORS.get(cmd.dir)
        if vec is None:
            raise HTTPException(400, f"unknown drive direction {cmd.dir!r}")
        scale = max(0.0, min(1.0, (cmd.speed or 0) / 100))
        _manual_state["v"], _manual_state["w"] = vec[0] * scale, vec[1] * scale
        return await _post_bridge("/manual", dict(_manual_state))
    if cmd.type == "PUMP":
        _manual_state["pump"] = bool(cmd.on)
        return await _post_bridge("/manual", dict(_manual_state))
    if cmd.type == "NOZZLE":
        _manual_state["nozzle"] = max(-45.0, min(45.0, float(cmd.angle or 0)))
        return await _post_bridge("/manual", dict(_manual_state))
    if cmd.type == "SET_MODE":
        # UI-local: gates whether ControlPanel is enabled. Nothing to forward -- the robot
        # only actually enters MANUAL mode once a DRIVE/PUMP/NOZZLE command reaches the
        # brain, and switching back to "auto" here does not itself resume EXTINGUISH.
        return {"ok": True}
    raise HTTPException(400, f"unknown command type {cmd.type!r}")


@app.post("/api/command/estop")
async def post_estop() -> dict[str, Any]:
    return await _post_bridge("/estop", {})


# ---- REST: voice transcription fallback (Groq-hosted Whisper) ----

async def _call_groq(audio_bytes: bytes, filename: str, content_type: str) -> str:
    if not GROQ_API_KEY:
        raise HTTPException(503, "GROQ_API_KEY isn't set on the server -- voice fallback is unavailable")
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            r = await client.post(
                GROQ_TRANSCRIBE_URL,
                headers={"Authorization": f"Bearer {GROQ_API_KEY}"},
                files={"file": (filename, audio_bytes, content_type)},
                data={"model": "whisper-large-v3-turbo", "temperature": "0", "response_format": "json"},
            )
    except httpx.RequestError as e:
        raise HTTPException(502, f"couldn't reach Groq: {e}") from e
    if r.status_code != 200:
        raise HTTPException(502, f"Groq transcription failed ({r.status_code}): {r.text}")
    return (r.json().get("text") or "").strip()


def _local_intent_phrase(audio_bytes: bytes) -> tuple[str, float] | None:
    """Try the local classifier on a raw uploaded clip. Returns (canonical_phrase,
    confidence) on a usable prediction, or None -- for *any* reason the local path isn't
    available (no checkpoint configured, decode failure, missing optional deps, low
    confidence, UNKNOWN) -- so callers always have a clean Groq fallback to drop into.
    This opt-in feature is never allowed to turn into a 500 for a console that otherwise
    only relies on Groq.
    """
    if not VOICE_INTENT_CHECKPOINT:
        return None
    try:
        import io

        import librosa

        audio, _ = librosa.load(io.BytesIO(audio_bytes), sr=16_000, mono=True)
        clf = _get_voice_classifier()
        payload = clf.predict_intent_payload_array(audio, sample_rate=16_000,
                                                    min_confidence=VOICE_INTENT_MIN_CONFIDENCE)
        if payload["name"] == "UNKNOWN":
            return None
        return canonical_phrase(payload["raw_label"]), payload["confidence"]
    except Exception:
        # Missing librosa/torch, a corrupt checkpoint, an undecodable clip, etc. -- the
        # local first-pass is a pure optimization, never the only path.
        return None


@app.post("/api/transcribe")
async def transcribe(file: UploadFile = File(...)) -> dict[str, str]:
    audio_bytes = await file.read()
    filename = file.filename or "clip.webm"
    content_type = file.content_type or "audio/webm"

    local = _local_intent_phrase(audio_bytes)
    if local is None:
        return {"text": await _call_groq(audio_bytes, filename, content_type)}

    phrase, confidence = local
    router = _get_voice_router()
    if router.should_trust(confidence) and not router.should_audit():
        return {"text": phrase}

    # Either not (yet) trusted for this confidence decile, or a background audit of an
    # otherwise-trusted one -- either way, ground truth from Groq updates the router.
    if not GROQ_API_KEY:
        # Can't audit without Groq; the local prediction is all we have.
        return {"text": phrase}
    groq_text = await _call_groq(audio_bytes, filename, content_type)
    router.update(confidence, agreed=(phrase == groq_text))
    router.save(VOICE_INTENT_ROUTER_STATE)
    return {"text": groq_text}


# ---- WebSocket: live telemetry, polling the active session's latest frame ----

@app.websocket("/ws/telemetry")
async def ws_telemetry(ws: WebSocket) -> None:
    await ws.accept()
    last_seq: int | None = None
    last_cmd_id = 0
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

                cmd_rows = await conn.fetch(
                    "SELECT id, at, text, intent, valid, message FROM operator_commands "
                    "WHERE session_id = $1 AND id > $2 ORDER BY id ASC",
                    session["id"], last_cmd_id,
                )

            if row is not None and row["seq"] != last_seq:
                last_seq = row["seq"]
                d = dict(row)
                sensors = d.pop("sensors")
                d["sensors"] = json.loads(sensors) if isinstance(sensors, str) else sensors
                d["thermal"] = _reshape_thermal(d["thermal"])
                d["session_id"] = str(session["id"])
                d["type"] = "frame"
                await ws.send_text(json.dumps(d, default=str))

            for c in cmd_rows:
                last_cmd_id = c["id"]
                intent = c["intent"]
                intent = json.loads(intent) if isinstance(intent, str) else intent
                channel = (intent or {}).get("channel", "system")
                await ws.send_text(json.dumps({
                    "type": "command",
                    "id": c["id"],
                    "at": c["at"],
                    "text": c["text"],
                    "channel": channel,
                    "valid": c["valid"],
                    "message": c["message"],
                }, default=str))

            await asyncio.sleep(0.4)
    except WebSocketDisconnect:
        pass
