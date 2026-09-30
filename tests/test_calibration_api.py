"""/api/voice/calibrate/* end to end, with a fake encoder (no Whisper, no real audio models)."""
import io
import sys
from pathlib import Path

import numpy as np
import pytest

torch = pytest.importorskip("torch")
pytest.importorskip("fastapi")
pytest.importorskip("soundfile")
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "firebot-console" / "backend"))

import calibration
import soundfile as sf
from fastapi import FastAPI
from fastapi.testclient import TestClient

from firebot.voice_intent.model import IntentHead
from firebot.voice_intent.vocab import CLASSES

D = 32
PROTOS = np.random.default_rng(0).normal(size=(len(CLASSES), D)).astype("float32") * 2
SHIFT = np.random.default_rng(9).normal(size=D).astype("float32") * 2.5


class FakeClf:
    """embed_array reads the class index from the clip's first sample (test encoding) and returns
    that class's shifted prototype -- a user whose voice sits away from the base model's."""
    def embed_array(self, audio, sr=16000):
        idx = round(float(audio[0]) * 100)
        return PROTOS[idx] + SHIFT + 0.3 * np.random.default_rng(idx).normal(size=D).astype("float32")


def _wav_bytes(idx):
    a = np.full(8000, 0.0, dtype="float32")
    a[0] = idx / 100
    buf = io.BytesIO()
    sf.write(buf, a, 16000, format="WAV", subtype="PCM_16")
    return buf.getvalue()


@pytest.fixture()
def client(tmp_path, monkeypatch):
    torch.manual_seed(0)
    head = IntentHead(d_model=D, hidden=32)
    x = torch.as_tensor(PROTOS)[torch.arange(len(CLASSES)).repeat(20)]
    y = torch.arange(len(CLASSES)).repeat(20)
    opt = torch.optim.Adam(head.parameters(), lr=1e-2)
    for _ in range(200):
        loss = torch.nn.functional.cross_entropy(head(x + 0.3 * torch.randn_like(x)), y)
        opt.zero_grad(); loss.backward(); opt.step()
    ckpt = tmp_path / "base.pt"
    torch.save({"state_dict": head.state_dict(), "classes": list(CLASSES), "hidden": 32, "d_model": D}, ckpt)

    monkeypatch.setattr(calibration, "CLIPS_DIR", tmp_path / "clips")
    monkeypatch.setattr(calibration, "MODELS_DIR", tmp_path / "users")
    calibration._head_cache.clear()
    calibration._base_cache = None
    calibration._last_auto.clear()

    def decode(b):
        a, _ = sf.read(io.BytesIO(b), dtype="float32")
        return a
    fake = FakeClf()
    calibration.configure(decode, lambda: fake, str(ckpt))
    app = FastAPI()
    app.include_router(calibration.router)
    return TestClient(app)


def _record_all(c, user="ann", n=5):
    for i, label in enumerate(CLASSES):
        if label == "UNKNOWN":
            continue
        for _ in range(n):
            r = c.post("/api/voice/calibrate/clip", params={"user": user, "label": label},
                       files={"file": ("c.wav", _wav_bytes(i), "audio/wav")})
            assert r.status_code == 200, r.text


def test_status_lists_all_commands_and_is_supported(client):
    j = client.get("/api/voice/calibrate/status", params={"user": "ann"}).json()
    assert j["supported"] and not j["has_model"]
    assert [c["label"] for c in j["classes"]] == list(CLASSES)
    assert all(c["count"] == 0 for c in j["classes"])


def test_full_flow_train_use_and_reset(client):
    _record_all(client)
    j = client.get("/api/voice/calibrate/status", params={"user": "ann"}).json()
    assert all(c["count"] == 5 for c in j["classes"] if not c["optional"])

    r = client.post("/api/voice/calibrate/train", params={"user": "ann"})
    assert r.status_code == 200, r.text
    rep = r.json()["report"]
    assert rep["accepted"] and rep["personal_acc"] >= rep["base_acc"]
    assert r.json()["has_model"] and "ann" in r.json()["users"]

    head = calibration.get_user_head("ann")
    assert head is not None and calibration.get_user_head("nobody") is None
    assert calibration.get_user_head("../etc") is None          # bad names never touch disk

    j = client.delete("/api/voice/calibrate/model", params={"user": "ann"}).json()
    assert not j["has_model"] and calibration.get_user_head("ann") is None


def test_needs_enough_clips_and_validates_input(client):
    _record_all(client, n=1)
    r = client.post("/api/voice/calibrate/train", params={"user": "ann"})
    assert r.status_code == 200 and not r.json()["report"]["accepted"] and r.json()["report"]["missing"]
    assert client.post("/api/voice/calibrate/clip", params={"user": "ann", "label": "NOPE"},
                       files={"file": ("c.wav", _wav_bytes(0), "audio/wav")}).status_code == 400
    assert client.get("/api/voice/calibrate/status", params={"user": "a b"}).status_code == 400
    # redo removes the newest clip
    n0 = client.get("/api/voice/calibrate/status", params={"user": "ann"}).json()["classes"][0]["count"]
    client.delete("/api/voice/calibrate/clip", params={"user": "ann", "label": CLASSES[0]})
    n1 = client.get("/api/voice/calibrate/status", params={"user": "ann"}).json()["classes"][0]["count"]
    assert n1 == n0 - 1


# ---------------------------------------------------------------- continuous improvement
def _pending(user, class_idx, text):
    cid = calibration.save_pending(user, _wav_bytes(class_idx), text)
    assert cid, "pending clip should be stashed for a known operator when a model exists"
    return cid


def _calibrated(client, user="ann"):
    _record_all(client, user=user)
    assert client.post("/api/voice/calibrate/train", params={"user": user}).json()["report"]["accepted"]


def test_confirm_correct_and_ignore_feedback(client):
    _calibrated(client)
    stop, north = CLASSES.index("STOP"), CLASSES.index("GOTO_NORTH")
    # sent unchanged -> confirmation, saved as a training clip for STOP
    cid = _pending("ann", stop, "stop")
    r = client.post("/api/voice/feedback", json={"user": "ann", "clip_id": cid, "sent_text": "stop"}).json()
    assert r["recorded"] and r["kind"] == "confirm" and r["final"] == "STOP"
    assert list((calibration.CLIPS_DIR / "ann" / "STOP").glob("fb_*.wav"))
    # the model said "stop" but the person picked GOTO_NORTH -> correction, saved under the RIGHT class
    cid = _pending("ann", north, "stop")
    r = client.post("/api/voice/feedback", json={"user": "ann", "clip_id": cid, "label": "GOTO_NORTH"}).json()
    assert r["kind"] == "correction" and r["final"] == "GOTO_NORTH"
    assert r["live"]["decisions"] == 2 and r["live"]["accuracy"] == 0.5
    # they typed something that isn't one command's phrase -> we can't know the label: learn nothing
    cid = _pending("ann", stop, "stop")
    r = client.post("/api/voice/feedback", json={"user": "ann", "clip_id": cid, "sent_text": "go somewhere odd"}).json()
    assert not r["recorded"] and not list((calibration.CLIPS_DIR / "ann" / "_pending").glob(f"{cid}.*"))
    # a clip can only be used once, and ids are validated
    assert not client.post("/api/voice/feedback", json={"user": "ann", "clip_id": cid, "label": "STOP"}).json()["recorded"]
    assert client.post("/api/voice/feedback", json={"user": "ann", "clip_id": "../../x", "label": "STOP"}).status_code == 400


def test_no_pending_clip_without_a_usable_model(client, tmp_path):
    calibration.configure(calibration._decode, calibration._classifier, str(tmp_path / "missing.pt"))
    assert calibration.save_pending("ann", _wav_bytes(0), "stop") is None
    assert calibration.save_pending(None, _wav_bytes(0), "stop") is None


def test_auto_retrain_after_corrections_and_history(client, monkeypatch):
    started = []
    monkeypatch.setattr(calibration, "maybe_auto_retrain", lambda u: started.append(u) or False)  # no thread in tests
    _calibrated(client)
    assert not calibration.should_auto_retrain("ann")            # nothing new yet
    ne = CLASSES.index("GOTO_NORTHEAST")
    for _ in range(calibration.AUTO_MIN_CORRECTIONS):            # the model kept saying "stop"; the person corrects it
        cid = _pending("ann", ne, "stop")
        client.post("/api/voice/feedback", json={"user": "ann", "clip_id": cid, "label": "GOTO_NORTHEAST"})
    assert started, "record_feedback should ask for an automatic retrain"
    assert calibration.should_auto_retrain("ann")
    before = client.get("/api/voice/calibrate/status", params={"user": "ann"}).json()
    assert before["learning"]["new"] == calibration.AUTO_MIN_CORRECTIONS
    rep = calibration._auto_retrain_blocking("ann")
    assert rep and rep["trigger"] == "auto" and rep["incumbent_acc"] is not None
    after = client.get("/api/voice/calibrate/status", params={"user": "ann"}).json()
    assert after["learning"]["new"] == 0 and after["history"][-1]["trigger"] == "auto"
    assert not calibration.should_auto_retrain("ann")            # nothing new since


def test_never_learns_from_feedback_alone(client):
    """No guided calibration yet -> feedback clips must not silently build a model."""
    cid = _pending("bob", 0, "stop")
    client.post("/api/voice/feedback", json={"user": "bob", "clip_id": cid, "sent_text": "stop"})
    for _ in range(calibration.AUTO_MIN_NEW):
        cid = _pending("bob", 0, "stop")
        client.post("/api/voice/feedback", json={"user": "bob", "clip_id": cid, "sent_text": "stop"})
    assert not calibration.should_auto_retrain("bob")


def test_reset_removes_model_history_and_backup(client):
    _calibrated(client)
    calibration._auto_retrain_blocking("ann")
    assert (calibration.MODELS_DIR / "ann.pt").is_file()
    client.delete("/api/voice/calibrate/model", params={"user": "ann"})
    assert not list(calibration.MODELS_DIR.glob("ann*"))
