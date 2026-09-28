"""Tests for the speaker-aware split, valid-frame pooling maths, phrase-table
uniqueness, and the manifest's speaker/phrase columns. Torch-free."""
from __future__ import annotations

import csv
from collections import Counter

import numpy as np
import pytest

from firebot.voice_intent import features, synth_data, vocab
from firebot.voice_intent.split import has_speaker_info, split_by_speaker


def _synthetic_dataset(n_voices=10, per_voice=6, n_classes=3):
    sources, speakers, labels = [], [], []
    for v in range(n_voices):
        for i in range(per_voice):
            sources.append("synth_tts" if i % 3 == 0 else "synth_aug")
            speakers.append(f"voice{v}")
            labels.append(i % n_classes)
    return np.array(sources), np.array(speakers), np.array(labels)


# ---------------------------------------------------------------------------
# split_by_speaker
# ---------------------------------------------------------------------------

def test_no_speaker_appears_on_both_sides_of_the_split():
    sources, speakers, labels = _synthetic_dataset()
    train, val, slices = split_by_speaker(sources, speakers, labels, val_frac=0.2, seed=1)
    assert set(speakers[train]).isdisjoint(set(speakers[val]))
    assert len(val) > 0 and len(train) > 0
    assert set(slices) == {"synth_unseen_voice"}
    assert len(slices) == len(val)


def test_split_is_a_partition():
    sources, speakers, labels = _synthetic_dataset()
    train, val, _ = split_by_speaker(sources, speakers, labels)
    assert sorted(np.concatenate([train, val]).tolist()) == list(range(len(labels)))


def test_split_is_deterministic_for_a_seed():
    sources, speakers, labels = _synthetic_dataset()
    a = split_by_speaker(sources, speakers, labels, seed=3)
    b = split_by_speaker(sources, speakers, labels, seed=3)
    assert (a[1] == b[1]).all()


def _with_real(speakers_real, per_speaker=8, n_classes=3):
    sources, speakers, labels = _synthetic_dataset()
    sources, speakers, labels = list(sources), list(speakers), list(labels)
    for name in speakers_real:
        for i in range(per_speaker):
            sources.append("real")
            speakers.append(name)
            labels.append(i % n_classes)
    return np.array(sources), np.array(speakers), np.array(labels)


def test_two_real_speakers_holds_out_one_whole_person():
    sources, speakers, labels = _with_real(["ananya", "avinandan"])
    train, val, slices = split_by_speaker(sources, speakers, labels)
    real_val = val[slices == "real_unseen_speaker"]
    assert set(speakers[real_val]) == {"avinandan"}  # last alphabetically
    assert "avinandan" not in set(speakers[train])
    assert "ananya" in set(speakers[train])


def test_explicit_holdout_real_speaker_wins():
    sources, speakers, labels = _with_real(["ananya", "avinandan"])
    train, val, slices = split_by_speaker(sources, speakers, labels,
                                          holdout_real_speaker="ananya")
    assert set(speakers[val[slices == "real_unseen_speaker"]]) == {"ananya"}
    assert "ananya" not in set(speakers[train])


def test_unknown_holdout_speaker_is_an_error_not_a_silent_noop():
    sources, speakers, labels = _with_real(["ananya"])
    with pytest.raises(ValueError):
        split_by_speaker(sources, speakers, labels, holdout_real_speaker="nobody")


def test_single_real_speaker_is_reported_as_seen_speaker_not_unseen():
    """One person can only be split by takes; it must not be labelled as a
    new-speaker test, or it would overstate how well it generalises."""
    sources, speakers, labels = _with_real(["ananya"])
    train, val, slices = split_by_speaker(sources, speakers, labels)
    assert "real_seen_speaker" in set(slices)
    assert "real_unseen_speaker" not in set(slices)
    assert "ananya" in set(speakers[train])  # still trained on


def test_has_speaker_info():
    assert not has_speaker_info(np.array(["", "", ""]))
    assert not has_speaker_info(np.array([]))
    assert has_speaker_info(np.array(["", "voice1"]))


# ---------------------------------------------------------------------------
# valid_frame_count (pooling)
# ---------------------------------------------------------------------------

def test_valid_frame_count_two_second_clip():
    assert features.valid_frame_count(2 * 16_000) == 100


def test_valid_frame_count_rounds_up_and_never_zero():
    assert features.valid_frame_count(1) == 1
    assert features.valid_frame_count(0) == 1
    assert features.valid_frame_count(321) == 2  # just over one 320-sample frame


def test_valid_frame_count_caps_at_the_30s_window():
    assert features.valid_frame_count(60 * 16_000) == features.ENCODER_FRAMES == 1500


# ---------------------------------------------------------------------------
# phrase table
# ---------------------------------------------------------------------------

def test_no_phrase_is_labelled_as_two_different_classes():
    table = vocab.build_phrase_table()
    counts = Counter(p for phrases in table.values() for p in phrases)
    assert [p for p, n in counts.items() if n > 1] == []


def test_no_class_lost_all_its_phrases_to_deduplication():
    for label, phrases in vocab.build_phrase_table().items():
        assert phrases, f"{label} has no phrases"


# ---------------------------------------------------------------------------
# manifest + real-speaker parsing + voice exclusion
# ---------------------------------------------------------------------------

def test_real_speaker_parsed_from_filename():
    assert synth_data._real_speaker("ananya_007") == "ananya"
    assert synth_data._real_speaker("Avinandan_015") == "avinandan"
    assert synth_data._real_speaker("some_long_name_003") == "some_long_name"
    assert synth_data._real_speaker("recording") == "real"


def test_manifest_has_speaker_and_phrase_columns(tmp_path):
    (tmp_path / "audio" / "STOP").mkdir(parents=True)
    rows = [
        (tmp_path / "audio/STOP/00000_tts.wav", "STOP", "synth_tts", "voice.A", "stop now"),
        (tmp_path / "audio/STOP/real_00000_a_001.wav", "STOP", "real", "a", ""),
    ]
    synth_data.write_manifest(rows, tmp_path)
    with (tmp_path / "manifest.csv").open() as f:
        got = list(csv.DictReader(f))
    assert got[0]["speaker"] == "voice.A" and got[0]["phrase"] == "stop now"
    assert got[1]["source"] == "real" and got[1]["speaker"] == "a"

    loaded = features.load_manifest_full(tmp_path)
    assert loaded[0][3] == "voice.A"
    assert features.load_manifest(tmp_path)[0][1] == "STOP"  # old 3-tuple API intact


def test_load_manifest_tolerates_a_legacy_manifest_without_speaker(tmp_path):
    (tmp_path / "manifest.csv").write_text("path,label,source\naudio/STOP/0.wav,STOP,synth_tts\n")
    (row,) = features.load_manifest_full(tmp_path)
    assert row[3] == ""


class _V:
    def __init__(self, id_):
        self.id = id_


def test_exclude_voices_matches_on_name_not_substring():
    voices = [_V("com.apple.speech.synthesis.voice.Albert"),
              _V("com.apple.voice.compact.en-US.Samantha"),
              _V("com.apple.speech.synthesis.voice.Zarvox")]
    kept = synth_data._exclude_voices(voices, synth_data.NOVELTY_VOICE_NAMES)
    assert [v.id for v in kept] == ["com.apple.voice.compact.en-US.Samantha"]
    # a name that merely appears inside another voice's id must not be dropped
    assert len(synth_data._exclude_voices([_V("x.y.Organic")], {"organ"})) == 1
