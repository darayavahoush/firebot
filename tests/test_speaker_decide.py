from firebot.speech.speaker_id import decide_speaker


def test_clear_winner():
    assert decide_speaker({"ananya": 0.82, "avinandan": 0.31}) == ("ananya", 0.82)


def test_below_threshold_is_unrecognised():
    assert decide_speaker({"ananya": 0.42, "avinandan": 0.2})[0] is None


def test_near_tie_is_not_guessed():
    assert decide_speaker({"ananya": 0.71, "avinandan": 0.69})[0] is None


def test_single_enrolled_speaker_and_empty():
    assert decide_speaker({"ananya": 0.6})[0] == "ananya"
    assert decide_speaker({}) == (None, 0.0)
