"""Tests for real-recording helpers and the manifest re-merge. Stdlib/numpy only."""
from __future__ import annotations

import csv
import wave
from pathlib import Path

from firebot.voice_intent import synth_data, vocab
from firebot.voice_intent.real_data import (LEGACY_LABEL_MAP, convert_legacy, count_clips,
                                            missing_classes, prompts_for)


def _wav(path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(16000)
        w.writeframes(b"\x00\x00" * 1600)


def test_legacy_map_targets_are_real_classes():
    assert set(LEGACY_LABEL_MAP.values()) <= set(vocab.CLASSES)
    for relative in ("go_left", "go_right", "forward", "backward"):
        assert relative not in LEGACY_LABEL_MAP


def test_convert_legacy_copies_mapped_only_and_never_overwrites(tmp_path):
    src, dst = tmp_path / "old", tmp_path / "new"
    for old in ("stop", "go_home", "unknown", "go_left"):
        _wav(src / old / "ananya_001.wav")
    assert convert_legacy(src, dst) == {"STOP": 1, "RETURN_HOME": 1, "UNKNOWN": 1}
    assert not (dst / "GOTO_WEST").exists() and not list(dst.glob("*left*"))
    (dst / "STOP" / "ananya_001.wav").write_bytes(b"keep")
    assert convert_legacy(src, dst) == {}
    assert (dst / "STOP" / "ananya_001.wav").read_bytes() == b"keep"


def test_prompts_are_valid_stable_and_speaker_specific():
    table = vocab.build_phrase_table()
    for label in vocab.CLASSES:
        p = prompts_for(label, "ananya")
        assert p and set(p) >= set(table[label])
        assert p == prompts_for(label, "ananya")
    assert prompts_for("GOTO_NORTH", "ananya") != prompts_for("GOTO_NORTH", "bob")


def test_missing_classes_and_counts(tmp_path):
    _wav(tmp_path / "STOP" / "ananya_001.wav")
    _wav(tmp_path / "STOP" / "bob_001.wav")
    assert count_clips(tmp_path, "STOP", "ananya") == 1
    assert "STOP" not in missing_classes(tmp_path) and "STATUS" in missing_classes(tmp_path)


def test_skip_synth_remerge_keeps_synthetic_rows_and_drops_stale_real(tmp_path):
    out = tmp_path / "vi"
    _wav(out / "audio" / "STOP" / "tts_1.wav")
    _wav(out / "audio" / "STOP" / "real_00000_old.wav")
    with (out / "manifest.csv").open("w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["path", "label", "source", "speaker", "phrase"])
        w.writerow(["audio/STOP/tts_1.wav", "STOP", "synth_tts", "Fred", "stop"])
        w.writerow(["audio/STOP/real_00000_old.wav", "STOP", "real", "old", ""])
    kept = synth_data.load_kept_rows(out)
    assert [r[2] for r in kept] == ["synth_tts"] and kept[0][0] == out / "audio/STOP/tts_1.wav"
    assert synth_data.clear_real_audio(out) == 1
    assert (out / "audio/STOP/tts_1.wav").exists()
    assert not (out / "audio/STOP/real_00000_old.wav").exists()
    assert synth_data.load_kept_rows(tmp_path / "nothing") == []
