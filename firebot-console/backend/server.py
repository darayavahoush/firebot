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
import math
import logging
import os
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import asyncpg
import httpx
from fastapi import FastAPI, File, Form, HTTPException, UploadFile, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

def _ensure_numba_cache_dir() -> None:
    """librosa JIT-compiles with numba `cache=True`; if numba can't find a writable cache folder
    (read-only site-packages, a wiped ~/Library/Caches, a full disk) `import librosa` dies with
    "cannot cache function '__o_fold': no locator available" and the local voice model silently
    falls back to Groq. Point numba at a folder we know is writable, *before* numba is imported.
    """
    if os.environ.get("NUMBA_CACHE_DIR"):
        return
    for base in (Path(__file__).resolve().parents[2], Path(tempfile.gettempdir())):
        d = base / (".numba_cache" if base != Path(tempfile.gettempdir()) else "firebot_numba_cache")
        try:
            d.mkdir(parents=True, exist_ok=True)
            probe = d / ".w"
            probe.write_text("ok")
            probe.unlink()
        except OSError:
            continue
        os.environ["NUMBA_CACHE_DIR"] = str(d)
        return


_ensure_numba_cache_dir()
os.environ.setdefault("MUJOCO_GL", "disabled")

from firebot.command.parser import RuleParser  # noqa: E402
from firebot.db.summary import narrate, summarize_run
from firebot.fusion.anomaly import detect_anomalies
from firebot.link.protocol import THERM_COLS, THERM_ROWS
from firebot.voice_intent.router import ShadowRouter
from firebot.voice_intent.vocab import LABEL_TO_IDX, canonical_phrase
import calibration  # noqa: E402
from slm_intent import parse_intent_slm, describe_intent  # noqa: E402
try:
    from mujoco_stream import router as mujoco_router  # noqa: E402
    _mujoco_available = True
except ImportError:
    mujoco_router = None
    _mujoco_available = False

DATABASE_URL = os.environ.get("FIREBOT_DB", "postgresql://firebot:firebot@localhost:5432/firebot")

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
# (see firebot.voice_intent.README, section 6; run.sh auto-enables it). Entirely opt-in: torch/librosa
# and the checkpoint itself are only loaded lazily, on first use, and only if this is set,
# so a console deployed without the voice_intent extras installed is completely unaffected.
VOICE_INTENT_CHECKPOINT = os.environ.get("FIREBOT_VOICE_INTENT_CHECKPOINT", "")
# Offline Vosk tier (grammar-restricted, no internet/key needed): path to an unpacked Vosk
# model dir. Optional Silero VAD trims non-speech from each clip first (FIREBOT_VAD=1).
VOSK_MODEL = os.environ.get("FIREBOT_VOSK_MODEL", "")
VAD_ENABLED = os.environ.get("FIREBOT_VAD", "") not in ("", "0", "false")
VAD_THRESHOLD = float(os.environ.get("FIREBOT_VAD_THRESHOLD", "0.5"))
VOICE_INTENT_MIN_CONFIDENCE = float(os.environ.get("FIREBOT_VOICE_INTENT_MIN_CONFIDENCE", "0.6"))


def _parse_class_thresholds(raw: str) -> dict[str, float]:
    """"STOP=0.4,EXTINGUISH=0.8" -> {"STOP": 0.4, "EXTINGUISH": 0.8}. Overrides the global
    minimum confidence for that predicted class only. Malformed or unknown-class entries are
    skipped with a warning rather than crashing startup. Empty (the default) means no overrides,
    i.e. behaviour is exactly the single global threshold."""
    out: dict[str, float] = {}
    for part in filter(None, (p.strip() for p in raw.split(","))):
        name, _, val = part.partition("=")
        name = name.strip().upper()
        try:
            v = float(val)
            if name not in LABEL_TO_IDX or not 0.0 <= v <= 1.0:
                raise ValueError
        except ValueError:
            logging.getLogger("firebot.console").warning(
                "ignoring bad FIREBOT_VOICE_INTENT_CLASS_THRESHOLDS entry %r", part)
            continue
        out[name] = v
    return out


# Per-class overrides, e.g. FIREBOT_VOICE_INTENT_CLASS_THRESHOLDS="STOP=0.4,EXTINGUISH=0.8".
# Deliberately unset by default: sensible values need confidence-vs-accuracy numbers from real
# recordings, and a guessed default would be worse than the single global threshold.
VOICE_INTENT_CLASS_THRESHOLDS = _parse_class_thresholds(
    os.environ.get("FIREBOT_VOICE_INTENT_CLASS_THRESHOLDS", ""))
# Where the ShadowRouter persists its learned per-confidence-decile trust state between
# server restarts. A missing/corrupt file just starts fresh (see ShadowRouter.load).
VOICE_INTENT_ROUTER_STATE = os.environ.get("FIREBOT_VOICE_INTENT_ROUTER_STATE",
                                          "voice_intent_router.json")

app = FastAPI(title="firebot-api")
if _mujoco_available:
    import mujoco_stream as _mujoco_stream  # noqa: E402
    _mujoco_stream.get_pool = lambda: _pool  # lets /ws/mujoco?log=1 write to Postgres
    app.include_router(mujoco_router)
else:
    # Serve a graceful "unavailable" response so the server stays up and the
    # MuJoCo tab shows the proper offline banner instead of a network error.
    @app.get("/api/mujoco/status")
    def _mujoco_status_stub():
        return {"available": False, "controllers": [], "detail": "mujoco not installed on this server"}
app.add_middleware(
    CORSMiddleware,
    allow_origins=os.environ.get("FIREBOT_CORS_ORIGINS", "http://localhost:5173").split(","),
    allow_methods=["*"],
    allow_headers=["*"],
)

_pool: asyncpg.Pool | None = None

# Lazily constructed on first /api/transcribe call that has VOICE_INTENT_CHECKPOINT set --
# loading torch/transformers/the checkpoint at import time would slow down (or break) every
# console deployment that doesn't use this feature at all.
_voice_classifier: Any = None
_voice_router: ShadowRouter | None = None
# Why the local classifier last failed (missing torch/librosa/transformers, bad checkpoint,
# undecodable clip...). Surfaced by /api/voice/status so a silent Groq fallback is diagnosable.
_voice_last_error: str | None = None

# Who is speaking (ECAPA voiceprints, `python scripts/enroll_speaker.py --speaker NAME`). Identification
# only -- it labels a command with a speaker, it never blocks one. Off with FIREBOT_SPEAKER_ID=0.
_REPO_ROOT = Path(__file__).resolve().parents[2]
SPEAKER_ID_ENABLED = os.environ.get("FIREBOT_SPEAKER_ID", "1") != "0"
SPEAKER_THRESHOLD = float(os.environ.get("FIREBOT_SPEAKER_THRESHOLD", "0.30"))
SPEAKER_MARGIN = float(os.environ.get("FIREBOT_SPEAKER_MARGIN", "0.05"))
SPEAKER_VOICEPRINT_DIR = Path(os.environ.get("FIREBOT_VOICEPRINT_DIR") or _REPO_ROOT / "data" / "voiceprints")
os.environ.setdefault("FIREBOT_SPEAKER_MODEL_DIR", str(_REPO_ROOT / "pretrained_models" / "spkrec-ecapa-voxceleb"))
_speaker_identifier: Any = None
_speaker_last_error: str | None = None


def _get_voice_classifier() -> Any:
    global _voice_classifier
    if not VOICE_INTENT_CHECKPOINT:
        return None
    if _voice_classifier is None:
        try:
            from firebot.voice_intent.infer import load_classifier
            _voice_classifier = load_classifier(VOICE_INTENT_CHECKPOINT)
        except Exception:
            _voice_classifier = None
    return _voice_classifier


def _get_voice_router() -> ShadowRouter:
    global _voice_router
    if _voice_router is None:
        _voice_router = ShadowRouter.load(VOICE_INTENT_ROUTER_STATE)
    return _voice_router


calibration.configure(
    lambda b: _decode_audio_16k(b),
    lambda: _get_voice_classifier(),
    VOICE_INTENT_CHECKPOINT,
    transcriber=lambda b: _transcribe_text(b, "test.wav", "audio/wav"),
    slm_parser=lambda t: parse_intent_slm(t),
)
app.include_router(calibration.router)


async def _apply_pg_migrations(pool: asyncpg.Pool) -> None:
    """Ensure PostgreSQL tables and schema exist upon startup."""
    try:
        migration_file = _REPO_ROOT / "src" / "firebot" / "db" / "pg_migrations" / "001_init.sql"
        if not migration_file.is_file():
            for candidate in (
                Path(__file__).resolve().parents[2] / "src" / "firebot" / "db" / "pg_migrations" / "001_init.sql",
                Path(__file__).resolve().parent / "001_init.sql",
            ):
                if candidate.is_file():
                    migration_file = candidate
                    break
        if migration_file.is_file():
            sql = migration_file.read_text(encoding="utf-8")
            async with pool.acquire() as conn:
                await conn.execute(sql)
                await conn.execute("INSERT INTO schema_migrations (version) VALUES (1) ON CONFLICT (version) DO NOTHING;")
            logging.getLogger("firebot.console").info("PostgreSQL schema migrations verified/applied successfully.")
    except Exception as e:
        logging.getLogger("firebot.console").warning("Failed to apply PostgreSQL migrations: %s", e)


@app.on_event("startup")
async def startup() -> None:
    global _pool
    try:
        _pool = await asyncpg.create_pool(DATABASE_URL, min_size=1, max_size=5, timeout=5.0)
        await _apply_pg_migrations(_pool)
    except Exception as e:
        logging.getLogger("firebot.console").warning(
            "PostgreSQL not available at %s (%s); historical run logging disabled", DATABASE_URL, e
        )
        _pool = None


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
    if _pool is None:
        return []
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
    try:
        async with _pool.acquire() as conn:
            rows = await conn.fetch(query)
        return [dict(r) for r in rows]
    except Exception as e:
        logging.getLogger("firebot.console").warning("Failed to list runs from postgres: %s", e)
        return []


@app.get("/api/runs/{run_id}")
async def run_detail(run_id: str) -> dict[str, Any]:
    if _pool is None:
        raise HTTPException(404, "Database not connected")
    query = """
        SELECT seq, t, x, y, theta, speed, tank, sensors, thermal,
               est_x, est_y, est_sigma, mode, cmd_v, cmd_w, cmd_pump, compute_ms
        FROM frames
        WHERE session_id = $1
        ORDER BY seq ASC
    """
    try:
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
    except Exception as e:
        logging.getLogger("firebot.console").warning("Failed to fetch run details for %s: %s", run_id, e)
        raise HTTPException(404, f"Run not found or database not ready: {e}")


async def _load_run_frames(run_id: str) -> list[dict[str, Any]]:
    """Frames for anomaly/summary analysis -- everything except the (large) thermal arrays."""
    if _pool is None:
        return []
    query = """
        SELECT seq, t, x, y, speed, tank, sensors, mode, cmd_pump, compute_ms
        FROM frames WHERE session_id = $1 ORDER BY seq ASC
    """
    try:
        async with _pool.acquire() as conn:
            rows = await conn.fetch(query, run_id)
        frames = []
        for r in rows:
            d = dict(r)
            sensors = d.get("sensors")
            d["sensors"] = json.loads(sensors) if isinstance(sensors, str) else (sensors or {})
            frames.append(d)
        return frames
    except Exception as e:
        logging.getLogger("firebot.console").warning("Failed to load run frames for %s: %s", run_id, e)
        return []


@app.get("/api/runs/{run_id}/anomalies")
async def run_anomalies(run_id: str) -> dict[str, Any]:
    """Explainable telemetry findings for one run: stuck/spiking sensors, pump not draining the
    tank, tank leaks, slow brain compute, link dropouts. See firebot.fusion.anomaly."""
    frames = await _load_run_frames(run_id)
    return {"id": run_id, "frames": len(frames), "anomalies": detect_anomalies(frames)}


def _slm_generate() -> Any:
    """Optional local-model callable for `?narrate=1`, from FIREBOT_SLM_CMD (the same shell
    wrapper contract as `firebot-brain --slm-cmd`). None when unset."""
    cmd = os.environ.get("FIREBOT_SLM_CMD", "")
    if not cmd:
        return None
    import subprocess

    def generate(prompt: str) -> str:
        return subprocess.run(cmd, shell=True, input=prompt, capture_output=True, text=True,
                              timeout=30, check=False).stdout
    return generate


@app.get("/api/runs/{run_id}/summary")
async def run_summary(run_id: str, narrate_text: bool = False) -> dict[str, Any]:
    """Plain-English incident summary computed from the stored frames and operator commands.
    With `narrate_text=true` and FIREBOT_SLM_CMD set, a local model re-words it (numbers are
    verified against the facts; on any mismatch the deterministic text is returned)."""
    frames = await _load_run_frames(run_id)
    commands = []
    if _pool is not None:
        try:
            async with _pool.acquire() as conn:
                cmd_rows = await conn.fetch(
                    "SELECT at, text, valid, message FROM operator_commands "
                    "WHERE session_id = $1 ORDER BY id ASC", run_id)
            commands = [dict(r) for r in cmd_rows]
        except Exception as e:
            logging.getLogger("firebot.console").warning("Failed to fetch commands for summary: %s", e)
    summary = summarize_run(frames, commands, detect_anomalies(frames))
    text, narrated = summary["text"], False
    if narrate_text:
        gen = _slm_generate()
        if gen is not None:
            text = narrate(summary, gen)
            narrated = text != summary["text"]
    return {"id": run_id, "facts": summary["facts"], "text": text, "narrated": narrated}


# ---- REST: command forwarding to the brain ----

class Command(BaseModel):
    type: str
    dir: str | None = None
    speed: int | None = None
    on: bool | None = None
    angle: int | None = None
    mode: str | None = None
    v: float | None = None  # analog drive (joystick): forward speed 0..1
    w: float | None = None  # analog drive: turn rate -1..1, + is counter-clockwise (left)


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
    "fwd": (1.0, 0.0), "left": (0.0, MAX_TURN_RATE), "right": (0.0, -MAX_TURN_RATE),  # +w = counter-clockwise (left), as in the sim
    "stop": (0.0, 0.0),
}

# The console sends drive/pump/nozzle as separate discrete UI events (button press, toggle,
# slider), but /manual on the brain side wants one atomic (v, w, pump, nozzle) sample. Track
# the last commanded value of each here and always send the merged state. Single console
# process, single operator at a time -- module-level state is fine.
_manual_state = {"v": 0.0, "w": 0.0, "pump": False, "nozzle": 0.0}


@app.post("/api/command")
async def post_command(cmd: Command) -> dict[str, Any]:
    if cmd.type == "DRIVE" and cmd.dir is None and cmd.v is not None:
        v, w = float(cmd.v), float(cmd.w or 0.0)
        if not (math.isfinite(v) and math.isfinite(w)):
            raise HTTPException(400, "v and w must be finite numbers")
        _manual_state["v"], _manual_state["w"] = max(0.0, min(1.0, v)), max(-1.0, min(1.0, w))
        return await _post_bridge("/manual", dict(_manual_state))
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


class VoiceIntentRequest(BaseModel):
    text: str
    execute: bool = False
    operator: str | None = None


async def _execute_intent_action(intent_name: str, params: dict[str, Any], operator: str | None = None) -> dict[str, Any]:
    """Execute an intent on the robot bridge, broadcast telemetry event, and log to DB."""
    action_result = {"ok": True, "action": intent_name, "message": ""}

    # 1. STOP
    if intent_name == "STOP":
        _manual_state["v"] = 0.0
        _manual_state["w"] = 0.0
        _manual_state["pump"] = False
        try:
            await _post_bridge("/estop", {})
            action_result["message"] = "Emergency stop dispatched: motors & pump halted"
        except Exception:
            action_result["message"] = "Halted: pump off, zero velocity latched"

    # 2. EXTINGUISH
    elif intent_name == "EXTINGUISH":
        try:
            _manual_state["pump"] = True
            await _post_bridge("/manual", dict(_manual_state))
            action_result["message"] = "Autonomous fire suppression active: pump engaged"
        except Exception:
            action_result["message"] = "Autonomous firefighting mode engaged"

    # 3. DRIVE
    elif intent_name == "DRIVE":
        direction = params.get("dir", "fwd")
        speed = int(params.get("speed", 50))
        vec = _DRIVE_VECTORS.get(direction, (0.0, 0.0))
        scale = max(0.0, min(1.0, speed / 100.0))
        _manual_state["v"] = vec[0] * scale
        _manual_state["w"] = vec[1] * scale
        try:
            await _post_bridge("/manual", dict(_manual_state))
            action_result["message"] = f"Driving {direction} at {speed}% speed"
        except Exception:
            action_result["message"] = f"Commanded drive: {direction} @ {speed}%"

    # 4. PUMP
    elif intent_name == "PUMP":
        on_state = bool(params.get("on", True))
        _manual_state["pump"] = on_state
        try:
            await _post_bridge("/manual", dict(_manual_state))
            action_result["message"] = f"Water pump {'activated' if on_state else 'deactivated'}"
        except Exception:
            action_result["message"] = f"Water pump switched {'ON' if on_state else 'OFF'}"

    # 5. GOTO / RETURN_HOME
    elif intent_name in ("GOTO", "RETURN_HOME"):
        target_xy = (1.2, 1.0) if intent_name == "RETURN_HOME" else (params.get("x", 6.0), params.get("y", 4.0))
        action_result["message"] = f"Navigation targeted to ({target_xy[0]:.1f}, {target_xy[1]:.1f})"

    # 6. STATUS
    elif intent_name == "STATUS":
        action_result["message"] = "Status telemetry requested"

    else:
        action_result = {"ok": False, "action": intent_name, "message": "Unknown command or unable to execute"}

    # Record in database if active session exists
    if _pool is not None:
        try:
            async with _pool.acquire() as conn:
                session = await conn.fetchrow(
                    "SELECT id FROM sessions WHERE ended_at IS NULL ORDER BY started_at DESC LIMIT 1"
                )
                if session is not None:
                    await conn.execute(
                        "INSERT INTO operator_commands (session_id, text, intent, valid, message) "
                        "VALUES ($1, $2, $3, $4, $5)",
                        session["id"],
                        params.get("raw_text", intent_name),
                        json.dumps({"name": intent_name, "params": params, "operator": operator}),
                        action_result["ok"],
                        action_result["message"],
                    )
        except Exception as e:
            logging.getLogger("firebot.console").warning("Could not log command to postgres: %s", e)

    return action_result


@app.post("/api/voice/intent")
async def voice_intent(req: VoiceIntentRequest) -> dict[str, Any]:
    """Parse any arbitrary natural language voice/text command into a structured intent using SLM,
    and optionally execute it immediately."""
    parsed = await parse_intent_slm(req.text)
    out: dict[str, Any] = {"text": req.text, "intent": parsed}
    if req.execute and parsed.get("intent") and parsed["intent"] != "UNKNOWN":
        execution = await _execute_intent_action(
            parsed["intent"],
            {**parsed.get("params", {}), "raw_text": req.text},
            req.operator,
        )
        out["execution"] = execution
    return out


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


_vosk_rec: Any = None
_vad_gate: Any = None
_vosk_last_error: str | None = None
_vad_last_error: str | None = None


def _get_vosk() -> Any:
    global _vosk_rec
    if _vosk_rec is None:
        from firebot.speech.recognizer import VoskRecognizer
        _vosk_rec = VoskRecognizer(VOSK_MODEL)
    return _vosk_rec


def _get_vad_gate() -> Any:
    global _vad_gate
    if _vad_gate is None:
        from firebot.speech.vad import SileroGate
        _vad_gate = SileroGate(threshold=VAD_THRESHOLD)
    return _vad_gate


def _vosk_text(audio_bytes: bytes) -> str | None:
    """Offline Vosk transcript of an uploaded clip, or None for *any* reason it can't help
    (not configured, missing vosk/model, undecodable clip, nothing recognised). Never raises:
    like the local classifier, this tier is an optimisation ahead of the Groq fallback."""
    global _vosk_last_error, _vad_last_error
    if not VOSK_MODEL:
        return None
    try:
        from firebot.speech import offline

        pcm = offline.float_to_pcm16(_decode_audio_16k(audio_bytes))
        gate = None
        if VAD_ENABLED:
            try:
                gate = _get_vad_gate()
                _vad_last_error = None
            except Exception as e:  # noqa: BLE001 -- VAD is best-effort: fall back to the untrimmed clip
                msg = f"{type(e).__name__}: {e}"
                if msg != _vad_last_error:
                    logging.getLogger("firebot.console").warning("VAD unavailable: %s", msg)
                _vad_last_error = msg
        text = offline.transcribe_pcm(pcm, _get_vosk(), gate=gate)
        _vosk_last_error = None
        return text or None
    except Exception as e:  # noqa: BLE001 -- any failure just skips this tier
        msg = f"{type(e).__name__}: {e}"
        if msg != _vosk_last_error:
            logging.getLogger("firebot.console").warning("offline Vosk unavailable: %s", msg)
        _vosk_last_error = msg
        return None


def _decode_wav_without_librosa(audio_bytes: bytes):
    """WAV -> 16 kHz mono float32 using soundfile+scipy if available, or pure wave+numpy fallback."""
    import io
    import numpy as np

    # 1. Try soundfile + scipy if installed
    try:
        from math import gcd
        import soundfile as sf
        from scipy.signal import resample_poly

        data, sr = sf.read(io.BytesIO(audio_bytes), dtype="float32", always_2d=True)
        mono = data.mean(axis=1)
        if sr != 16_000:
            g = gcd(int(sr), 16_000)
            mono = resample_poly(mono, 16_000 // g, int(sr) // g)
        return np.ascontiguousarray(mono, dtype="float32")
    except Exception:
        pass

    # 2. Pure Python standard library wave + numpy fallback
    import wave

    with wave.open(io.BytesIO(audio_bytes), "rb") as wf:
        n_channels = wf.getnchannels()
        sampwidth = wf.getsampwidth()
        framerate = wf.getframerate()
        n_frames = wf.getnframes()
        raw = wf.readframes(n_frames)

    if sampwidth == 2:
        samples = np.frombuffer(raw, dtype=np.int16).astype(np.float32) / 32768.0
    elif sampwidth == 4:
        samples = np.frombuffer(raw, dtype=np.int32).astype(np.float32) / 2147483648.0
    elif sampwidth == 1:
        samples = (np.frombuffer(raw, dtype=np.uint8).astype(np.float32) - 128.0) / 128.0
    else:
        raise ValueError(f"Unsupported WAV sample width: {sampwidth}")

    if n_channels > 1:
        samples = samples.reshape(-1, n_channels).mean(axis=1)

    if framerate != 16_000:
        new_len = int(round(len(samples) * 16_000 / framerate))
        samples = np.interp(
            np.linspace(0, len(samples) - 1, new_len),
            np.arange(len(samples)),
            samples,
        ).astype(np.float32)

    return np.ascontiguousarray(samples, dtype="float32")


def _decode_audio_16k(audio_bytes: bytes):
    """Decode an uploaded clip to 16 kHz mono float32.

    WAV (what the console now uploads) goes through librosa. Anything else -- browsers'
    native MediaRecorder output is webm/opus or mp4 -- is transcoded by calling ffmpeg
    directly: librosa >= 1.0 dropped its own ffmpeg fallback, so librosa.load() on a raw
    webm stream fails.
    """
    import io
    import shutil
    import subprocess

    import numpy as np

    if audio_bytes[:4] == b"RIFF":
        try:
            import librosa

            audio, _ = librosa.load(io.BytesIO(audio_bytes), sr=16_000, mono=True)
            return audio
        except Exception as e:  # noqa: BLE001 -- numba cache/JIT trouble on import, etc.
            logging.getLogger("firebot.console").warning(
                "librosa unavailable for WAV decode (%s: %s); using soundfile+scipy",
                type(e).__name__, e)
            return _decode_wav_without_librosa(audio_bytes)

    ffmpeg = shutil.which("ffmpeg")
    if ffmpeg is None:
        raise RuntimeError("clip isn't WAV and ffmpeg isn't installed on the server to convert it")
    proc = subprocess.run(
        [ffmpeg, "-nostdin", "-loglevel", "error", "-i", "pipe:0",
         "-f", "f32le", "-ac", "1", "-ar", "16000", "pipe:1"],
        input=audio_bytes, capture_output=True, timeout=20, check=False,
    )
    if proc.returncode != 0 or not proc.stdout:
        raise RuntimeError(f"ffmpeg couldn't decode the clip: {proc.stderr.decode(errors='replace').strip()[:200]}")
    return np.frombuffer(proc.stdout, dtype=np.float32).copy()


_agreement_parser = RuleParser()


def _same_intent(local_phrase: str, groq_text: str) -> bool:
    """Do the local classifier's canonical phrase and Groq's raw transcript mean the same
    command? Compared as parsed intents (name + params), not as strings: Groq returns text
    like "Stop." or "Go to the north side.", so exact string equality with the canonical
    phrase ("stop", "go to north") almost never held, the ShadowRouter concluded the local
    model never agreed with Groq, and so never trusted it. An unparseable utterance on
    either side is never agreement -- two failures to understand aren't a match.
    """
    try:
        a = _agreement_parser.parse(local_phrase)
        b = _agreement_parser.parse(groq_text)
    except Exception:  # noqa: BLE001 -- agreement is bookkeeping; never fail a request over it
        return False
    if a.name == "UNKNOWN" or b.name == "UNKNOWN":
        return False
    norm = lambda p: {k: round(v, 3) if isinstance(v, float) else v for k, v in p.items()}  # noqa: E731
    return a.name == b.name and norm(a.params) == norm(b.params)


def _local_intent_phrase(audio_bytes: bytes, user: str | None = None) -> tuple[str, float] | None:
    """Try the local classifier on a raw uploaded clip. Returns (canonical_phrase,
    confidence) on a usable prediction, or None -- for *any* reason the local path isn't
    available (no checkpoint configured, decode failure, missing optional deps, low
    confidence, UNKNOWN) -- so callers always have a clean Groq fallback to drop into.
    This opt-in feature is never allowed to turn into a 500 for a console that otherwise
    only relies on Groq.
    """
    global _voice_last_error
    if not VOICE_INTENT_CHECKPOINT:
        return None
    try:
        audio = _decode_audio_16k(audio_bytes)
        clf = _get_voice_classifier()
        extra = ({"class_min_confidence": VOICE_INTENT_CLASS_THRESHOLDS}
                 if VOICE_INTENT_CLASS_THRESHOLDS else {})
        head = calibration.get_user_head(user) if hasattr(clf, "embed_array") else None
        if head is not None:  # this operator calibrated their own voice
            extra["head"] = head
        payload = clf.predict_intent_payload_array(audio, sample_rate=16_000,
                                                    min_confidence=VOICE_INTENT_MIN_CONFIDENCE,
                                                    **extra)
        if payload["name"] == "UNKNOWN":
            return None
        _voice_last_error = None  # a clean prediction means the local path is healthy again
        return canonical_phrase(payload["raw_label"]), payload["confidence"]
    except Exception as e:
        # Missing librosa/torch, a corrupt checkpoint, an undecodable clip, etc. -- the
        # local first-pass is a pure optimization, never the only path. Record why so it
        # isn't a silent fallback: logged once per distinct error, shown in /api/voice/status.
        msg = f"{type(e).__name__}: {e}"
        if msg != _voice_last_error:
            logging.getLogger("firebot.console").warning("local voice-intent unavailable: %s", msg)
        _voice_last_error = msg
        return None


@app.get("/api/voice/status")
async def voice_status() -> dict[str, Any]:
    """Which speech path /api/transcribe will use, so the UI (and you) can tell whether the
    trained local model is actually active rather than silently falling back to Groq."""
    configured = bool(VOICE_INTENT_CHECKPOINT)
    exists = configured and os.path.isfile(VOICE_INTENT_CHECKPOINT)
    vosk_found = bool(VOSK_MODEL) and os.path.isdir(VOSK_MODEL)
    if configured and exists:
        mode = "local" if _voice_last_error is None else "local-degraded"
    elif vosk_found:
        mode = "vosk" if _vosk_last_error is None else "vosk-degraded"
    elif GROQ_API_KEY:
        mode = "groq"
    else:
        mode = "unavailable"
    return {
        "mode": mode,
        "local_configured": configured,
        "local_checkpoint_found": exists,
        "local_loaded": _voice_classifier is not None,
        "local_min_confidence": VOICE_INTENT_MIN_CONFIDENCE,
        "local_class_thresholds": VOICE_INTENT_CLASS_THRESHOLDS,
        "vosk_configured": bool(VOSK_MODEL),
        "vosk_model_found": vosk_found,
        "vosk_loaded": _vosk_rec is not None,
        "vosk_last_error": _vosk_last_error,
        "vad_enabled": VAD_ENABLED,
        "vad_last_error": _vad_last_error,
        "groq_available": bool(GROQ_API_KEY),
        "speaker_id_enabled": SPEAKER_ID_ENABLED,
        "speaker_enrolled": sorted(p.stem for p in SPEAKER_VOICEPRINT_DIR.glob("*.npy"))
                            if SPEAKER_VOICEPRINT_DIR.is_dir() else [],
        "speaker_last_error": _speaker_last_error,
        "last_error": _voice_last_error or _vosk_last_error,
    }


def _identify_speaker(audio_bytes: bytes) -> dict[str, Any] | None:
    """Which enrolled operator is speaking? None when identification is off, nobody is
    enrolled, or it failed for any reason (never an error for the caller -- the command
    itself must still go through). `speaker` is None inside the dict = heard, but not
    confidently one enrolled voice."""
    global _speaker_identifier, _speaker_last_error
    if not SPEAKER_ID_ENABLED or not SPEAKER_VOICEPRINT_DIR.is_dir() \
            or not any(SPEAKER_VOICEPRINT_DIR.glob("*.npy")):
        return None
    try:
        import numpy as np
        from firebot.speech.speaker_id import SpeakerIdentifier, decide_speaker, trim_silence
        if _speaker_identifier is None:
            _speaker_identifier = SpeakerIdentifier(SPEAKER_VOICEPRINT_DIR, SPEAKER_THRESHOLD)
        audio = _decode_audio_16k(audio_bytes)
        audio = trim_silence(audio)
        pcm = (np.clip(audio, -1.0, 1.0) * 32767).astype("<i2").tobytes()
        scores = _speaker_identifier.scores(pcm)
        name, best = decide_speaker(scores, SPEAKER_THRESHOLD, SPEAKER_MARGIN)
        _speaker_last_error = None
        return {"speaker": name, "speaker_score": round(best, 3),
                "speaker_scores": {k: round(v, 3) for k, v in scores.items()}}
    except Exception as e:  # noqa: BLE001 -- best-effort labelling
        msg = f"{type(e).__name__}: {e}"
        if msg != _speaker_last_error:
            logging.getLogger("firebot.console").warning("speaker-id unavailable: %s", msg)
        _speaker_last_error = msg
        return None


@app.post("/api/transcribe")
async def transcribe(file: UploadFile = File(...), user: str | None = Form(None),
                     execute: bool = Form(False)) -> dict[str, Any]:
    audio_bytes = await file.read()
    # Who is speaking decides which personal voice model (if any) reads the command: an explicit
    # operator picked in the UI wins, else the speaker the voiceprints recognise.
    who = await asyncio.to_thread(_identify_speaker, audio_bytes)
    user_str = user if isinstance(user, str) else ""
    operator = user_str.strip().lower() or (who or {}).get("speaker")
    text = await _transcribe_text(audio_bytes, file.filename or "clip.webm",
                                  file.content_type or "audio/webm", user=operator)
    used = bool(operator and calibration.get_user_head(operator))

    # Parse intent via SLM
    intent_data = await parse_intent_slm(text) if text else None

    out = {"text": text, **(who or {})}
    if intent_data:
        out["intent"] = intent_data
    if used:
        out["voice_model"] = operator

    if execute and intent_data and intent_data.get("intent") and intent_data["intent"] != "UNKNOWN":
        out["execution"] = await _execute_intent_action(
            intent_data["intent"],
            {**intent_data.get("params", {}), "raw_text": text},
            operator,
        )

    # Stash the clip so what the person does next (send as-is / pick the right command) can teach
    # their model. None (and no extra keys) unless the operator is known and learning is possible.
    clip_id = await asyncio.to_thread(calibration.save_pending, operator, audio_bytes, text) if operator else None
    if clip_id:
        out["clip_id"], out["clip_user"] = clip_id, operator
    return out


async def _transcribe_text(audio_bytes: bytes, filename: str, content_type: str,
                           user: str | None = None) -> str:

    try:
        local = _local_intent_phrase(audio_bytes, user)
    except TypeError:
        local = _local_intent_phrase(audio_bytes)
    if local is None:
        offline_text = _vosk_text(audio_bytes)
        if offline_text:
            return offline_text
        if not GROQ_API_KEY:
            reasons = [f"{name}: {err}" for name, err in
                       (("local model", _voice_last_error if VOICE_INTENT_CHECKPOINT else None),
                        ("Vosk", _vosk_last_error if VOSK_MODEL else None)) if err]
            if reasons:
                raise HTTPException(503, "Offline speech failed (" + "; ".join(reasons)
                                    + ") and no GROQ_API_KEY is set for fallback")
            if VOICE_INTENT_CHECKPOINT or VOSK_MODEL:
                raise HTTPException(422, "Didn't recognise that as a command -- try again, closer to the mic, or type it")
        return await _call_groq(audio_bytes, filename, content_type)

    phrase, confidence = local
    router = _get_voice_router()
    if router.should_trust(confidence) and not router.should_audit():
        return phrase

    # Either not (yet) trusted for this confidence decile, or a background audit of an
    # otherwise-trusted one -- either way, ground truth from Groq updates the router.
    if not GROQ_API_KEY:
        # Can't audit without Groq; the local prediction is all we have.
        return phrase
    groq_text = await _call_groq(audio_bytes, filename, content_type)
    router.update(confidence, agreed=_same_intent(phrase, groq_text))
    router.save(VOICE_INTENT_ROUTER_STATE)
    return groq_text


# ---- WebSocket: live telemetry, polling the active session's latest frame ----

@app.websocket("/ws/telemetry")
async def ws_telemetry(ws: WebSocket) -> None:
    await ws.accept()
    last_seq: int | None = None
    last_thermal_seq: int | None = None
    last_cmd_id = 0
    try:
        while True:
            thermal_row = None
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
                # Thermal grids are only stored every Nth frame (thermal_every) and this loop
                # only ever reads the newest row, so the newest row usually has none and a
                # lucky-alignment poll was the only way the console ever saw one. Fetch the
                # newest stored grid separately when the newest frame lacks it.
                if row is not None and row["thermal"] is None:
                    thermal_row = await conn.fetchrow(
                        "SELECT seq, thermal FROM frames "
                        "WHERE session_id = $1 AND thermal IS NOT NULL "
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
                if d["thermal"] is not None:
                    last_thermal_seq = d["seq"]
                elif thermal_row is not None and thermal_row["seq"] != last_thermal_seq:
                    d["thermal"] = thermal_row["thermal"]  # newest stored grid, sent once
                    d["thermal_seq"] = thermal_row["seq"]
                    last_thermal_seq = thermal_row["seq"]
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


# ---- Optional: serve the built frontend from this same app ----
# Same origin means no CORS and wss:// just works. Must stay LAST so it never shadows /api or /ws.
_WEB_DIR = os.environ.get("FIREBOT_WEB_DIR", "")
if not _WEB_DIR:
    for _candidate in (
        _REPO_ROOT / "firebot-console" / "frontend" / "dist",
        Path(__file__).resolve().parent.parent / "frontend" / "dist",
        Path(__file__).resolve().parent / "dist",
        Path("/app/dist"),
        Path("/app/frontend/dist"),
    ):
        if _candidate.is_dir():
            _WEB_DIR = str(_candidate)
            break

if _WEB_DIR and Path(_WEB_DIR).is_dir():
    from fastapi.staticfiles import StaticFiles
    app.mount("/", StaticFiles(directory=_WEB_DIR, html=True), name="web")

