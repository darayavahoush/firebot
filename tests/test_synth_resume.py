"""Resume/adopt behaviour of the synthetic sweep, with TTS and augmentation faked."""
from __future__ import annotations

from types import SimpleNamespace

import numpy as np
import pytest
import soundfile as sf

from firebot.voice_intent import synth_data

VOICES = [SimpleNamespace(id="v.Alpha"), SimpleNamespace(id="v.Beta")]
TABLE = {"STOP": ["stop", "halt"], "STATUS": ["status", "report", "state"]}


@pytest.fixture
def fake_tts(monkeypatch):
    calls = []
    state = {"explode_on": None}

    def synth(voice_id, rate, phrase, out_wav):
        calls.append(phrase)
        if state["explode_on"] == phrase:
            raise KeyboardInterrupt
        t = np.arange(1600) / 16000
        sf.write(str(out_wav), (0.3 * np.sin(2 * np.pi * 220 * t)).astype(np.float32), 16000,
                 subtype="PCM_16")

    monkeypatch.setattr(synth_data, "_get_tts_voices", lambda f: list(VOICES))
    monkeypatch.setattr(synth_data, "_probe_voices", lambda v, d: v)
    monkeypatch.setattr(synth_data, "_synthesize", synth)
    monkeypatch.setattr(synth_data, "_augment", lambda a, rng: (a * 0.9).astype(np.float32))
    monkeypatch.setattr(synth_data.vocab, "build_phrase_table", lambda: TABLE)
    return SimpleNamespace(calls=calls, state=state)


def _gen(out, resume=False):
    return synth_data.generate_synthetic(out, 1, 2, None, None, resume=resume)


def _key(rows):
    return sorted((p.name, label, src, spk, ph) for p, label, src, spk, ph in rows)


def test_full_run_records_every_class_in_the_partial_manifest(fake_tts, tmp_path):
    rows = _gen(tmp_path)
    assert len(rows) == (2 + 3) * 2 * 3
    partial = synth_data._read_rows(tmp_path / synth_data.PARTIAL_MANIFEST, tmp_path)
    assert _key(partial) == _key(rows)


def test_interrupted_run_keeps_finished_classes_and_resume_does_only_the_rest(fake_tts, tmp_path):
    reference = _key(_gen(tmp_path / "ref"))
    fake_tts.calls.clear()
    out = tmp_path / "run"
    fake_tts.state["explode_on"] = "report"          # dies partway through STATUS
    with pytest.raises(KeyboardInterrupt):
        _gen(out)
    done = synth_data._read_rows(out / synth_data.PARTIAL_MANIFEST, out)
    assert {r[1] for r in done} == {"STOP"}          # STOP survived the interrupt
    assert list((out / "audio" / "STATUS").glob("*.wav"))   # leftovers from the dead class

    fake_tts.state["explode_on"] = None
    fake_tts.calls.clear()
    rows = _gen(out, resume=True)
    assert set(fake_tts.calls) == {"status", "report", "state"}   # STOP not re-synthesised
    assert _key(rows) == reference
    assert len(list((out / "audio" / "STATUS").glob("*.wav"))) == 3 * 2 * 3  # no stale files


def test_resume_adopts_complete_classes_from_disk_without_a_partial_manifest(fake_tts, tmp_path):
    first = _gen(tmp_path)
    (tmp_path / synth_data.PARTIAL_MANIFEST).unlink()    # like a run interrupted by the old code
    fake_tts.calls.clear()
    again = _gen(tmp_path, resume=True)
    assert fake_tts.calls == []
    assert _key(again) == _key(first)


def test_adopt_rejects_wrong_counts_patterns_and_tiny_files(fake_tts, tmp_path):
    _gen(tmp_path)
    d = tmp_path / "audio" / "STOP"
    args = (d, "STOP", TABLE["STOP"], VOICES, 1, 2)
    assert synth_data.adopt_existing_class(*args) is not None
    assert synth_data.adopt_existing_class(d, "STOP", TABLE["STOP"], VOICES[:1], 1, 2) is None
    assert synth_data.adopt_existing_class(d, "STOP", TABLE["STOP"], VOICES, 1, 1) is None
    (d / "00003_tts.wav").write_bytes(b"x" * 10)
    assert synth_data.adopt_existing_class(*args) is None
    assert synth_data.adopt_existing_class(tmp_path / "nope", "X", ["a"], VOICES, 1, 2) is None


def test_without_resume_a_stale_partial_manifest_is_discarded(fake_tts, tmp_path):
    _gen(tmp_path)
    fake_tts.calls.clear()
    _gen(tmp_path)                                       # fresh run, not --resume
    assert len(fake_tts.calls) == (2 + 3) * 2


def test_real_clips_survive_resume_and_do_not_break_adoption(tmp_path, fake_tts):
    """Merged `real_*.wav` files share the class folder: they must not count toward the sweep's
    expected size (which would stop a finished class being adopted) nor be deleted when an
    unfinished class is regenerated."""
    out = tmp_path
    _gen(out)
    label_dir = out / "audio" / "STOP"
    real = label_dir / "real_00000_ananya_001.wav"
    sf.write(str(real), np.zeros(1600, dtype=np.float32), 16000, subtype="PCM_16")
    (out / synth_data.PARTIAL_MANIFEST).unlink()  # force the "adopt from disk" path
    rows = _gen(out, resume=True)
    assert real.exists()
    assert any(r[1] == "STOP" for r in rows)
    # now make STOP look unfinished: the stale sweep files go, the real clip stays
    next(iter(sorted(label_dir.glob("[0-9]*_*.wav")))).unlink()
    (out / synth_data.PARTIAL_MANIFEST).unlink()
    _gen(out, resume=True)
    assert real.exists()


def test_second_run_on_same_folder_is_refused(tmp_path):
    # a second open file description conflicts with the first, even inside one process
    with (synth_data.exclusive_run(tmp_path), pytest.raises(SystemExit),
          synth_data.exclusive_run(tmp_path)):
        pass
