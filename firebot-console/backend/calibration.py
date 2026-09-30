"""Per-user voice calibration and continuous improvement (`/api/voice/calibrate/*`, `/api/voice/feedback`).

**Calibrate:** a user records each command a few times in the browser; the backend embeds the clips with
the frozen Whisper encoder and fine-tunes only the small classifier head (`firebot.voice_intent.
personalize`), saving `checkpoints/users/<name>.pt`. `/api/transcribe` then uses that head for the named
operator (or the speaker the ECAPA voiceprints recognise). Anyone without a personal model keeps the
default one.

**Keep improving:** when a personal/known operator speaks, `/api/transcribe` stashes the clip briefly
(`save_pending`). The console then reports what the person did with the result (`record_feedback`):
they sent the text unchanged (a confirmation), or picked the right command from "Not right?" (a
correction). Confirmed and corrected clips join the user's training set, and once enough have arrived the
head is retrained automatically in the background. The model only ever learns from what a person
confirmed or corrected -- never from its own guesses, which would just reinforce its mistakes.

**Never worse:** every retrain is judged on a fixed hold-out (clips the trainer never sees) and is only
kept if it matches or beats BOTH the default model and the user's current one; the previous model is
kept as `<name>.prev.pt`. A live accuracy figure (predicted vs. what the person finally chose) is tracked.

server.py calls `configure(...)` so this module never imports server (no circular import).
Recordings are voice data: they live in data/calibration/ (gitignored), never in git.
"""
from __future__ import annotations

import asyncio
import io
import json
import re
import threading
import time
import uuid
from collections.abc import Callable
from pathlib import Path
from typing import Any

from fastapi import APIRouter, File, HTTPException, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel

router = APIRouter(prefix="/api/voice")

REPO_ROOT = Path(__file__).resolve().parents[2]
CLIPS_DIR = REPO_ROOT / "data" / "calibration"
MODELS_DIR = REPO_ROOT / "checkpoints" / "users"
TARGET_PER_CLASS = 5
MAX_PER_CLASS = 50          # guided recordings per command: unlimited practice & calibration
OPTIONAL = {"UNKNOWN"}
FB_CONFIRM_CAP = 15         # kept "already right" clips per command: more adds little
FB_CORRECT_CAP = 40         # kept corrections per command: these are the most valuable
AUTO_MIN_NEW = 8            # new feedback clips before an automatic retrain...
AUTO_MIN_CORRECTIONS = 3    # ...or this many corrections, whichever comes first
AUTO_COOLDOWN_S = 120       # never retrain more often than this
PENDING_TTL_S = 6 * 3600    # un-reviewed clips are deleted after this
LIVE_WINDOW = 50            # decisions used for the live accuracy figure

_decode: Callable[[bytes], Any] | None = None
_classifier: Callable[[], Any] | None = None
_checkpoint: str | None = None
_lock = threading.Lock()
_head_cache: dict[str, tuple[float, Any]] = {}
_base_cache: tuple[float, dict] | None = None
_last_auto: dict[str, float] = {}


def configure(decode: Callable[[bytes], Any], classifier: Callable[[], Any], checkpoint: str | None) -> None:
    global _decode, _classifier, _checkpoint
    _decode, _classifier, _checkpoint = decode, classifier, checkpoint


def _write_wav_file(path_or_buf, audio, sr: int = 16_000) -> None:
    try:
        import soundfile as sf
        sf.write(path_or_buf, audio, sr, format="WAV", subtype="PCM_16")
        return
    except Exception:
        pass
    import wave
    import numpy as np
    pcm = np.clip(np.asarray(audio, dtype=np.float32) * 32767.0, -32768, 32767).astype(np.int16)
    with wave.open(path_or_buf, "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(sr)
        wf.writeframes(pcm.tobytes())


def _read_wav_file(path_or_buf) -> tuple[Any, int]:
    try:
        import soundfile as sf
        return sf.read(path_or_buf, dtype="float32")
    except Exception:
        pass
    import wave
    import numpy as np
    with wave.open(path_or_buf, "rb") as wf:
        n_channels = wf.getnchannels()
        sampwidth = wf.getsampwidth()
        sr = wf.getframerate()
        raw = wf.readframes(wf.getnframes())
    if sampwidth == 2:
        samples = np.frombuffer(raw, dtype=np.int16).astype(np.float32) / 32768.0
    elif sampwidth == 4:
        samples = np.frombuffer(raw, dtype=np.int32).astype(np.float32) / 2147483648.0
    elif sampwidth == 1:
        samples = (np.frombuffer(raw, dtype=np.uint8).astype(np.float32) - 128.0) / 128.0
    else:
        raise ValueError(f"Unsupported sample width: {sampwidth}")
    if n_channels > 1:
        samples = samples.reshape(-1, n_channels).mean(axis=1)
    return samples, sr


# ------------------------------------------------------------------ names, paths, vocabulary
PROFILES_FILE = CLIPS_DIR / "profiles.json"
DEFAULT_PROFILES = {
    "ananya": {
        "id": "ananya",
        "displayName": "Ananya",
        "callsign": "PHOENIX-1",
        "role": "Lead Robotics Engineer",
        "avatar": "shield",
        "color": "#F0559B",
    },
    "avinandan": {
        "id": "avinandan",
        "displayName": "Avinandan",
        "callsign": "VANGUARD-2",
        "role": "Incident Commander",
        "avatar": "lightning",
        "color": "#00F0FF",
    },
    "alex": {
        "id": "alex",
        "displayName": "Alex",
        "callsign": "TITAN-3",
        "role": "Autonomous Systems Specialist",
        "avatar": "gear",
        "color": "#FFB238",
    },
    "sarah": {
        "id": "sarah",
        "displayName": "Sarah",
        "callsign": "HAWK-4",
        "role": "Hazard Response Lead",
        "avatar": "fire",
        "color": "#FF4A2B",
    },
}


def _load_profiles() -> dict[str, dict]:
    CLIPS_DIR.mkdir(parents=True, exist_ok=True)
    if not PROFILES_FILE.is_file():
        PROFILES_FILE.write_text(json.dumps(DEFAULT_PROFILES, indent=2))
        return dict(DEFAULT_PROFILES)
    try:
        data = json.loads(PROFILES_FILE.read_text())
        if isinstance(data, dict):
            for k, v in DEFAULT_PROFILES.items():
                if k not in data:
                    data[k] = v
            return data
    except Exception:
        pass
    return dict(DEFAULT_PROFILES)


def _save_profiles(profiles: dict[str, dict]) -> None:
    CLIPS_DIR.mkdir(parents=True, exist_ok=True)
    PROFILES_FILE.write_text(json.dumps(profiles, indent=2))


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


def _norm(text: str) -> str:
    return re.sub(r"[^a-z0-9 ]+", "", (text or "").lower()).strip()


def _phrase_table() -> dict[str, str]:
    """normalised canonical phrase -> label (UNKNOWN has no phrase)."""
    from firebot.voice_intent.vocab import canonical_phrase
    out = {}
    for c in _classes():
        try:
            out[_norm(canonical_phrase(c))] = c
        except KeyError:
            pass
    return out


def label_for_text(text: str | None) -> str | None:
    """The command a console text box holds, when it is exactly one command's canonical phrase."""
    return _phrase_table().get(_norm(text or ""))


def _udir(user: str) -> Path:
    return CLIPS_DIR / user


def _counts(user: str) -> dict[str, int]:
    """Guided-recording counts only (numbered clips); feedback clips are `fb_*.wav`."""
    return {c: len([p for p in (_udir(user) / c).glob("*.wav") if not p.name.startswith("fb_")])
            for c in _classes()}


def _fb_counts(user: str) -> dict[str, int]:
    return {c: len(list((_udir(user) / c).glob("fb_*.wav"))) for c in _classes()}


def _model_path(user: str) -> Path:
    return MODELS_DIR / f"{user}.pt"


def _report_path(user: str) -> Path:
    return MODELS_DIR / f"{user}.json"


def _history_path(user: str) -> Path:
    return MODELS_DIR / f"{user}.history.jsonl"


def _fblog_path(user: str) -> Path:
    return _udir(user) / "feedback.jsonl"


def _pending_dir(user: str) -> Path:
    return _udir(user) / "_pending"


# ------------------------------------------------------------------ base model / per-user heads
def _base_ckpt() -> tuple[dict | None, str | None]:
    """(base checkpoint dict, None) when personalisation is possible, else (None, reason). Cached by mtime."""
    global _base_cache
    if not _checkpoint or not Path(_checkpoint).is_file():
        return None, "No trained voice model is configured, so there's nothing to personalise yet."
    try:
        mtime = Path(_checkpoint).stat().st_mtime
        if _base_cache and _base_cache[0] == mtime:
            return _base_cache[1], None
        import torch
        ckpt = torch.load(_checkpoint, map_location="cpu", weights_only=False)
    except Exception as e:  # noqa: BLE001
        return None, f"Couldn't read the voice model: {type(e).__name__}: {e}"
    if not isinstance(ckpt, dict) or "state_dict" not in ckpt:
        return None, ("The configured voice model is an old-format checkpoint; retrain with "
                      "firebot.voice_intent to enable personal calibration.")
    _base_cache = (mtime, ckpt)
    return ckpt, None


def users_with_models() -> list[str]:
    return sorted(p.stem for p in MODELS_DIR.glob("*.pt") if not p.stem.endswith(".prev")) if MODELS_DIR.is_dir() else []


def get_user_head(user: str | None):
    """Cached personal `IntentHead` for `user`, or None (no model / unreadable). Reloaded when the
    file changes, so a fresh (re)training takes effect without restarting the backend."""
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


# ------------------------------------------------------------------ live feedback: pending clips
def _cleanup_pending(user: str) -> None:
    d = _pending_dir(user)
    if not d.is_dir():
        return
    cutoff = time.time() - PENDING_TTL_S
    for p in d.glob("*"):
        try:
            if p.stat().st_mtime < cutoff:
                p.unlink()
        except OSError:
            pass


def save_pending(user: str | None, audio_bytes: bytes, text: str) -> str | None:
    """Stash the clip that was just read for `user`, so their reaction to the result can teach the model.
    Returns a clip id, or None when learning isn't possible (unknown user, no current-format model)."""
    if not user or _decode is None:
        return None
    try:
        user = _user(user)
    except HTTPException:
        return None
    if _base_ckpt()[0] is None:
        return None
    try:
        audio = _decode(audio_bytes)
        if len(audio) < 4000:
            return None
        d = _pending_dir(user)
        d.mkdir(parents=True, exist_ok=True)
        _cleanup_pending(user)
        cid = uuid.uuid4().hex[:12]
        buf = io.BytesIO()
        _write_wav_file(buf, audio, 16_000)
        (d / f"{cid}.wav").write_bytes(buf.getvalue())
        (d / f"{cid}.json").write_text(json.dumps({"text": text, "ts": time.time()}))
        return cid
    except Exception:  # noqa: BLE001 -- learning is best-effort; voice must keep working
        return None


def _live_stats(user: str) -> dict[str, Any]:
    p = _fblog_path(user)
    rows: list[dict] = []
    if p.is_file():
        for line in p.read_text().splitlines()[-LIVE_WINDOW:]:
            try:
                rows.append(json.loads(line))
            except ValueError:
                pass
    scored = [r for r in rows if r.get("predicted")]
    correct = sum(1 for r in scored if r["predicted"] == r["final"])
    return {"decisions": len(scored), "correct": correct,
            "accuracy": round(correct / len(scored), 4) if scored else None}


def _new_since_train(user: str) -> dict[str, int]:
    rp = _report_path(user)
    used = 0
    if rp.is_file():
        try:
            used = int(json.loads(rp.read_text()).get("fb_clips", 0))
        except (ValueError, TypeError):
            used = 0
    total = sum(_fb_counts(user).values())
    corrections = 0
    if _fblog_path(user).is_file():
        for line in _fblog_path(user).read_text().splitlines():
            try:
                corrections += json.loads(line).get("kind") == "correction"
            except ValueError:
                pass
    return {"new": max(0, total - used), "fb_total": total, "corrections_logged": corrections}


def should_auto_retrain(user: str) -> bool:
    if _base_ckpt()[0] is None or _lock.locked():
        return False
    if time.time() - _last_auto.get(user, 0) < AUTO_COOLDOWN_S:
        return False
    if any(n < 3 and c not in OPTIONAL for c, n in _counts(user).items()):
        return False   # never calibrated: don't build a model from feedback alone
    new = _new_since_train(user)["new"]
    if new <= 0:
        return False
    recent_corrections = 0
    if _fblog_path(user).is_file():
        rp = _report_path(user)
        since = rp.stat().st_mtime if rp.is_file() else 0
        for line in _fblog_path(user).read_text().splitlines():
            try:
                r = json.loads(line)
            except ValueError:
                continue
            if r.get("kind") == "correction" and r.get("ts", 0) > since:
                recent_corrections += 1
    return new >= AUTO_MIN_NEW or recent_corrections >= AUTO_MIN_CORRECTIONS


def record_feedback(user: str, clip_id: str, label: str | None, sent_text: str | None) -> dict[str, Any]:
    """What the person did with a result. `label` = an explicit correction; otherwise `sent_text` is
    the text they sent, and if it is exactly one command's phrase, that confirms it."""
    user = _user(user)
    if not re.fullmatch(r"[a-f0-9]{12}", clip_id or ""):
        raise HTTPException(400, "bad clip id")
    d = _pending_dir(user)
    wav, meta_p = d / f"{clip_id}.wav", d / f"{clip_id}.json"
    if not wav.is_file():
        return {"recorded": False, "reason": "That clip has expired or was already used."}
    meta = json.loads(meta_p.read_text()) if meta_p.is_file() else {}
    predicted = label_for_text(meta.get("text"))
    final = _label(label) if label else label_for_text(sent_text)
    if final is None:      # they typed something else: we can't tell what the clip was, so learn nothing
        wav.unlink(missing_ok=True); meta_p.unlink(missing_ok=True)
        return {"recorded": False, "reason": "not a recognised command"}
    kind = "confirm" if predicted == final else "correction"
    cls_dir = _udir(user) / final
    cls_dir.mkdir(parents=True, exist_ok=True)
    kept = len(list(cls_dir.glob("fb_*.wav"))) < (FB_CONFIRM_CAP if kind == "confirm" else FB_CORRECT_CAP)
    if kept:
        wav.replace(cls_dir / f"fb_{clip_id}.wav")
    else:
        wav.unlink(missing_ok=True)
    meta_p.unlink(missing_ok=True)
    with _fblog_path(user).open("a") as f:
        f.write(json.dumps({"ts": time.time(), "predicted": predicted, "final": final, "kind": kind, "kept": kept}) + "\n")
    started = maybe_auto_retrain(user)
    return {"recorded": True, "kind": kind, "final": final, "kept": kept,
            "live": _live_stats(user), "retraining": started}


def maybe_auto_retrain(user: str) -> bool:
    if not should_auto_retrain(user):
        return False
    _last_auto[user] = time.time()
    threading.Thread(target=_auto_retrain_blocking, args=(user,), daemon=True).start()
    return True


def _auto_retrain_blocking(user: str) -> dict | None:
    if not _lock.acquire(blocking=False):
        return None
    try:
        base, _ = _base_ckpt()
        return _train_blocking(user, base, trigger="auto") if base else None
    except Exception:  # noqa: BLE001 -- a failed background retrain must never take voice down
        return None
    finally:
        _lock.release()


# ------------------------------------------------------------------ API
def _status(user: str) -> dict[str, Any]:
    from firebot.voice_intent.vocab import canonical_phrase
    phrase = lambda c: ("anything else (optional)" if c == "UNKNOWN" else canonical_phrase(c))
    _, reason = _base_ckpt()
    classes = _classes()
    counts, fb = _counts(user), _fb_counts(user)
    rp = _report_path(user)
    history = []
    if _history_path(user).is_file():
        for line in _history_path(user).read_text().splitlines()[-5:]:
            try:
                history.append(json.loads(line))
            except ValueError:
                pass
    return {
        "user": user, "supported": reason is None, "reason": reason,
        "classes": [{"label": c, "phrase": phrase(c), "count": counts[c], "feedback": fb[c],
                     "optional": c in OPTIONAL,
                     "clips": [p.name for p in sorted((_udir(user) / c).glob("*.wav"))]} for c in classes],
        "target_per_class": TARGET_PER_CLASS, "max_per_class": MAX_PER_CLASS,
        "has_model": _model_path(user).is_file(),
        "report": json.loads(rp.read_text()) if rp.is_file() else None,
        "live": _live_stats(user), "learning": {**_new_since_train(user),
                                                 "auto_min_new": AUTO_MIN_NEW,
                                                 "auto_min_corrections": AUTO_MIN_CORRECTIONS,
                                                 "retraining": _lock.locked()},
        "history": history, "users": users_with_models(),
    }


@router.get("/calibrate/status")
async def status(user: str) -> dict[str, Any]:
    return _status(_user(user))


@router.get("/calibrate/clip-audio")
async def get_clip_audio(user: str, label: str, filename: str) -> FileResponse:
    user, label = _user(user), _label(label)
    clean_name = Path(filename).name
    p = _udir(user) / label / clean_name
    if not p.is_file():
        raise HTTPException(404, f"Clip {clean_name} not found")
    return FileResponse(p, media_type="audio/wav")


@router.post("/calibrate/clip")
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
    d = _udir(user) / label
    d.mkdir(parents=True, exist_ok=True)
    nxt = 1 + max([int(p.stem) for p in d.glob("*.wav") if p.stem.isdigit()] or [0])
    buf = io.BytesIO()
    _write_wav_file(buf, audio, 16_000)
    (d / f"{nxt:03d}.wav").write_bytes(buf.getvalue())
    return _status(user)


@router.delete("/calibrate/clip")
async def delete_clip(user: str, label: str, filename: str | None = None) -> dict[str, Any]:
    user, label = _user(user), _label(label)
    if filename:
        clean_name = Path(filename).name
        target = _udir(user) / label / clean_name
        if target.is_file():
            target.unlink()
    else:
        files = sorted(p for p in (_udir(user) / label).glob("*.wav") if not p.name.startswith("fb_"))
        if files:
            files[-1].unlink()
    return _status(user)


@router.post("/calibrate/train")
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
        report = await asyncio.to_thread(_train_blocking, user, base, "manual")
    finally:
        _lock.release()
    return {"report": report, **_status(user)}


def _train_blocking(user: str, base: dict, trigger: str = "manual") -> dict:
    import numpy as np
    import torch
    from firebot.voice_intent.personalize import holdout_indices, personalize, save_user_ckpt

    clf = _classifier() if _classifier else None
    if clf is None or not hasattr(clf, "embed_array"):
        raise HTTPException(409, "The loaded voice model can't be personalised (old-format).")
    keys, feats, names = [], [], []
    for c in _classes():
        for wav in sorted((_udir(user) / c).glob("*.wav")):
            audio, sr = _read_wav_file(str(wav))
            keys.append(f"{c}/{wav.name}")
            feats.append(clf.embed_array(audio, sr))
            names.append(c)
    if not feats:
        raise HTTPException(409, "No recordings yet")
    incumbent = None
    if _model_path(user).is_file():
        try:
            incumbent = torch.load(_model_path(user), map_location="cpu", weights_only=False)
        except Exception:  # noqa: BLE001
            incumbent = None
    arr = np.stack(feats)
    ckpt, report = personalize(base, arr, names, holdout_idx=holdout_indices(keys, names),
                               incumbent=incumbent, refit_all=False,
                               allow_partial=True, min_clips=1)
    fb_total = sum(_fb_counts(user).values())
    report.update(trigger=trigger, trained_at=time.time(), fb_clips=fb_total)
    MODELS_DIR.mkdir(parents=True, exist_ok=True)
    if report["accepted"]:
        if _model_path(user).is_file():   # keep the model it replaces, so a bad one can be rolled back
            (MODELS_DIR / f"{user}.prev.pt").write_bytes(_model_path(user).read_bytes())
        save_user_ckpt(ckpt, _model_path(user))
        _head_cache.pop(user, None)
    _report_path(user).write_text(json.dumps(report))
    with _history_path(user).open("a") as f:
        f.write(json.dumps({k: report.get(k) for k in
                            ("trained_at", "trigger", "accepted", "base_acc", "incumbent_acc", "personal_acc",
                             "clips", "holdout", "reason")}) + "\n")
    return report


class FeedbackIn(BaseModel):
    user: str
    clip_id: str
    label: str | None = None
    sent_text: str | None = None


@router.post("/feedback")
async def feedback(body: FeedbackIn) -> dict[str, Any]:
    return await asyncio.to_thread(record_feedback, body.user, body.clip_id, body.label, body.sent_text)


@router.delete("/calibrate/model")
async def delete_model(user: str, clips: bool = False) -> dict[str, Any]:
    user = _user(user)
    for p in (_model_path(user), _report_path(user), MODELS_DIR / f"{user}.prev.pt", _history_path(user)):
        p.unlink(missing_ok=True)
    _head_cache.pop(user, None)
    _last_auto.pop(user, None)
    if clips:
        import shutil
        shutil.rmtree(_udir(user), ignore_errors=True)
    return _status(user)


# ------------------------------------------------------------------ Operator Profiles
class ProfileIn(BaseModel):
    id: str
    displayName: str
    callsign: str = ""
    role: str = ""
    avatar: str = "shield"
    color: str = "#00F0FF"


@router.get("/profiles")
async def get_profiles() -> dict[str, Any]:
    profs = _load_profiles()
    vp_dir = REPO_ROOT / "data" / "voiceprints"
    enrolled_set = set(p.stem for p in vp_dir.glob("*.npy")) if vp_dir.is_dir() else set()
    model_set = set(users_with_models())

    out = []
    for pid, p in profs.items():
        user = _user(pid)
        c_map = _counts(user)
        total_clips = sum(c_map.values())
        out.append({
            **p,
            "id": user,
            "total_clips": total_clips,
            "has_voiceprint": user in enrolled_set,
            "has_model": user in model_set,
            "classes_covered": sum(1 for n in c_map.values() if n > 0),
        })
    return {"profiles": out}


@router.post("/profiles")
async def save_profile(body: ProfileIn) -> dict[str, Any]:
    uid = _user(body.id)
    profs = _load_profiles()
    profs[uid] = {
        "id": uid,
        "displayName": body.displayName.strip() or uid.capitalize(),
        "callsign": body.callsign.strip().upper() or f"OPERATOR-{len(profs) + 1}",
        "role": body.role.strip() or "Flight Pilot",
        "avatar": body.avatar or "shield",
        "color": body.color or "#00F0FF",
    }
    _save_profiles(profs)
    return {"saved": True, "profile": profs[uid]}


@router.post("/calibrate/enroll-speaker")
async def enroll_speaker_voiceprint(user: str) -> dict[str, Any]:
    """Enroll the operator's ECAPA voiceprint into data/voiceprints/<user>.npy from all their
    recorded clips in data/calibration/<user>/**/*.wav, so speaker identification recognizes them."""
    user = _user(user)
    udir = _udir(user)
    if not udir.is_dir():
        raise HTTPException(400, f"No recordings directory found for {user}")
    wavs = sorted(udir.glob("**/*.wav"))
    if not wavs:
        raise HTTPException(400, f"No audio clips found for '{user}'. Record command clips first.")

    import numpy as np
    from firebot.speech.speaker_id import SpeakerIdentifier, trim_silence

    vp_dir = REPO_ROOT / "data" / "voiceprints"
    vp_dir.mkdir(parents=True, exist_ok=True)
    ident = SpeakerIdentifier(vp_dir)

    pcm_clips = []
    for w in wavs:
        try:
            audio, sr = _read_wav_file(str(w))
            if sr != 16_000:
                new_len = int(round(len(audio) * 16_000 / sr))
                audio = np.interp(np.linspace(0, len(audio) - 1, new_len), np.arange(len(audio)), audio).astype(np.float32)
            audio = trim_silence(audio.astype(np.float32))
            pcm = (np.clip(audio, -1.0, 1.0) * 32767).astype("<i2").tobytes()
            if len(pcm) >= 6400:  # at least 0.2s of speech
                pcm_clips.append(pcm)
        except Exception:
            continue

    if not pcm_clips:
        raise HTTPException(422, f"Could not extract usable speech PCM from {len(wavs)} audio clips.")

    await asyncio.to_thread(ident.enroll_multi, user, pcm_clips)
    return {
        "enrolled": True,
        "user": user,
        "clip_count": len(pcm_clips),
        "voiceprint_path": str(vp_dir / f"{user}.npy"),
    }


@router.post("/test")
async def test_voice(file: UploadFile = File(...), expected_user: str | None = None) -> dict[str, Any]:
    """Live verification: evaluate a speech clip against both Speaker ID and Intent Classification."""
    t0 = time.time()
    data = await file.read()
    if not data:
        raise HTTPException(400, "Empty audio file")

    if _decode is None:
        raise HTTPException(503, "Voice processing not configured")

    import numpy as np
    from firebot.speech.speaker_id import SpeakerIdentifier, decide_speaker, trim_silence
    from firebot.voice_intent.vocab import canonical_phrase

    audio = await asyncio.to_thread(_decode, data)
    pcm = (np.clip(audio, -1.0, 1.0) * 32767).astype("<i2").tobytes()

    # Speaker identification
    spk_name, spk_score = None, 0.0
    spk_scores = {}
    vp_dir = REPO_ROOT / "data" / "voiceprints"
    if vp_dir.is_dir() and any(vp_dir.glob("*.npy")):
        try:
            ident = SpeakerIdentifier(vp_dir)
            scores = ident.scores(pcm)
            spk_scores = {k: round(v, 3) for k, v in scores.items()}
            spk_name, spk_score = decide_speaker(scores, 0.25, 0.04)
        except Exception:
            pass

    # Intent classification
    intent_name, intent_conf, phrase = "UNKNOWN", 0.0, ""
    try:
        clf = _classifier() if _classifier else None
        if clf is not None:
            extra = {}
            active_user = expected_user or spk_name
            head = get_user_head(active_user) if hasattr(clf, "embed_array") else None
            if head is not None:
                extra["head"] = head
            res = clf.predict_intent_payload_array(audio, sample_rate=16_000, min_confidence=0.1, **extra)
            intent_name = res.get("name", "UNKNOWN")
            intent_conf = round(float(res.get("confidence", 0.0)), 3)
            raw = res.get("raw_label", intent_name)
            try:
                phrase = canonical_phrase(raw)
            except Exception:
                phrase = intent_name
    except Exception as e:
        phrase = str(e)

    latency_ms = round((time.time() - t0) * 1000, 1)
    return {
        "speaker": spk_name,
        "speaker_score": round(spk_score, 3) if spk_score else 0.0,
        "speaker_scores": spk_scores,
        "intent": intent_name,
        "confidence": intent_conf,
        "phrase": phrase,
        "latency_ms": latency_ms,
    }
