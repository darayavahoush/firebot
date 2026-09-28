"""Torch-free tests: eval helpers, real-test-only split, and the audio usability guard."""
from __future__ import annotations

import numpy as np

from firebot.voice_intent import report, synth_data
from firebot.voice_intent.split import split_by_speaker


def test_selection_mask_excludes_real_slices():
    sl = np.array(["synth_unseen_voice", "real_test_ananya", "real_unseen_speaker", "synth_unseen_voice"])
    assert report.selection_mask(sl).tolist() == [True, False, False, True]


def test_selection_mask_falls_back_when_everything_is_real():
    sl = np.array(["real_test_ananya", "real_test_bob"])
    assert report.selection_mask(sl).all()


def test_finite_rows():
    f = np.array([[1.0, 2.0], [np.nan, 1.0], [np.inf, 0.0], [0.0, 0.0]])
    assert report.finite_rows(f).tolist() == [True, False, False, True]


def test_precision_recall_and_undefined_is_nan():
    cm = np.array([[8, 2, 0], [1, 9, 0], [0, 0, 0]])
    p, r = report.precision_recall(cm)
    assert np.isclose(p[0], 8 / 9) and np.isclose(r[0], 0.8) and np.isclose(p[1], 9 / 11)
    assert np.isnan(p[2]) and np.isnan(r[2])


def test_ece_zero_when_calibrated_and_high_when_overconfident():
    conf = np.full(10, 0.9)
    assert report.expected_calibration_error(conf, np.array([1] * 9 + [0])) < 1e-9
    assert report.expected_calibration_error(np.full(10, 0.99), np.array([1] * 5 + [0] * 5)) > 0.4


def test_threshold_table_counts_kept_and_accuracy():
    conf = np.array([0.95, 0.85, 0.65, 0.4])
    correct = np.array([1, 1, 0, 0])
    rows = {t: (k, a) for t, k, a in report.threshold_table(conf, correct, (0.5, 0.9, 0.99))}
    assert rows[0.5] == (0.75, 2 / 3) and rows[0.9] == (0.25, 1.0)
    assert rows[0.99][0] == 0.0 and np.isnan(rows[0.99][1])
    assert "ECE" in report.format_threshold_table(conf, correct)


def _data():
    sources = np.array(["synth_tts"] * 8 + ["synth_aug"] * 8 + ["real"] * 6)
    speakers = np.array(["v1", "v2", "v3", "v4"] * 4 + ["ananya"] * 3 + ["bob"] * 3)
    labels = np.array([0, 1] * 8 + [0, 1, 2, 0, 1, 2])
    return sources, speakers, labels


def test_real_test_only_never_trains_on_real_clips():
    sources, speakers, labels = _data()
    train, val, slices = split_by_speaker(sources, speakers, labels, real_test_only=True)
    assert not (sources[train] == "real").any()
    real_val = val[sources[val] == "real"]
    assert len(real_val) == 6
    assert set(slices[sources[val] == "real"]) == {"real_test_ananya", "real_test_bob"}
    assert set(np.concatenate([train, val])) == set(range(len(labels)))


def test_default_split_unchanged_without_flag():
    sources, speakers, labels = _data()
    _, _, slices = split_by_speaker(sources, speakers, labels)
    assert "real_unseen_speaker" in set(slices)


def test_is_usable_audio():
    ok = np.random.default_rng(0).normal(0, 0.1, 1600).astype(np.float32)
    assert synth_data.is_usable_audio(ok)
    assert not synth_data.is_usable_audio(np.array([], dtype=np.float32))
    assert not synth_data.is_usable_audio(np.zeros(1600, dtype=np.float32))
    assert not synth_data.is_usable_audio(np.full(1600, np.nan, dtype=np.float32))
    bad = ok.copy(); bad[5] = np.inf
    assert not synth_data.is_usable_audio(bad)
