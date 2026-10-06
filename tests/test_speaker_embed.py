import json

import numpy as np
import pytest

from firebot.speech import speaker_embed, speaker_eval, speaker_id
from firebot.speech.speaker_id import (
    SpeakerIdentifier,
    SpeakerSmoother,
    as_norm,
    decide_speaker,
    l2_normalize,
    resolve_thresholds,
)

DIM = 64


class _Stub:
    """Deterministic fake backend: embedding = per-'speaker' direction chosen by pcm content."""
    def __init__(self):
        rng = np.random.default_rng(1)
        self.dirs = {b"a": rng.standard_normal(DIM), b"b": rng.standard_normal(DIM)}

    def embed(self, audio):
        key = b"a" if audio.mean() >= 0 else b"b"
        rng = np.random.default_rng(int(abs(audio.sum()) * 1000) % 2**32)
        return (self.dirs[key] + 0.3 * rng.standard_normal(DIM)).astype(np.float32)


def _pcm(sign: float, n=16000, seed=0) -> bytes:
    rng = np.random.default_rng(seed)
    x = sign * 0.2 + 0.01 * rng.standard_normal(n)
    return (np.clip(x, -1, 1) * 32767).astype("<i2").tobytes()


@pytest.fixture()
def stub(monkeypatch):
    monkeypatch.setenv("FIREBOT_SPEAKER_EMBEDDER", "wespeaker")
    st = _Stub()
    monkeypatch.setattr(speaker_id, "get_backend", lambda name=None: st)
    return st


def test_unknown_embedder_name_is_an_error(monkeypatch):
    monkeypatch.setenv("FIREBOT_SPEAKER_EMBEDDER", "nope")
    with pytest.raises(speaker_embed.SpeakerModelError):
        speaker_embed.embedder_name()


def test_missing_model_fails_loudly_not_silently(monkeypatch, tmp_path):
    pytest.importorskip("onnxruntime")
    monkeypatch.setenv("FIREBOT_SPEAKER_MODEL_PATH", str(tmp_path / "missing.onnx"))
    monkeypatch.setenv("FIREBOT_SPEAKER_AUTODOWNLOAD", "0")
    with pytest.raises(speaker_embed.SpeakerModelError, match="not found"):
        speaker_embed.WeSpeakerOnnx()


def test_enroll_identify_and_meta(stub, tmp_path):
    ident = SpeakerIdentifier(tmp_path)
    ident.enroll_multi("ann", [_pcm(1, seed=i) for i in range(4)])
    ident.enroll_multi("bob", [_pcm(-1, seed=i) for i in range(4)])
    assert json.loads((tmp_path / "embedder.json").read_text())["embedder"] == "wespeaker"
    s = ident.scores(_pcm(1, seed=9))
    assert s["ann"] > s["bob"]
    assert decide_speaker(s, 0.3, 0.05)[0] == "ann"


def test_voiceprints_from_another_embedder_are_refused(stub, tmp_path):
    np.save(tmp_path / "ann.npy", np.ones(DIM, dtype=np.float32))  # no embedder.json => legacy
    with pytest.raises(speaker_embed.SpeakerModelError, match="re-enrol"):
        SpeakerIdentifier(tmp_path).scores(_pcm(1))


def test_cannot_mix_new_enrolment_into_legacy_dir(stub, tmp_path):
    np.save(tmp_path / "old.npy", np.ones(DIM, dtype=np.float32))
    with pytest.raises(speaker_embed.SpeakerModelError):
        SpeakerIdentifier(tmp_path).enroll("new", _pcm(1))


def test_reload_when_files_change(stub, tmp_path):
    ident = SpeakerIdentifier(tmp_path)
    ident.enroll("ann", _pcm(1))
    assert ident.enrolled() == ["ann"]
    SpeakerIdentifier(tmp_path).enroll("bob", _pcm(-1))  # another process/request
    assert ident.enrolled() == ["ann", "bob"]


def test_as_norm_removes_a_speaker_specific_offset():
    rng = np.random.default_rng(0)
    cohort = rng.standard_normal((200, DIM))
    cohort /= np.linalg.norm(cohort, axis=1, keepdims=True)
    e = l2_normalize(rng.standard_normal(DIM))
    same = l2_normalize(e + 0.3 * rng.standard_normal(DIM))
    other = l2_normalize(rng.standard_normal(DIM))
    assert as_norm(e, same, cohort) > as_norm(e, other, cohort) + 1.5


def test_cohort_switches_scoring_to_asnorm(stub, tmp_path):
    ident = SpeakerIdentifier(tmp_path)
    ident.enroll_multi("ann", [_pcm(1, seed=i) for i in range(3)])
    ident.enroll_multi("bob", [_pcm(-1, seed=i) for i in range(3)])
    assert ident.info()["scoring"] == "cosine"
    np.save(tmp_path / "cohort.npy", np.random.default_rng(0).standard_normal((60, DIM)))
    assert ident.info()["scoring"] == "asnorm"
    assert max(ident.scores(_pcm(1, seed=5)).values()) > 1.0  # z-score-like, not cosine


def test_smoother_blends_recent_and_forgets_old():
    sm = SpeakerSmoother(window_s=20, half_life_s=5)
    sm.update({"ann": 0.8, "bob": 0.2}, now=0)
    out = sm.update({"ann": 0.4, "bob": 0.45}, now=1)  # one noisy clip
    assert out["ann"] > out["bob"]
    out = sm.update({"ann": 0.2, "bob": 0.8}, now=100)  # long gap => history dropped
    assert out == {"ann": 0.2, "bob": 0.8}


def test_resolve_thresholds_priority(tmp_path):
    assert resolve_thresholds(tmp_path) == (0.30, 0.05)
    (tmp_path / "speaker_calibration.json").write_text(
        json.dumps({"scoring": "cosine", "threshold": 0.41, "margin": 0.07}))
    assert resolve_thresholds(tmp_path) == (0.41, 0.07)
    assert resolve_thresholds(tmp_path, "0.5", None) == (0.5, 0.07)
    np.save(tmp_path / "cohort.npy", np.zeros((20, 4)))  # mode changed -> stale calibration ignored
    assert resolve_thresholds(tmp_path) == (0.30, 0.05)


def test_eer_and_mindcf():
    t = np.array([0.9, 0.8, 0.85, 0.7, 0.95])
    n = np.array([0.1, 0.2, 0.3, 0.75, 0.15])
    e, thr = speaker_eval.eer(t, n)
    assert 0.0 < e <= 0.2
    assert speaker_eval.min_dcf(t, n)[0] <= 1.0
    assert speaker_eval.pick_threshold(t, n, max_far=0.0) > 0.75
    perfect = speaker_eval.eer([0.9, 0.8], [0.1, 0.2])[0]
    assert perfect == 0.0


def test_fbank_and_onnx_pipeline_with_tiny_model(monkeypatch, tmp_path):
    pytest.importorskip("kaldi_native_fbank")
    ort = pytest.importorskip("onnxruntime")  # noqa: F841
    onnx = pytest.importorskip("onnx")
    from onnx import TensorProto, helper, numpy_helper
    w = np.random.default_rng(0).standard_normal((80, 32)).astype("float32")
    g = helper.make_graph(
        [helper.make_node("ReduceMean", ["f"], ["m"], axes=[1], keepdims=0),
         helper.make_node("MatMul", ["m", "W"], ["e"])], "g",
        [helper.make_tensor_value_info("f", TensorProto.FLOAT, ["B", "T", 80])],
        [helper.make_tensor_value_info("e", TensorProto.FLOAT, ["B", 32])],
        [numpy_helper.from_array(w, "W")])
    m = helper.make_model(g, opset_imports=[helper.make_opsetid("", 13)])
    m.ir_version = 8
    path = tmp_path / "tiny.onnx"
    onnx.save(m, str(path))
    monkeypatch.setenv("FIREBOT_SPEAKER_MODEL_PATH", str(path))
    be = speaker_embed.WeSpeakerOnnx()
    t = np.arange(8000) / 16000
    short = (0.3 * np.sin(2 * np.pi * 220 * t)).astype("float32")  # 0.5 s -> tiled to 1 s
    assert be.embed(short).shape == (32,)
