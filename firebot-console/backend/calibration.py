"""Per-user voice calibration for the console (`/api/voice/calibrate/*`).

A user records each command a few times in the browser; the backend embeds the clips with the
frozen Whisper encoder and fine-tunes only the small classifier head (`firebot.voice_intent.
personalize`), saving `checkpoints/users/<name>.pt`. `/api/transcribe` then uses that head for the
named operator (or the speaker the ECAPA voiceprints recognise). Anyone without a personal model
keeps getting the default one.

server.py calls `configure(...)` so this module never imports server (no circular import).
Recordings are voice data: they live in data/calibration/ (gitignored), never in git.
"""
from __future__ import annotations

import asyncio
import io
import json
import re
import threading
from collections.abc import Callable
from pathlib import Path
from typing import Any

from fastapi import APIRouter, File, HTTPException, UploadFile

router = APIRouter(prefix="/api/voice/calibrate")

REPO_ROOT = Path(__file__).resolve().parents[2]
CLIPS_DIR = REPO_ROOT / "data" / "calibration"
MODELS_DIR = REPO_ROOT / "checkpoints" / "users"
TARGET_PER_CLASS = 5
MAX_PER_CLASS = 12
OPTIONAL = {"UNKNOWN"}

# Set by server.configure_calibration(): decode(bytes)->float32 16 kHz, classifier() -> the
# shared IntentClassifier, checkpoint path of the base model.
_decode: Callable[[bytes], Any] | None = None
_classifier: Callable[[], Any] | None = None
_checkpoint: str | None = None
_lock = threading.Lock()
_head_cache: dict[str, tuple[float, Any]] = {}


def configure(decode: Callable[[bytes], Any], classifier: Callable[[], Any], checkpoint: str | None) -> None:
    global _decode, _classifier, _checkpoint
    _decode, _classifier, _checkpoint = decode, classifier, checkpoint


def _user(name: str) -> str:
    n = (name or "").strip().lower()
    if not re.fullmatch(r"[a-z0-9_-]{1,32}", n):
        raise HTTPException(400, "Operator name must be 1-32 letters, digits, '-' or '_'")
    return n


def _classes() -> list[str]:
    from firebot.voice_intent.vocab import CLASSES
    return list(CLASSES)


def _label(label: str) -> str:
    label = (label or "").upper()
    if label not in _classes():
        raise HTTPException(400, f"Unknown command label {label!r}")
    return label


def _counts(user: str) -> dict[str, int]:
    return {c: len(list((CLIPS_DIR / user / c).glob("*.wav"))) for c in _classes()}


def _model_path(user: str) -> Path:
    return MODELS_DIR / f"{user}.pt"


def _report_path(user: str) -> Path:
    return MODELS_DIR / f"{user}.json"


def _base_ckpt() -> tuple[dict | None, str | None]:
    """(base checkpoint dict, None) when personalisation is possible, else (None, reason)."""
    if not _checkpoint or not Path(_checkpoint).is_file():
        return None, "No trained voice model is configured, so there's nothing to personalise yet."
    try:
        import torch
        ckpt = torch.load(_checkpoint, map_location="cpu", weights_only=False)
    except Exception as e:  # noqa: BLE001
        return None, f"Couldn't read the voice model: {type(e).__name__}: {e}"
    if not isinstance(ckpt, dict) or "state_dict" not in ckpt:
        return None, ("The configured voice model is an old-format checkpoint; retrain with "
                      "firebot.voice_intent to enable personal calibration.")
    return ckpt, None


def users_with_models() -> list[str]:
    return sorted(p.stem for p in MODELS_DIR.glob("*.pt")) if MODELS_DIR.is_dir() else []


def get_user_head(user: str | None):
    """Cached personal `IntentHead` for `user`, or None (no model / unreadable). Reloaded when the
    file changes, so a fresh calibration takes effect without restarting the backend."""
    if not user:
        return None
    try:
        user = _user(user)
    except HTTPException:
        return None
    path = _model_path(user)
    if not path.is_file():
        return None
    mtime = path.stat().st_mtime
    hit = _head_cache.get(user)
    if hit and hit[0] == mtime:
        return hit[1]
    try:
        from firebot.voice_intent.personalize import load_user_head
        head = load_user_head(path)
    except Exception:  # noqa: BLE001 -- a bad personal file must never break voice; use the default
        return None
    _head_cache[user] = (mtime, head)
    return head


def _status(user: str) -> dict[str, Any]:
    from firebot.voice_intent.vocab import canonical_phrase
    phrase = lambda c: ("anything else (optional)" if c == "UNKNOWN" else canonical_phrase(c))
    _, reason = _base_ckpt()
    classes = _classes()
    counts = _counts(user)
    rp = _report_path(user)
    return {
        "user": user, "supported": reason is None, "reason": reason,
        "classes": [{"label": c, "phrase": phrase(c), "count": counts[c],
                     "optional": c in OPTIONAL} for c in classes],
        "target_per_class": TARGET_PER_CLASS, "max_per_class": MAX_PER_CLASS,
        "has_model": _model_path(user).is_file(),
        "report": json.loads(rp.read_text()) if rp.is_file() else None,
        "users": users_with_models(),
    }


@router.get("/status")
async def status(user: str) -> dict[str, Any]:
    return _status(_user(user))


@router.post("/clip")
async def add_clip(user: str, label: str, file: UploadFile = File(...)) -> dict[str, Any]:  # noqa: B008
    user, label = _user(user), _label(label)
    if _decode is None:
        raise HTTPException(503, "Calibration isn't configured")
    n = _counts(user)[label]
    if n >= MAX_PER_CLASS:
        raise HTTPException(409, f"Already have {n} clips for {label}; delete one first")
    data = await file.read()
    try:
        audio = await asyncio.to_thread(_decode, data)
    except Exception as e:
        raise HTTPException(422, f"Couldn't decode that recording: {e}") from e
    if len(audio) < 4000:
        raise HTTPException(422, "That recording was too short -- try again")
    import soundfile as sf
    d = CLIPS_DIR / user / label
    d.mkdir(parents=True, exist_ok=True)
    nxt = 1 + max([int(p.stem) for p in d.glob("*.wav") if p.stem.isdigit()] or [0])
    buf = io.BytesIO()
    sf.write(buf, audio, 16_000, format="WAV", subtype="PCM_16")
    (d / f"{nxt:03d}.wav").write_bytes(buf.getvalue())
    return _status(user)


@router.delete("/clip")
async def delete_last_clip(user: str, label: str) -> dict[str, Any]:
    user, label = _user(user), _label(label)
    files = sorted((CLIPS_DIR / user / label).glob("*.wav"))
    if files:
        files[-1].unlink()
    return _status(user)


@router.post("/train")
async def train(user: str) -> dict[str, Any]:
    user = _user(user)
    base, reason = _base_ckpt()
    if base is None:
        raise HTTPException(409, reason)
    if _classifier is None:
        raise HTTPException(503, "Calibration isn't configured")
    if not _lock.acquire(blocking=False):
        raise HTTPException(409, "Calibration is already running")
    try:
        report = await asyncio.to_thread(_train_blocking, user, base)
    finally:
        _lock.release()
    return {"report": report, **_status(user)}


def _train_blocking(user: str, base: dict) -> dict:
    import numpy as np
    import soundfile as sf
    from firebot.voice_intent.personalize import personalize, save_user_ckpt

    clf = _classifier()
    if not hasattr(clf, "embed_array"):
        raise HTTPException(409, "The loaded voice model can't be personalised (old-format).")
    feats, names = [], []
    for c in _classes():
        for wav in sorted((CLIPS_DIR / user / c).glob("*.wav")):
            audio, sr = sf.read(str(wav), dtype="float32")
            feats.append(clf.embed_array(audio, sr))
            names.append(c)
    if not feats:
        raise HTTPException(409, "No recordings yet")
    ckpt, report = personalize(base, np.stack(feats), names)
    if report["accepted"]:
        save_user_ckpt(ckpt, _model_path(user))
        _head_cache.pop(user, None)
    MODELS_DIR.mkdir(parents=True, exist_ok=True)
    _report_path(user).write_text(json.dumps(report))
    return report


@router.delete("/model")
async def delete_model(user: str, clips: bool = False) -> dict[str, Any]:
    user = _user(user)
    for p in (_model_path(user), _report_path(user)):
        p.unlink(missing_ok=True)
    _head_cache.pop(user, None)
    if clips:
        import shutil
        shutil.rmtree(CLIPS_DIR / user, ignore_errors=True)
    return _status(user)
