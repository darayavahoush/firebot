import numpy as np

from firebot.speech.speaker_id import decide_speaker, trim_silence


def test_clear_winner():
    assert decide_speaker({"ananya": 0.82, "avinandan": 0.31}) == ("ananya", 0.82)


def test_below_threshold_is_unrecognised():
    assert decide_speaker({"ananya": 0.42, "avinandan": 0.2}, threshold=0.5)[0] is None


def test_near_tie_is_not_guessed():
    assert decide_speaker({"ananya": 0.71, "avinandan": 0.69})[0] is None


def test_single_enrolled_speaker_and_empty():
    assert decide_speaker({"ananya": 0.6})[0] == "ananya"
    assert decide_speaker({}) == (None, 0.0)


def test_short_clip_score_now_counts_with_default_threshold():
    assert decide_speaker({"ananya": 0.37, "avinandan": 0.21})[0] == "ananya"


def test_trim_silence_cuts_padding_around_speech():
    sr = 16_000
    audio = np.zeros(sr * 3, dtype="float32")
    audio[sr : sr + 8000] = 0.3 * np.sin(np.linspace(0, 800, 8000))  # 0.5 s of "speech"
    out = trim_silence(audio, sr)
    assert 8000 <= len(out) < sr and out.max() > 0.2


def test_trim_silence_leaves_silence_alone():
    audio = np.zeros(16_000, dtype="float32")
    assert len(trim_silence(audio)) == len(audio)
