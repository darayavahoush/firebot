"""Tests for firebot-console/backend/server.py's local-classifier + ShadowRouter
wiring in /api/transcribe. Imported by path (the console backend isn't an installed
package) and exercised without a real FastAPI/asyncpg app lifecycle -- these call the
module-level helper functions and the `transcribe` coroutine directly, with the
classifier, librosa decode, and Groq HTTP call all monkeypatched out. No network, no
Postgres, no real audio or checkpoint required.
"""
import asyncio
import importlib
import sys
from pathlib import Path

import pytest

BACKEND_DIR = Path(__file__).parent.parent / "firebot-console" / "backend"
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))


@pytest.fixture
def server(monkeypatch, tmp_path):
    """A fresh import of server.py per test, with the voice-intent env vars set before
    module load (they're read at import time as module-level constants) and the router
    state file pointed at a scratch path so tests never touch a real json file."""
    monkeypatch.setenv("FIREBOT_VOICE_INTENT_CHECKPOINT", "dummy_checkpoint.pt")
    monkeypatch.setenv("FIREBOT_VOICE_INTENT_MIN_CONFIDENCE", "0.6")
    monkeypatch.setenv("FIREBOT_VOICE_INTENT_ROUTER_STATE", str(tmp_path / "router.json"))
    sys.modules.pop("server", None)
    mod = importlib.import_module("server")
    yield mod
    sys.modules.pop("server", None)


class _FakeUploadFile:
    def __init__(self, data: bytes, filename="clip.webm", content_type="audio/webm"):
        self._data = data
        self.filename = filename
        self.content_type = content_type

    async def read(self) -> bytes:
        return self._data


def test_local_intent_phrase_none_without_checkpoint(server, monkeypatch):
    monkeypatch.setattr(server, "VOICE_INTENT_CHECKPOINT", "")
    assert server._local_intent_phrase(b"whatever") is None


def test_local_intent_phrase_none_on_decode_or_classifier_failure(server, monkeypatch):
    def boom(*a, **k):
        raise RuntimeError("no librosa / bad clip / whatever")
    monkeypatch.setattr(server, "_get_voice_classifier", boom)
    assert server._local_intent_phrase(b"garbage-bytes") is None


def test_local_intent_phrase_skips_unknown(server, monkeypatch):
    class FakeClf:
        def predict_intent_payload_array(self, audio, sample_rate, min_confidence):
            return {"name": "UNKNOWN", "params": {}, "confidence": 0.2,
                     "source": "voice_intent", "raw_label": "STOP", "scores": {}}
    monkeypatch.setattr(server, "_get_voice_classifier", lambda: FakeClf())
    import types
    fake_librosa = types.SimpleNamespace(load=lambda *a, **k: ([0.0], 16_000))
    monkeypatch.setitem(sys.modules, "librosa", fake_librosa)
    assert server._local_intent_phrase(b"RIFFclip-bytes") is None


def test_local_intent_phrase_success(server, monkeypatch):
    class FakeClf:
        def predict_intent_payload_array(self, audio, sample_rate, min_confidence):
            return {"name": "STOP", "params": {}, "confidence": 0.97,
                     "source": "voice_intent", "raw_label": "STOP", "scores": {}}
    monkeypatch.setattr(server, "_get_voice_classifier", lambda: FakeClf())
    import types
    fake_librosa = types.SimpleNamespace(load=lambda *a, **k: ([0.0], 16_000))
    monkeypatch.setitem(sys.modules, "librosa", fake_librosa)
    result = server._local_intent_phrase(b"RIFFclip-bytes")
    assert result == ("stop", 0.97)


def _run(coro):
    return asyncio.run(coro)


def test_transcribe_trusts_local_and_skips_groq(server, monkeypatch):
    monkeypatch.setattr(server, "_local_intent_phrase", lambda audio_bytes: ("stop", 0.95))

    class TrustingRouter:
        def should_trust(self, confidence):
            return True
        def should_audit(self):
            return False
    monkeypatch.setattr(server, "_get_voice_router", lambda: TrustingRouter())

    async def fail_groq(*a, **k):
        raise AssertionError("Groq should not be called when the router trusts the local result")
    monkeypatch.setattr(server, "_call_groq", fail_groq)

    result = _run(server.transcribe(_FakeUploadFile(b"clip-bytes")))
    assert result == {"text": "stop"}


def test_transcribe_falls_back_to_groq_and_updates_router(server, monkeypatch):
    monkeypatch.setattr(server, "_local_intent_phrase", lambda audio_bytes: ("stop", 0.45))
    monkeypatch.setattr(server, "GROQ_API_KEY", "fake-key")

    updates = []
    saved = []

    class UntrustingRouter:
        def should_trust(self, confidence):
            return False
        def should_audit(self):
            return False
        def update(self, confidence, agreed):
            updates.append((confidence, agreed))
        def save(self, path):
            saved.append(path)
    monkeypatch.setattr(server, "_get_voice_router", lambda: UntrustingRouter())

    async def fake_groq(*a, **k):
        return "stop"
    monkeypatch.setattr(server, "_call_groq", fake_groq)

    result = _run(server.transcribe(_FakeUploadFile(b"clip-bytes")))
    assert result == {"text": "stop"}
    assert updates == [(0.45, True)]  # local "stop" agreed with Groq's "stop"
    assert saved == [server.VOICE_INTENT_ROUTER_STATE]


def test_transcribe_disagreement_still_returns_groq_text(server, monkeypatch):
    monkeypatch.setattr(server, "_local_intent_phrase", lambda audio_bytes: ("stop", 0.45))
    monkeypatch.setattr(server, "GROQ_API_KEY", "fake-key")

    updates = []

    class UntrustingRouter:
        def should_trust(self, confidence):
            return False
        def should_audit(self):
            return False
        def update(self, confidence, agreed):
            updates.append((confidence, agreed))
        def save(self, path):
            pass
    monkeypatch.setattr(server, "_get_voice_router", lambda: UntrustingRouter())

    async def fake_groq(*a, **k):
        return "go to home"  # disagrees with the local "stop" guess
    monkeypatch.setattr(server, "_call_groq", fake_groq)

    result = _run(server.transcribe(_FakeUploadFile(b"clip-bytes")))
    assert result == {"text": "go to home"}  # Groq's own transcription always wins here
    assert updates == [(0.45, False)]


def test_transcribe_without_groq_key_returns_local_guess_unaudited(server, monkeypatch):
    monkeypatch.setattr(server, "_local_intent_phrase", lambda audio_bytes: ("stop", 0.45))
    monkeypatch.setattr(server, "GROQ_API_KEY", "")

    class UntrustingRouter:
        def should_trust(self, confidence):
            return False
        def should_audit(self):
            return False
    monkeypatch.setattr(server, "_get_voice_router", lambda: UntrustingRouter())

    async def fail_groq(*a, **k):
        raise AssertionError("must not call Groq when no API key is configured")
    monkeypatch.setattr(server, "_call_groq", fail_groq)

    result = _run(server.transcribe(_FakeUploadFile(b"clip-bytes")))
    assert result == {"text": "stop"}


def test_transcribe_falls_back_to_groq_when_no_local_prediction(server, monkeypatch):
    monkeypatch.setattr(server, "_local_intent_phrase", lambda audio_bytes: None)
    monkeypatch.setattr(server, "GROQ_API_KEY", "fake-key")

    async def fake_groq(*a, **k):
        return "go to home"
    monkeypatch.setattr(server, "_call_groq", fake_groq)

    result = _run(server.transcribe(_FakeUploadFile(b"clip-bytes")))
    assert result == {"text": "go to home"}


# ---- /api/voice/status + recorded failure reason ----

def test_voice_status_local_when_checkpoint_present(server, monkeypatch, tmp_path):
    ckpt = tmp_path / "intent_head.pt"
    ckpt.write_bytes(b"x")
    monkeypatch.setattr(server, "VOICE_INTENT_CHECKPOINT", str(ckpt))
    monkeypatch.setattr(server, "_voice_last_error", None)
    st = asyncio.run(server.voice_status())
    assert st["mode"] == "local" and st["local_checkpoint_found"] is True
    assert st["last_error"] is None


def test_voice_status_reports_missing_checkpoint_and_falls_back(server, monkeypatch):
    monkeypatch.setattr(server, "VOICE_INTENT_CHECKPOINT", "/nope/intent_head.pt")
    monkeypatch.setattr(server, "GROQ_API_KEY", "k")
    st = asyncio.run(server.voice_status())
    assert st["mode"] == "groq" and st["local_configured"] and not st["local_checkpoint_found"]

    monkeypatch.setattr(server, "GROQ_API_KEY", "")
    assert asyncio.run(server.voice_status())["mode"] == "unavailable"


def test_local_failure_is_recorded_not_silent(server, monkeypatch, tmp_path):
    ckpt = tmp_path / "intent_head.pt"
    ckpt.write_bytes(b"x")
    monkeypatch.setattr(server, "VOICE_INTENT_CHECKPOINT", str(ckpt))

    def boom():
        raise ModuleNotFoundError("No module named 'transformers'")
    monkeypatch.setattr(server, "_get_voice_classifier", boom)
    import types
    monkeypatch.setitem(sys.modules, "librosa",
                        types.SimpleNamespace(load=lambda *a, **k: ([0.0], 16_000)))
    assert server._local_intent_phrase(b"RIFFclip") is None
    st = asyncio.run(server.voice_status())
    assert st["mode"] == "local-degraded"
    assert "transformers" in st["last_error"]


def _wav_bytes(seconds=0.5, sr=16_000):
    import io

    import numpy as np
    import soundfile as sf
    buf = io.BytesIO()
    sf.write(buf, (0.1 * np.sin(np.linspace(0, 400, int(seconds * sr)))).astype("float32"), sr, format="WAV")
    return buf.getvalue()


def test_decode_audio_wav_goes_through_librosa(server):
    audio = server._decode_audio_16k(_wav_bytes())
    assert audio.ndim == 1 and 7_000 < len(audio) < 9_000


def test_decode_audio_transcodes_non_wav_with_ffmpeg(server):
    import shutil
    if shutil.which("ffmpeg") is None:
        pytest.skip("ffmpeg not installed")
    import subprocess
    webm = subprocess.run(
        ["ffmpeg", "-loglevel", "error", "-f", "lavfi", "-i", "sine=frequency=440:duration=0.5",
         "-c:a", "libopus", "-f", "webm", "pipe:1"], capture_output=True, check=True).stdout
    assert webm[:4] != b"RIFF"
    audio = server._decode_audio_16k(webm)
    assert audio.ndim == 1 and 7_000 < len(audio) < 9_500


def test_decode_audio_reports_missing_ffmpeg_and_garbage(server, monkeypatch):
    monkeypatch.setattr("shutil.which", lambda _n: None)
    with pytest.raises(RuntimeError, match="ffmpeg isn't installed"):
        server._decode_audio_16k(b"not-a-wav")


def test_transcribe_no_groq_local_decline_gives_honest_422(server, monkeypatch, tmp_path):
    from fastapi import HTTPException
    monkeypatch.setattr(server, "GROQ_API_KEY", "")
    monkeypatch.setattr(server, "_local_intent_phrase", lambda _b: None)
    monkeypatch.setattr(server, "_voice_last_error", None)
    with pytest.raises(HTTPException) as ei:
        _run(server.transcribe(_FakeUploadFile(b"x")))
    assert ei.value.status_code == 422


def test_transcribe_no_groq_local_broken_gives_503_with_reason(server, monkeypatch):
    from fastapi import HTTPException
    monkeypatch.setattr(server, "GROQ_API_KEY", "")
    monkeypatch.setattr(server, "_local_intent_phrase", lambda _b: None)
    monkeypatch.setattr(server, "_voice_last_error", "RuntimeError: boom")
    with pytest.raises(HTTPException) as ei:
        _run(server.transcribe(_FakeUploadFile(b"x")))
    assert ei.value.status_code == 503 and "boom" in ei.value.detail


def test_vosk_text_none_when_unconfigured(server, monkeypatch):
    monkeypatch.setattr(server, "VOSK_MODEL", "")
    assert server._vosk_text(b"RIFFx") is None


def test_vosk_text_success_uses_offline_pipeline(server, monkeypatch):
    import numpy as np
    monkeypatch.setattr(server, "VOSK_MODEL", "/some/model")
    monkeypatch.setattr(server, "_decode_audio_16k", lambda _b: np.full(4000, 0.3, dtype="float32"))

    class Rec:
        done = False
        def reset(self): self.done = False
        def feed(self, pcm):
            if not any(pcm) and not self.done:
                self.done = True
                return "status", ""
            return None, "s"
    monkeypatch.setattr(server, "_get_vosk", lambda: Rec())
    assert server._vosk_text(b"whatever") == "status"
    assert server._vosk_last_error is None


def test_vosk_failure_is_recorded_not_raised(server, monkeypatch):
    monkeypatch.setattr(server, "VOSK_MODEL", "/some/model")
    monkeypatch.setattr(server, "_decode_audio_16k", lambda _b: [0.0] * 100)

    def boom():
        raise RuntimeError("Vosk is not installed")
    monkeypatch.setattr(server, "_get_vosk", boom)
    assert server._vosk_text(b"x") is None
    assert "not installed" in server._vosk_last_error


def test_vad_failure_falls_back_to_untrimmed_clip(server, monkeypatch):
    import numpy as np
    monkeypatch.setattr(server, "VOSK_MODEL", "/some/model")
    monkeypatch.setattr(server, "VAD_ENABLED", True)
    monkeypatch.setattr(server, "_decode_audio_16k", lambda _b: np.full(4000, 0.3, dtype="float32"))

    def no_vad():
        raise RuntimeError("Silero VAD needs: pip install")
    monkeypatch.setattr(server, "_get_vad_gate", no_vad)

    class Rec:
        done = False
        def reset(self): self.done = False
        def feed(self, pcm):
            if not any(pcm) and not self.done:
                self.done = True
                return "stop", ""
            return None, ""
    monkeypatch.setattr(server, "_get_vosk", lambda: Rec())
    assert server._vosk_text(b"x") == "stop"
    assert "Silero" in server._vad_last_error


def test_transcribe_prefers_vosk_over_groq(server, monkeypatch):
    monkeypatch.setattr(server, "GROQ_API_KEY", "fake-key")
    monkeypatch.setattr(server, "_local_intent_phrase", lambda _b: None)
    monkeypatch.setattr(server, "_vosk_text", lambda _b: "return home")

    async def no_groq(*a, **k):
        raise AssertionError("Groq should not be called when Vosk answered")
    monkeypatch.setattr(server, "_call_groq", no_groq)
    assert _run(server.transcribe(_FakeUploadFile(b"x"))) == {"text": "return home"}


def test_transcribe_vosk_nothing_then_groq(server, monkeypatch):
    monkeypatch.setattr(server, "GROQ_API_KEY", "fake-key")
    monkeypatch.setattr(server, "_local_intent_phrase", lambda _b: None)
    monkeypatch.setattr(server, "_vosk_text", lambda _b: None)

    async def groq(*a, **k):
        return "from groq"
    monkeypatch.setattr(server, "_call_groq", groq)
    assert _run(server.transcribe(_FakeUploadFile(b"x"))) == {"text": "from groq"}


def test_transcribe_no_groq_vosk_broken_reports_reason(server, monkeypatch):
    from fastapi import HTTPException
    monkeypatch.setattr(server, "GROQ_API_KEY", "")
    monkeypatch.setattr(server, "VOICE_INTENT_CHECKPOINT", "")
    monkeypatch.setattr(server, "VOSK_MODEL", "/m")
    monkeypatch.setattr(server, "_local_intent_phrase", lambda _b: None)
    monkeypatch.setattr(server, "_vosk_text", lambda _b: None)
    monkeypatch.setattr(server, "_vosk_last_error", "RuntimeError: no model")
    with pytest.raises(HTTPException) as ei:
        _run(server.transcribe(_FakeUploadFile(b"x")))
    assert ei.value.status_code == 503 and "Vosk: RuntimeError: no model" in ei.value.detail


def test_voice_status_reports_vosk_mode(server, monkeypatch, tmp_path):
    monkeypatch.setattr(server, "VOICE_INTENT_CHECKPOINT", "")
    monkeypatch.setattr(server, "VOSK_MODEL", str(tmp_path))
    monkeypatch.setattr(server, "GROQ_API_KEY", "")
    st = asyncio.run(server.voice_status())
    assert st["mode"] == "vosk" and st["vosk_model_found"] is True


# ---- run analysis endpoints (fake pool; no Postgres) ----

class _FakeConn:
    def __init__(self, frames, cmds):
        self._frames, self._cmds = frames, cmds

    async def fetch(self, query, *args):
        return self._frames if "FROM frames" in query else self._cmds


class _FakePool:
    def __init__(self, frames, cmds=()):
        self._c = _FakeConn(frames, list(cmds))

    def acquire(self):
        conn = self._c

        class _Ctx:
            async def __aenter__(self_inner): return conn
            async def __aexit__(self_inner, *a): return False
        return _Ctx()


def _pg_frames():
    import json
    return [{"seq": i, "t": i * 0.1, "x": i * 0.05, "y": 0.0, "speed": 0.5, "tank": 1.0,
             "sensors": json.dumps({"flame_left": 0.0 if i < 30 else 0.6, "us_left": 1.0 + (i % 3) * 0.01}),
             "mode": "AUTO", "cmd_pump": False, "compute_ms": 5.0 + (i % 4) * 0.1} for i in range(120)]


def test_run_anomalies_endpoint(server, monkeypatch):
    monkeypatch.setattr(server, "_pool", _FakePool(_pg_frames()))
    out = _run(server.run_anomalies("abc"))
    assert out["id"] == "abc" and out["frames"] == 120 and isinstance(out["anomalies"], list)


def test_run_summary_endpoint_and_narration_guard(server, monkeypatch):
    monkeypatch.setattr(server, "_pool", _FakePool(_pg_frames(), [{"at": None, "text": "stop", "valid": True, "message": ""}]))
    out = _run(server.run_summary("abc"))
    assert out["facts"]["operator_commands"] == 1 and out["narrated"] is False
    assert "first registered a fire" in out["text"]

    monkeypatch.setenv("FIREBOT_SLM_CMD", "cat")   # echoes the prompt: contains only source numbers
    out2 = _run(server.run_summary("abc", narrate_text=True))
    assert out2["text"]
