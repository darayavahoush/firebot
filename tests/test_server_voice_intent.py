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
    assert server._local_intent_phrase(b"clip-bytes") is None


def test_local_intent_phrase_success(server, monkeypatch):
    class FakeClf:
        def predict_intent_payload_array(self, audio, sample_rate, min_confidence):
            return {"name": "STOP", "params": {}, "confidence": 0.97,
                     "source": "voice_intent", "raw_label": "STOP", "scores": {}}
    monkeypatch.setattr(server, "_get_voice_classifier", lambda: FakeClf())
    import types
    fake_librosa = types.SimpleNamespace(load=lambda *a, **k: ([0.0], 16_000))
    monkeypatch.setitem(sys.modules, "librosa", fake_librosa)
    result = server._local_intent_phrase(b"clip-bytes")
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
